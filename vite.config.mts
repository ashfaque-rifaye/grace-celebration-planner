import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    sourcemap: false,
    // Inlined fonts would be data: URIs, which the strict CSP rightly blocks.
    assetsInlineLimit: 0,
  },
  server: {
    port: 5173,
    // In development the API runs separately; in production it serves this bundle.
    proxy: { "/api": "http://localhost:8787" },
  },
});
