import { defineConfig } from "vite";

// Tauri expects a fixed dev port and must not have Vite clear its log output.
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "es2022", chunkSizeWarningLimit: 2000 },
  worker: { format: "es" },
});
