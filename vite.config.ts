import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { version } from "./package.json";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  // package.json is the canonical version (bumped each release alongside
  // tauri.conf.json/Cargo.toml); injecting it here keeps the UI chip and
  // update check from drifting the way a hand-stamped constant did.
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  plugins: [
    react(),
    // Tauri's custom asset protocol can refuse to execute `crossorigin`
    // module scripts (silent blank window). Strip the attribute.
    {
      name: "tauri-strip-crossorigin",
      transformIndexHtml: {
        order: "post" as const,
        handler: (html: string) => html.replace(/\scrossorigin/g, ""),
      },
    },
  ],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
