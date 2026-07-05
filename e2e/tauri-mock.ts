// Fake Tauri IPC for the smoke ring: window.__TAURI_INTERNALS__ is defined
// BEFORE the app loads, so bridge.ts takes the desktop path and every invoke
// resolves from the fixture table below. Unknown commands resolve null (the
// app's callers uniformly .catch or tolerate empties). Every call is recorded
// on window.__invokeLog so tests can assert what a button actually invoked.
import type { Page } from "@playwright/test";

export const FIXTURES: Record<string, unknown> = {
  // boot / shell
  vault_status: { configured: true, path: "/tmp/smoke-vault", locked: false },
  // Boot spine: production mode + config.json vault is THE source of truth.
  engine_appmode_get: { mode: "production" },
  engine_config_vault: "/tmp/smoke-vault",
  vault_exists: true,
  bootstrap_vault: "/tmp/smoke-vault",
  engine_vault_status: { encrypted: false, unlocked: true },
  engine_vault_migrate_v4: { ok: true },
  bunker_status: { enabled: false, network_blocked: false, web_blocked: false, cloud_blocked: false, local_available: true },
  vault_lock_status: { enabled: true },
  machine_role_get: "hub",
  email_policy_get: { policy: "draft-others" },
  egress_guard_get: { mode: "on" },
  life_readiness: { life_readiness: 62, domains: [{ name: "career", score: 70 }, { name: "health", score: 54 }] },
  // scan_vault is THE domain loader (engine_domains was a wrong guess).
  scan_vault: [
    { name: "career", path: "/tmp/smoke-vault/career", has_state: true, state_preview: null },
    { name: "health", path: "/tmp/smoke-vault/health", has_state: true, state_preview: null },
  ],
  detect_clis: [{ id: "claude", label: "Claude Code", available: true, versions: [] }],
  engine_apps_list: [
    { id: "posthog", title: "PostHog", status: "authorized", domains: ["career"], integration: "mcp" },
    { id: "google-personal", title: "Google", status: "authorized", domains: ["health"], integration: "manual", account: { label: "personal", address: "me@example.com" } },
  ],
  // Needs You
  decisions_pending: [],
  engine_gws_pending_list: [
    { id: "gws_smoke1", domain: "career", summary: "Gmail: send", args: ["gmail", "+send", "--to", "x@y.com"], ts: Date.now() - 60000 },
  ],
  engine_acts_pending: [
    { id: "act_smoke1", domain: "business", summary: "PayPal: create_invoice", tool: "mcp__claude_ai_PayPal__create_invoice", argsJson: "{\"recipient_email\":\"client@corp.com\"}", categories: ["salary or compensation details"], ts: Date.now() - 30000 },
  ],
  loop_request_approval: "smoke-approval-token",
  engine_acts_approve: { ok: true },
  engine_gws_approve: { ok: true, output: "done" },
  // apps panel
  harness_connections_scan: { connections: [{ harness: "claude", name: "PostHog", health: "healthy" }] },
  ingestion_connector_catalog: { apps: [] },
  ingestion_connector_logos: {},
  discover_runtime_connectors: [],
  engine_list_archived: [],
  list_threads: [],
  usage_entries: [
    { ts: 1783200000000, day: "2026-07-05", session: "s1", domain: "career", surface: "chat", cli: "claude", model: "opus", input_tokens: 1200, output_tokens: 800, est_cost_usd: 0.12, host: "mbp" },
    { ts: 1783120000000, day: "2026-07-04", session: "s2", domain: "wealth", surface: "council", cli: "codex", model: "gpt", input_tokens: 400, output_tokens: 600, est_cost_usd: 0.03, host: "mini" },
    { ts: 1783040000000, day: "2026-07-03", session: "s3", domain: "career", surface: "benchmark", cli: "claude", model: "sonnet", input_tokens: 900, output_tokens: 300, est_cost_usd: 0.05, host: "mbp" },
  ],
};

export async function mockTauri(page: Page, overrides: Record<string, unknown> = {}): Promise<void> {
  const fixtures = { ...FIXTURES, ...overrides };
  await page.addInitScript((fx: Record<string, unknown>) => {
    // A configured vault is the app's boot gate (first-launch onboarding
    // otherwise): the desktop reads it from localStorage.
    localStorage.setItem("prevail.desktop.vaultPath", "/tmp/smoke-vault");
    localStorage.setItem("prevail.onboarding.seen", "1");
    localStorage.setItem("prevail.onboarding.encryptOffered", "1");
    const log: Array<{ cmd: string; args: unknown }> = [];
    (window as unknown as Record<string, unknown>).__invokeLog = log;
    let cb = 0;
    // The event plugin's unlisten path reaches this internal directly.
    (window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      transformCallback: () => ++cb,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      invoke: (cmd: string, args: unknown) => {
        log.push({ cmd, args });
        // Tauri plugin internals: event listeners return an id, everything
        // else falls through to fixtures.
        if (cmd.startsWith("plugin:event|")) return Promise.resolve(++cb);
        if (cmd.startsWith("plugin:")) return Promise.resolve(null);
        if (cmd in fx) {
          const v = fx[cmd];
          return Promise.resolve(typeof v === "function" ? (v as (a: unknown) => unknown)(args) : v);
        }
        return Promise.resolve(null);
      },
    };
  }, fixtures);
}

export async function invokedCommands(page: Page): Promise<string[]> {
  return page.evaluate(() => ((window as unknown as { __invokeLog: Array<{ cmd: string }> }).__invokeLog ?? []).map((e) => e.cmd));
}
