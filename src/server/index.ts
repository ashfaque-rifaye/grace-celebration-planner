/** Node entry point: load configuration, build the app, listen. */
import { serve } from "@hono/node-server";
import { createConfiguredApp } from "./bootstrap";
import { loadConfig } from "./config";
import { withStaticFiles } from "./static";

// Local convenience: load a gitignored .env (Node 20.12+). In production, real
// environment variables are set and this does nothing.
try {
  process.loadEnvFile(".env");
} catch {
  /* no .env file present: rely on real environment variables */
}

const config = loadConfig(process.env);
const app = withStaticFiles(createConfiguredApp(config), "./dist/client");

serve({ fetch: app.fetch, port: config.PORT }, ({ port }) => {
  console.warn(`Grace is listening on http://localhost:${port}`);
});
