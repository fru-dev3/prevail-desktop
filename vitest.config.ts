import { defineConfig } from "vitest/config";

// Frontend unit/component tests (jsdom). Separate from the Vite app build config
// so it can't affect production bundling. Closes the audit's "zero frontend
// tests" gap (O102) and verifies the encryption-modal safety behavior headlessly.
export default defineConfig({
  test: {
    environment: "jsdom",
    // A concrete origin so jsdom's localStorage works (about:blank has none).
    environmentOptions: { jsdom: { url: "http://localhost/" } },
    setupFiles: ["./src/test-setup.ts"],
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
