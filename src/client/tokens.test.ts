import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * WCAG contrast of the design tokens, in both colour schemes. Doing this at the
 * token level catches a bad colour for every component that uses it.
 */
const css = readFileSync("src/client/styles.css", "utf8");

function tokensIn(block: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const match of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6});/g)) {
    if (match[1] && match[2]) tokens[match[1]] = match[2];
  }
  return tokens;
}

const lightBlock = /:root\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
const darkBlock =
  /prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([\s\S]*?)\n {2}\}/.exec(css)?.[1] ?? "";
const light = tokensIn(lightBlock);
const dark = tokensIn(darkBlock);

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
  const [r = 0, g = 0, b = 0] = channels.map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT_PAIRS: readonly [string, string][] = [
  ["text", "bg"],
  ["text", "surface"],
  ["text", "surface-ai"],
  ["muted", "bg"],
  ["muted", "surface"],
  ["muted", "surface-ai"],
  ["accent-text", "bg"],
  ["accent-text", "surface"],
  ["accent-text", "surface-ai"],
  ["brand-contrast", "brand"],
  ["brand-contrast", "brand-2"],
  ["muted", "surface-soft"],
  ["text", "surface-soft"],
  ["danger", "surface"],
  ["danger", "danger-surface"],
  ["ok", "ok-surface"],
  ["ok", "surface"],
  ["warn", "warn-surface"],
];

// WCAG 1.4.11: controls, focus rings and meaningful graphics need 3:1.
const NON_TEXT_PAIRS: readonly [string, string][] = [
  ["control-border", "surface"],
  ["control-border", "bg"],
  ["focus", "bg"],
  ["focus", "surface"],
  ["bar", "bar-track"],
];

describe.each([
  ["light", light],
  ["dark", dark],
])("%s theme", (_name, tokens) => {
  it("defines the tokens under test", () => {
    expect(Object.keys(tokens).length).toBeGreaterThan(15);
  });

  it.each(TEXT_PAIRS)("%s on %s meets 4.5:1", (foreground, background) => {
    const ratio = contrast(tokens[foreground] ?? "", tokens[background] ?? "");
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it.each(NON_TEXT_PAIRS)("%s against %s meets 3:1", (foreground, background) => {
    const ratio = contrast(tokens[foreground] ?? "", tokens[background] ?? "");
    expect(ratio).toBeGreaterThanOrEqual(3);
  });
});

describe("hero gradients", () => {
  const stops = [...css.matchAll(/--hero-(?:start|mid|end):\s*(#[0-9a-f]{6});/g)].map((m) => m[1]);

  it("are defined for every event type and the home page", () => {
    expect(stops.length).toBeGreaterThanOrEqual(12);
  });

  it.each(stops)("white text on %s meets 4.5:1", (stop) => {
    expect(contrast("#ffffff", stop ?? "")).toBeGreaterThanOrEqual(4.5);
  });

  it.each(stops)("gold accent text on %s meets 4.5:1 at the dark stops", (stop) => {
    // The gold eyebrow sits at the start of the gradient, on the darker stops.
    if (stops.indexOf(stop) % 3 !== 2) {
      expect(contrast("#f6c667", stop ?? "")).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("user preferences", () => {
  it("honours reduced motion, forced colours and print", () => {
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain("forced-colors: active");
    expect(css).toContain("@media print");
  });
});
