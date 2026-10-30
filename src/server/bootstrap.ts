/**
 * Wire the real dependencies together from configuration. Shared by the Node
 * entry point and the Vercel function so both run the same app.
 */
import type { Hono } from "hono";
import { createApp } from "./app.js";
import { createLlmClient } from "./ai/llm.js";
import { createAiService } from "./ai/service.js";
import type { ServerConfig } from "./config.js";

export function createConfiguredApp(config: ServerConfig, fetchImpl?: typeof fetch): Hono {
  const llm = createLlmClient(config, fetchImpl ? { fetch: fetchImpl } : {});
  const ai = createAiService({
    llm,
    ratePerMinute: config.AI_RATE_LIMIT_PER_MINUTE,
    globalPerHour: config.AI_GLOBAL_LIMIT_PER_HOUR,
  });
  return createApp({
    ai,
    aiConfigured: llm.configured,
    trustedProxyHops: config.TRUSTED_PROXY_HOPS,
  });
}
