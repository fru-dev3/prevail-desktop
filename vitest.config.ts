import { defineConfig } from "vitest/config";

// Frontend unit/component tests (jsdom). Separate from the Vite app build config
// so it can't affect production bundling. Closes the audit's "zero frontend
// tests" gap (O102) and verifies the encryption-modal safety behavior headlessly.
export default defineConfig({
  // The app build injects __APP_VERSION__ via Vite define; mirror it here so
  // components that import constants.ts render under jsdom instead of throwing
  // "__APP_VERSION__ is not defined".
  define: { __APP_VERSION__: JSON.stringify("test") },
  test: {
    environment: "jsdom",
    // A concrete origin so jsdom's localStorage works (about:blank has none).
    environmentOptions: { jsdom: { url: "http://localhost/" } },
    setupFiles: ["./src/test-setup.ts"],
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
