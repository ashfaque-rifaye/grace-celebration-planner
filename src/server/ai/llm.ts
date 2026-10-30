/**
 * LLM client with two-level failover.
 *
 *   provider chain   Gemini -> Fireworks        (different credentials and quota)
 *     model chain    primary -> fallback model  (same provider, different model)
 *
 * The `parse` callback runs inside the chain, so output that fails schema
 * validation counts as a failed attempt and moves on to the next model, rather
 * than dropping straight to the offline planner.
 *
 * `fetch` is injected, so the whole failover path is tested without a network.
 * The Gemini key travels in a header rather than the URL, so it cannot end up in
 * an error message or an access log.
 */
import {
  configuredProviders,
  isProviderFatalStatus,
  modelChain,
  type LlmEnv,
  type LlmProvider,
} from "./llm-policy";

export interface LlmRequest {
  system: string;
  user: string;
  maxTokens: number;
  temperature: number;
}

export interface LlmResult<T> {
  value: T;
  /** The provider that actually answered, which drives the honest UI badge. */
  provider: LlmProvider;
  model: string;
}

export interface LlmClient {
  readonly configured: boolean;
  complete<T>(request: LlmRequest, parse: (text: string) => T): Promise<LlmResult<T>>;
}

export class LlmUnavailableError extends Error {
  override readonly name = "LlmUnavailableError";
}

/** A failure that another model on the same provider will not fix. */
class ProviderFatalError extends Error {}

export interface LlmClientOptions {
  fetch?: typeof fetch;
  /** Per-attempt timeout, so one hung model cannot stall the chain. */
  attemptTimeoutMs?: number;
  /** Ceiling across all attempts, so the user is never left waiting. */
  totalTimeoutMs?: number;
}

const DEFAULT_ATTEMPT_TIMEOUT_MS = 12_000;
const DEFAULT_TOTAL_TIMEOUT_MS = 25_000;

interface ProviderAdapter {
  apiKey(env: LlmEnv): string | undefined;
  buildRequest(
    model: string,
    request: LlmRequest,
    apiKey: string,
  ): { url: string; headers: Record<string, string>; body: unknown };
  readText(json: unknown): string | undefined;
}

const ADAPTERS: Record<LlmProvider, ProviderAdapter> = {
  gemini: {
    apiKey: (env) => env.GEMINI_API_KEY,
    buildRequest: (model, request, apiKey) => ({
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      headers: { "x-goog-api-key": apiKey },
      body: {
        systemInstruction: { parts: [{ text: request.system }] },
        contents: [{ role: "user", parts: [{ text: request.user }] }],
        generationConfig: {
          temperature: request.temperature,
          maxOutputTokens: request.maxTokens,
          responseMimeType: "application/json",
        },
      },
    }),
    readText: (json) => {
      const data = json as {
        candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
      };
      const parts = data.candidates?.[0]?.content?.parts ?? [];
      return parts
        .filter((part) => !part.thought)
        .map((part) => part.text ?? "")
        .join("");
    },
  },
  fireworks: {
    apiKey: (env) => env.FIREWORKS_API_KEY,
    buildRequest: (model, request, apiKey) => ({
      url: "https://api.fireworks.ai/inference/v1/chat/completions",
      headers: { authorization: `Bearer ${apiKey}` },
      body: {
        model,
        max_tokens: request.maxTokens,
        temperature: request.temperature,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.user },
        ],
      },
    }),
    readText: (json) => {
      const data = json as { choices?: { message?: { content?: string } }[] };
      return data.choices?.[0]?.message?.content;
    },
  },
};

export function createLlmClient(env: LlmEnv, options: LlmClientOptions = {}): LlmClient {
  const doFetch = options.fetch ?? fetch;
  const attemptTimeoutMs = options.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS;
  const totalTimeoutMs = options.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;
  const providers = configuredProviders(env);

  async function attempt(
    provider: LlmProvider,
    model: string,
    request: LlmRequest,
    signal: AbortSignal,
  ): Promise<string> {
    const adapter = ADAPTERS[provider];
    const { url, headers, body } = adapter.buildRequest(model, request, adapter.apiKey(env) ?? "");
    const response = await doFetch(url, {
      method: "POST",
      signal,
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      // The response body is intentionally not logged: providers may echo input.
      const message = `HTTP ${response.status}`;
      throw isProviderFatalStatus(response.status)
        ? new ProviderFatalError(message)
        : new Error(message);
    }
    const text = adapter.readText(await response.json());
    if (!text) throw new Error("empty completion");
    return text;
  }

  return {
    configured: providers.length > 0,

    async complete(request, parse) {
      if (providers.length === 0) throw new LlmUnavailableError("no provider configured");

      const deadline = AbortSignal.timeout(totalTimeoutMs);
      const failures: string[] = [];

      for (const provider of providers) {
        for (const model of modelChain(provider, env)) {
          if (deadline.aborted) break;
          try {
            const signal = AbortSignal.any([deadline, AbortSignal.timeout(attemptTimeoutMs)]);
            const text = await attempt(provider, model, request, signal);
            return { value: parse(text), provider, model };
          } catch (error) {
            failures.push(`${provider}/${model}: ${describeFailure(error)}`);
            if (error instanceof ProviderFatalError) break;
          }
        }
      }
      throw new LlmUnavailableError(failures.join(" | ") || "deadline exceeded");
    },
  };
}

/** Name the failure without echoing content, which could contain user text. */
function describeFailure(error: unknown): string {
  if (error instanceof SyntaxError) return "invalid JSON";
  if (error instanceof Error && /^(HTTP \d+|empty completion)$/.test(error.message)) {
    return error.message;
  }
  if (error instanceof Error && error.name === "TimeoutError") return "timeout";
  return "invalid output";
}

/** Best-effort extraction of a JSON object from model text (handles code fences). */
export function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fenced?.[1] ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  return JSON.parse(start >= 0 && end > start ? candidate.slice(start, end + 1) : candidate);
}
