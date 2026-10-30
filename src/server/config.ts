/**
 * Server configuration, parsed once from the environment.
 *
 * This is the only module that interprets environment variables, and it is only
 * reachable from server code. Nothing under `src/client` or `src/shared` imports
 * it, which is what keeps API keys out of the browser bundle.
 */
import { z } from "zod";

const intFromEnv = (fallback: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).catch(fallback).default(fallback);

const envSchema = z.object({
  PORT: intFromEnv(8787, 1, 65_535),
  /** How many trusted proxies append to X-Forwarded-For. 0 means ignore the header. */
  TRUSTED_PROXY_HOPS: intFromEnv(1, 0, 5),
  AI_RATE_LIMIT_PER_MINUTE: intFromEnv(20, 1, 1000),
  AI_GLOBAL_LIMIT_PER_HOUR: intFromEnv(600, 1, 100_000),
  GEMINI_API_KEY: z.string().trim().optional(),
  GEMINI_MODEL: z.string().trim().optional(),
  GEMINI_FALLBACK_MODEL: z.string().trim().optional(),
  FIREWORKS_API_KEY: z.string().trim().optional(),
  FIREWORKS_MODEL: z.string().trim().optional(),
  FIREWORKS_FALLBACK_MODEL: z.string().trim().optional(),
});

export type ServerConfig = z.infer<typeof envSchema>;

export function loadConfig(env: Record<string, string | undefined>): ServerConfig {
  return envSchema.parse(env);
}
