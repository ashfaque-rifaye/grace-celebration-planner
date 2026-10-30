/**
 * Serve the built client from Node, with compression and long-lived caching for
 * fingerprinted assets. Hosted platforms such as Vercel do this themselves, which
 * is why it is separate from the core app.
 */
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";
import { compress } from "hono/compress";

const ONE_YEAR_SECONDS = 31_536_000;

export function withStaticFiles(app: Hono, root: string): Hono {
  app.use("*", compress());
  app.use("*", async (c, next) => {
    await next();
    if (!c.res.ok) return;
    if (c.req.path.startsWith("/assets/")) {
      c.header("Cache-Control", `public, max-age=${ONE_YEAR_SECONDS}, immutable`);
    } else {
      // The HTML names the fingerprinted assets, so it must always be revalidated.
      c.header("Cache-Control", "no-cache");
    }
  });
  app.use("*", serveStatic({ root }));
  return app;
}
