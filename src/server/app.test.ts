import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { clientKey, createApp, MAX_BODY_BYTES } from "./app";
import { createAiService, type AiService } from "./ai/service";
import type { LlmClient } from "./ai/llm";
import { createConfiguredApp } from "./bootstrap";
import { loadConfig } from "./config";
import { CONTENT_SECURITY_POLICY, SECURITY_HEADERS } from "./security-headers";
import { withStaticFiles } from "./static";

const offlineLlm: LlmClient = {
  configured: false,
  complete: () => Promise.reject(new Error("unused")),
};

function makeApp(ai?: AiService, trustedProxyHops = 1) {
  return createApp({
    ai: ai ?? createAiService({ llm: offlineLlm, ratePerMinute: 5, globalPerHour: 5 }),
    aiConfigured: false,
    trustedProxyHops,
  });
}

function post(body: unknown, headers: Record<string, string> = {}, path = "/api/ai/brief") {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("clientKey", () => {
  it("does not trust the spoofable left end of X-Forwarded-For", () => {
    expect(clientKey("spoofed, 203.0.113.9", 1)).toBe("203.0.113.9");
    expect(clientKey("spoofed, 203.0.113.9, 10.0.0.1", 2)).toBe("203.0.113.9");
  });

  it("ignores the header when no proxy is trusted", () => {
    expect(clientKey("1.2.3.4", 0)).toBe("direct");
  });

  it("handles a missing or short header", () => {
    expect(clientKey(undefined, 1)).toBe("direct");
    expect(clientKey("", 1)).toBe("direct");
    expect(clientKey("1.2.3.4", 3)).toBe("1.2.3.4");
    expect(clientKey(" , ", 1)).toBe("direct");
  });
});

describe("API", () => {
  it("reports health without revealing configuration details", async () => {
    const res = await makeApp().request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", aiConfigured: false });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("answers an AI request end to end", async () => {
    const res = await makeApp().fetch(post({ text: "a birthday for 20 people" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string; data: { brief: { guests: number } } };
    expect(body.source).toBe("fallback");
    expect(body.data.brief.guests).toBe(20);
  });

  it("refuses an unknown feature", async () => {
    const res = await makeApp().fetch(post({}, {}, "/api/ai/launch-missiles"));
    expect(res.status).toBe(404);
  });

  it("refuses the wrong content type", async () => {
    const res = await makeApp().fetch(post({}, { "content-type": "text/plain" }));
    expect(res.status).toBe(415);
  });

  it("refuses malformed JSON", async () => {
    const res = await makeApp().fetch(post("{not json"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Malformed JSON" });
  });

  it("reports which fields are invalid, and never their values", async () => {
    const res = await makeApp().fetch(post({ text: "" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid request", fields: ["text"] });
  });

  it("refuses an oversized body", async () => {
    const res = await makeApp().fetch(post({ text: "x".repeat(MAX_BODY_BYTES + 1) }));
    expect(res.status).toBe(413);
  });

  it("refuses a request from another site", async () => {
    const res = await makeApp().fetch(post({ text: "party" }, { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
  });

  it("refuses an unparseable origin", async () => {
    const res = await makeApp().fetch(post({ text: "party" }, { origin: "null" }));
    expect(res.status).toBe(403);
  });

  it("accepts a same-origin request, including behind a proxy", async () => {
    const direct = await makeApp().fetch(post({ text: "party" }, { origin: "http://localhost" }));
    expect(direct.status).toBe(200);
    const proxied = await makeApp().fetch(
      post(
        { text: "party" },
        { origin: "https://grace.example", "x-forwarded-host": "grace.example" },
      ),
    );
    expect(proxied.status).toBe(200);
  });

  it("answers 429 with Retry-After and a usable fallback", async () => {
    const ai: AiService = {
      run: vi.fn(async () => ({
        envelope: {
          data: { brief: {}, assumptions: [], questions: [], reasoning: "r" },
          source: "fallback" as const,
          sanitized: false,
          cached: false,
          fallbackReason: "rate-limited" as const,
        },
        retryAfterSeconds: 7,
      })) as AiService["run"],
    };
    const res = await makeApp(ai).fetch(post({ text: "party" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("7");
    expect(await res.json()).toMatchObject({ fallbackReason: "rate-limited" });
  });

  it("rate limits on the trusted address, not a spoofed one", async () => {
    const run = vi.fn(async () => ({
      envelope: {
        data: { brief: {}, assumptions: [], questions: [], reasoning: "r" },
        source: "fallback" as const,
        sanitized: false,
        cached: false,
      },
    }));
    await makeApp({ run: run as unknown as AiService["run"] }).fetch(
      post({ text: "party" }, { "x-forwarded-for": "fake, 203.0.113.9" }),
    );
    expect(run.mock.calls[0]).toEqual(["brief", { text: "party" }, "203.0.113.9"]);
  });

  it("hides internal errors from the response", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const ai: AiService = { run: () => Promise.reject(new TypeError("secret stack detail")) };
    const res = await makeApp(ai).fetch(post({ text: "party" }));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("secret");
    error.mockRestore();
  });

  it("returns JSON for an unknown path", async () => {
    const res = await makeApp().request("/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });
});

describe("security headers", () => {
  it.each(["/api/health", "/api/nope"])("are set on %s", async (path) => {
    const res = await makeApp().request(path);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(res.headers.get(name)).toBe(value);
    }
  });

  it("use a strict CSP with no unsafe sources", () => {
    expect(CONTENT_SECURITY_POLICY).toContain("default-src 'none'");
    expect(CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
    expect(CONTENT_SECURITY_POLICY).not.toContain("unsafe");
    expect(CONTENT_SECURITY_POLICY).not.toContain("*");
  });

  it("stay in step with vercel.json for statically hosted files", () => {
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      headers: { source: string; headers: { key: string; value: string }[] }[];
    };
    const deployed = Object.fromEntries(
      vercel.headers
        .flatMap((rule) => rule.headers)
        .filter(({ key }) => key !== "Cache-Control")
        .map(({ key, value }) => [key, value]),
    );
    expect(deployed).toEqual(SECURITY_HEADERS);
  });
});

describe("configuration", () => {
  it("uses safe defaults", () => {
    expect(loadConfig({})).toMatchObject({
      PORT: 8787,
      TRUSTED_PROXY_HOPS: 1,
      AI_RATE_LIMIT_PER_MINUTE: 20,
      AI_GLOBAL_LIMIT_PER_HOUR: 600,
    });
  });

  it("reads overrides and falls back on nonsense values", () => {
    const config = loadConfig({ PORT: "3000", AI_RATE_LIMIT_PER_MINUTE: "lots" });
    expect(config.PORT).toBe(3000);
    expect(config.AI_RATE_LIMIT_PER_MINUTE).toBe(20);
  });

  it("wires a working app together", async () => {
    const app = createConfiguredApp(loadConfig({}));
    const res = await app.request("/api/health");
    expect(await res.json()).toEqual({ status: "ok", aiConfigured: false });
  });

  it("reports when a key is configured, without revealing it", async () => {
    const app = createConfiguredApp(loadConfig({ GEMINI_API_KEY: "super-secret" }));
    const text = await (await app.request("/api/health")).text();
    expect(text).toContain('"aiConfigured":true');
    expect(text).not.toContain("super-secret");
  });

  it("uses the injected fetch for the model", async () => {
    const reply = JSON.stringify({ brief: {}, assumptions: [], questions: [], reasoning: "r" });
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: reply }] } }] })),
    );
    const app = createConfiguredApp(loadConfig({ GEMINI_API_KEY: "k" }), fetchMock);
    const res = await app.fetch(post({ text: "a party" }));
    expect(await res.json()).toMatchObject({ source: "gemini" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe("static files", () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-static-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>Grace</title>");
  writeFileSync(join(dir, "assets", "app-abc123.js"), "console.warn('hi');");
  const root = relative(process.cwd(), dir);
  const app = withStaticFiles(makeApp(), root);

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("serves the page with revalidation and security headers", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Grace");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("content-security-policy")).toBe(CONTENT_SECURITY_POLICY);
  });

  it("caches fingerprinted assets for a year", async () => {
    const res = await app.request("/assets/app-abc123.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("immutable");
  });

  it("does not serve files outside the root", async () => {
    const res = await app.request("/../package.json");
    expect(res.status).toBe(404);
  });

  it("leaves the API working", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
  });
});
