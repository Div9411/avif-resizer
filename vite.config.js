// vite.config.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

export default defineConfig({
  plugins: [
    react(),
    wasm(), // Initialize WASM plugin
    topLevelAwait(), // Initialize top-level await plugin
  ],
  // Important: Prevent Vite from trying to optimize the WASM module itself
  optimizeDeps: {
    exclude: ["@jsquash/avif"],
  },
  server: {
    // Optional: Might help if there are issues with SharedArrayBuffer later
    // headers: {
    //   'Cross-Origin-Opener-Policy': 'same-origin',
    //   'Cross-Origin-Embedder-Policy': 'require-corp',
    // },
  },
});
