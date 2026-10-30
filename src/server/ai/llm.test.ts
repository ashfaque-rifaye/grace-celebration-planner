import { describe, expect, it, vi } from "vitest";
import { createLlmClient, extractJson, LlmUnavailableError } from "./llm";
import {
  configuredProviders,
  DEFAULT_GEMINI_MODEL,
  isProviderFatalStatus,
  modelChain,
} from "./llm-policy";

const REQUEST = { system: "sys", user: "usr", maxTokens: 100, temperature: 0.2 };
const passthrough = (text: string) => text;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

const geminiOk = (text: string) => json({ candidates: [{ content: { parts: [{ text }] } }] });
const fireworksOk = (text: string) => json({ choices: [{ message: { content: text } }] });

const ENV = { GEMINI_API_KEY: "g-key", FIREWORKS_API_KEY: "f-key" };

describe("policy", () => {
  it("skips providers with no key or a blank key", () => {
    expect(configuredProviders({})).toEqual([]);
    expect(configuredProviders({ GEMINI_API_KEY: "   " })).toEqual([]);
    expect(configuredProviders({ FIREWORKS_API_KEY: "x" })).toEqual(["fireworks"]);
    expect(configuredProviders(ENV)).toEqual(["gemini", "fireworks"]);
  });

  it("treats only credential and request errors as provider-fatal", () => {
    expect([400, 401, 403].every(isProviderFatalStatus)).toBe(true);
    expect([404, 408, 429, 500, 503].some(isProviderFatalStatus)).toBe(false);
  });

  it("builds a de-duplicated model chain with overrides", () => {
    expect(modelChain("gemini", {})[0]).toBe(DEFAULT_GEMINI_MODEL);
    expect(modelChain("gemini", { GEMINI_MODEL: "a", GEMINI_FALLBACK_MODEL: "a" })).toEqual(["a"]);
    expect(
      modelChain("fireworks", { FIREWORKS_MODEL: "x", FIREWORKS_FALLBACK_MODEL: "y" }),
    ).toEqual(["x", "y"]);
    expect(modelChain("fireworks", {})).toHaveLength(2);
  });
});

describe("createLlmClient", () => {
  it("reports whether any provider is configured", () => {
    expect(createLlmClient({}).configured).toBe(false);
    expect(createLlmClient(ENV).configured).toBe(true);
  });

  it("refuses to run with no provider", async () => {
    await expect(createLlmClient({}).complete(REQUEST, passthrough)).rejects.toBeInstanceOf(
      LlmUnavailableError,
    );
  });

  it("calls Gemini first and names who answered", async () => {
    const fetchMock = vi.fn(async () => geminiOk('{"ok":true}'));
    const client = createLlmClient(ENV, { fetch: fetchMock });
    const result = await client.complete(REQUEST, passthrough);
    expect(result).toMatchObject({ value: '{"ok":true}', provider: "gemini" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("sends the Gemini key in a header, never in the URL", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => geminiOk("x"));
    await createLlmClient(ENV, { fetch: fetchMock }).complete(REQUEST, passthrough);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).not.toContain("g-key");
    expect((init?.headers as Record<string, string>)["x-goog-api-key"]).toBe("g-key");
  });

  it("keeps untrusted text out of the system instruction", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => geminiOk("x"));
    await createLlmClient(ENV, { fetch: fetchMock }).complete(REQUEST, passthrough);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      systemInstruction: { parts: { text: string }[] };
      contents: { role: string; parts: { text: string }[] }[];
    };
    expect(body.systemInstruction.parts[0]?.text).toBe("sys");
    expect(body.contents[0]).toEqual({ role: "user", parts: [{ text: "usr" }] });
  });

  it("ignores Gemini thought parts", async () => {
    const fetchMock = vi.fn(async () =>
      json({
        candidates: [{ content: { parts: [{ text: "hmm", thought: true }, { text: "answer" }] } }],
      }),
    );
    const result = await createLlmClient(ENV, { fetch: fetchMock }).complete(REQUEST, passthrough);
    expect(result.value).toBe("answer");
  });

  it("moves to the next model on a 429, which is what a free tier returns", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({}, 429))
      .mockResolvedValueOnce(geminiOk("second"));
    const result = await createLlmClient(ENV, { fetch: fetchMock }).complete(REQUEST, passthrough);
    expect(result.value).toBe("second");
    expect(result.provider).toBe("gemini");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("moves to the next model on a 404 from a retired model", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({}, 404))
      .mockResolvedValueOnce(geminiOk("second"));
    const result = await createLlmClient(ENV, { fetch: fetchMock }).complete(REQUEST, passthrough);
    expect(result.value).toBe("second");
  });

  it("skips a provider's other models on a bad key, but still tries the next provider", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({}, 403))
      .mockResolvedValueOnce(fireworksOk("from fireworks"));
    const result = await createLlmClient(ENV, { fetch: fetchMock }).complete(REQUEST, passthrough);
    expect(result).toMatchObject({ value: "from fireworks", provider: "fireworks" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("treats invalid output as a failed attempt and tries the next model", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(geminiOk("not json at all"))
      .mockResolvedValueOnce(geminiOk('{"good":1}'));
    const parse = (text: string) => extractJson(text);
    const result = await createLlmClient(ENV, { fetch: fetchMock }).complete(REQUEST, parse);
    expect(result.value).toEqual({ good: 1 });
  });

  it("treats an empty completion as a failed attempt", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ candidates: [] }))
      .mockResolvedValueOnce(geminiOk("ok"));
    const result = await createLlmClient(ENV, { fetch: fetchMock }).complete(REQUEST, passthrough);
    expect(result.value).toBe("ok");
  });

  it("reports every failure, without echoing content, when all providers fail", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json({ secret: "user text" }, 500));
    const client = createLlmClient(ENV, { fetch: fetchMock });
    const error = await client.complete(REQUEST, passthrough).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LlmUnavailableError);
    expect((error as Error).message).toContain("HTTP 500");
    expect((error as Error).message).not.toContain("user text");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("names schema failures without echoing what the model said", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => geminiOk("private output"));
    const client = createLlmClient({ GEMINI_API_KEY: "k" }, { fetch: fetchMock });
    const error = await client
      .complete(REQUEST, () => {
        throw new Error("private output");
      })
      .catch((e: unknown) => e as Error);
    expect((error as Error).message).toContain("invalid output");
    expect((error as Error).message).not.toContain("private output");
  });

  it("times out a hung model and moves on", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((resolve, reject) => {
          if (fetchMock.mock.calls.length > 1) {
            resolve(geminiOk("second"));
            return;
          }
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason as Error));
        }),
    );
    const client = createLlmClient(
      { GEMINI_API_KEY: "k" },
      { fetch: fetchMock, attemptTimeoutMs: 10 },
    );
    const result = await client.complete(REQUEST, passthrough);
    expect(result.value).toBe("second");
  });

  it("stops the chain at the overall deadline", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason as Error));
        }),
    );
    const client = createLlmClient(ENV, {
      fetch: fetchMock,
      attemptTimeoutMs: 1000,
      totalTimeoutMs: 15,
    });
    const error = await client.complete(REQUEST, passthrough).catch((e: unknown) => e as Error);
    expect(error).toBeInstanceOf(LlmUnavailableError);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect((error as Error).message).toContain("timeout");
  });
});

describe("extractJson", () => {
  it("parses plain, fenced and embedded JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! {"a":1} done')).toEqual({ a: 1 });
  });

  it("throws on text with no JSON", () => {
    expect(() => extractJson("no json here")).toThrow(SyntaxError);
  });
});
