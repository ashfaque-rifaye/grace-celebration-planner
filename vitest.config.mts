import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    // Logic tests run in Node; component tests opt into jsdom with a
    // `@vitest-environment jsdom` docblock, so the fast suite stays fast.
    environment: "node",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "text", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/test/**",
        // One-line process entry points: they only wire up what is tested elsewhere.
        "src/client/main.tsx",
        "src/server/index.ts",
      ],
      thresholds: { lines: 95, statements: 95, functions: 95, branches: 90 },
    },
  },
});
