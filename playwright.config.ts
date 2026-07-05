// The desktop smoke ring (G2): the five load-bearing screens rendered by the
// REAL frontend bundle with the Tauri IPC mocked (e2e/tauri-mock.ts). This is
// deliberately not a full Tauri e2e (tauri-driver has no macOS support): it
// catches React regressions - broken screens, dead buttons, crashed sections -
// which is where the desktop was shipping blind. Runs in release CI before the
// tag builds.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://localhost:1420",
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: "bunx vite --port 1420 --strictPort",
    url: "http://localhost:1420",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
