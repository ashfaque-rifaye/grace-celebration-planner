/**
 * HTTP surface of the app, independent of how it is hosted.
 *
 * Nothing here touches the filesystem or a socket, so the same app runs on Node,
 * on Vercel, and inside tests through `app.request()`.
 */
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { AI_FEATURE_NAMES, type AiFeatureName } from "../shared/contracts";
import { InvalidInputError, type AiService } from "./ai/service";
import { SECURITY_HEADERS } from "./security-headers";

/** Well above the largest valid payload (a brief plus a full plan context). */
export const MAX_BODY_BYTES = 64 * 1024;

export interface AppOptions {
  ai: AiService;
  aiConfigured: boolean;
  trustedProxyHops: number;
}

/**
 * Identify the caller for rate limiting. The left end of X-Forwarded-For is
 * client-controlled, so we count back from the right by the number of proxies we
 * actually trust. Taking the first entry would let anyone reset their limit by
 * sending a fake header.
 */
export function clientKey(forwardedFor: string | undefined, trustedHops: number): string {
  if (!forwardedFor || trustedHops <= 0) return "direct";
  const chain = forwardedFor
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return chain[chain.length - trustedHops] ?? chain[0] ?? "direct";
}

/** Cookie-free API, but this stops other sites spending our quota from a browser. */
function isCrossOrigin(c: Context): boolean {
  const origin = c.req.header("origin");
  if (!origin) return false;
  const host = c.req.header("x-forwarded-host") ?? c.req.header("host");
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

function isFeature(name: string): name is AiFeatureName {
  return (AI_FEATURE_NAMES as readonly string[]).includes(name);
}

export function createApp({ ai, aiConfigured, trustedProxyHops }: AppOptions): Hono {
  const app = new Hono();

  app.use("*", async (c, next) => {
    await next();
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) c.header(name, value);
  });

  app.use("/api/*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  });

  app.get("/api/health", (c) => c.json({ status: "ok", aiConfigured }));

  app.post(
    "/api/ai/:feature",
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => c.json({ error: "Request too large" }, 413),
    }),
    async (c) => {
      if (isCrossOrigin(c)) return c.json({ error: "Cross-origin request refused" }, 403);

      const feature = c.req.param("feature");
      if (!isFeature(feature)) return c.json({ error: "Unknown feature" }, 404);

      if (!c.req.header("content-type")?.toLowerCase().startsWith("application/json")) {
        return c.json({ error: "Expected application/json" }, 415);
      }

      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "Malformed JSON" }, 400);
      }

      try {
        const key = clientKey(c.req.header("x-forwarded-for"), trustedProxyHops);
        const { envelope, retryAfterSeconds } = await ai.run(feature, body, key);
        if (retryAfterSeconds !== undefined) {
          // 429 for clients that care, with a usable answer for the person waiting.
          c.header("Retry-After", String(retryAfterSeconds));
          return c.json(envelope, 429);
        }
        return c.json(envelope);
      } catch (error) {
        if (error instanceof InvalidInputError) {
          return c.json({ error: "Invalid request", fields: error.fields }, 400);
        }
        throw error;
      }
    },
  );

  app.notFound((c) => c.json({ error: "Not found" }, 404));

  app.onError((error, c) => {
    // Details stay in the server log, so internals never reach the response.
    console.error(`[app] ${error.name}`);
    return c.json({ error: "Something went wrong" }, 500);
  });

  return app;
}
