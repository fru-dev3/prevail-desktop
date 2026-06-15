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

  // Split the heavy third-party libraries into their own chunks so the app's
  // initial core stays small and vendors cache independently across releases.
  // Pairs with the React.lazy panel splitting in App.tsx: together they keep the
  // initial bundle (and live memory footprint) down.
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined;
          // Telemetry SDKs are dynamically imported (only on first opt-in send),
          // so they MUST get their own chunks — otherwise the catch-all "vendor"
          // below folds them into the eager startup bundle and every user, even
          // those who never enable telemetry, downloads ~450kB for nothing.
          if (id.includes("posthog-js")) return "vendor-posthog";
          // Match @sentry/* AND @sentry-internal/* (hyphen) so no Sentry submodule
          // leaks into the eager "vendor" chunk and creates a circular reference
          // that would drag the whole SDK in on startup.
          if (/[\\/]node_modules[\\/]@sentry/.test(id)) return "vendor-sentry";
          if (id.includes("framer-motion")) return "vendor-motion";
          if (id.includes("simple-icons")) return "vendor-simpleicons";
          if (id.includes("lucide-react")) return "vendor-lucide";
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return "vendor-react";
          if (id.includes("markdown") || id.includes("remark") || id.includes("micromark") || id.includes("mdast") || id.includes("hast") || id.includes("unist") || id.includes("unified")) return "vendor-markdown";
          return "vendor";
        },
      },
    },
  },

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
