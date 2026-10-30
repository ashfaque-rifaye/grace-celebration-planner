/** Vercel function entry point: the same app as Node, with static files on the CDN. */
import { createConfiguredApp } from "../src/server/bootstrap.js";
import { loadConfig } from "../src/server/config.js";

const app = createConfiguredApp(loadConfig(process.env));

export const GET = (request: Request): Response | Promise<Response> => app.fetch(request);
export const POST = GET;
