/**
 * Pure provider and model selection policy for the LLM layer.
 *
 * Kept free of I/O so the failover rules (which provider goes first, which HTTP
 * statuses are worth retrying elsewhere, how a model chain is built) are
 * unit-tested without touching the network.
 */

export type LlmProvider = "gemini" | "fireworks";

export interface LlmEnv {
  GEMINI_API_KEY?: string | undefined;
  GEMINI_MODEL?: string | undefined;
  GEMINI_FALLBACK_MODEL?: string | undefined;
  FIREWORKS_API_KEY?: string | undefined;
  FIREWORKS_MODEL?: string | undefined;
  FIREWORKS_FALLBACK_MODEL?: string | undefined;
}

// Chosen by measurement on a free-tier key. The primary answers structured JSON in
// about 1.5 s. Free-tier quota is about 15 requests a minute per model, so the
// fallback must be a different model: this one keeps answering when the primary
// returns 429, where an alias such as gemini-flash-lite-latest did not.
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
const DEFAULT_GEMINI_FALLBACK_MODEL = "gemini-3.1-flash-lite";
const DEFAULT_FIREWORKS_MODEL = "accounts/fireworks/models/gpt-oss-120b";
const DEFAULT_FIREWORKS_FALLBACK_MODEL = "accounts/fireworks/models/glm-5p2";

/** Providers to try, in order. One with no key is skipped, not attempted. */
export function configuredProviders(env: LlmEnv): LlmProvider[] {
  const providers: LlmProvider[] = [];
  if (env.GEMINI_API_KEY?.trim()) providers.push("gemini");
  if (env.FIREWORKS_API_KEY?.trim()) providers.push("fireworks");
  return providers;
}

/**
 * Statuses where trying another model on the same provider cannot help: bad
 * credentials or a malformed request. The next provider is still tried, since it
 * has different credentials. Everything else (408, 429, 5xx, and 404 for a retired
 * model) moves on to the next model. A free-tier key answering 429 must not
 * collapse straight to the offline planner.
 */
export function isProviderFatalStatus(status: number): boolean {
  return status === 400 || status === 401 || status === 403;
}

/** Ordered, de-duplicated model chain for a provider. */
export function modelChain(provider: LlmProvider, env: LlmEnv): string[] {
  const [primary, fallback] =
    provider === "gemini"
      ? [
          env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL,
          env.GEMINI_FALLBACK_MODEL?.trim() || DEFAULT_GEMINI_FALLBACK_MODEL,
        ]
      : [
          env.FIREWORKS_MODEL?.trim() || DEFAULT_FIREWORKS_MODEL,
          env.FIREWORKS_FALLBACK_MODEL?.trim() || DEFAULT_FIREWORKS_FALLBACK_MODEL,
        ];
  return [...new Set([primary, fallback])];
}
