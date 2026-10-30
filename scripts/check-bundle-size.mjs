// Fail the build if the JavaScript sent to the browser grows past its budget.
// Budgets are in gzipped bytes, which is what actually crosses the network.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const ASSETS = "dist/client/assets";
const BUDGET = { entry: 130 * 1024, total: 190 * 1024 };

const html = readFileSync("dist/client/index.html", "utf8");
const entryName = /assets\/([^"]+\.js)/.exec(html)?.[1];
if (!entryName) throw new Error("Could not find the entry script in index.html");

const scripts = readdirSync(ASSETS).filter((name) => name.endsWith(".js"));
const size = (name) => gzipSync(readFileSync(join(ASSETS, name))).length;
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;

const entry = size(entryName);
const total = scripts.reduce((sum, name) => sum + size(name), 0);

for (const name of scripts) console.log(`${kb(size(name)).padStart(9)}  ${name}`);
console.log(`Entry ${kb(entry)} (budget ${kb(BUDGET.entry)})`);
console.log(`Total ${kb(total)} (budget ${kb(BUDGET.total)})`);

if (entry > BUDGET.entry || total > BUDGET.total) {
  console.error("Bundle budget exceeded.");
  process.exit(1);
}
