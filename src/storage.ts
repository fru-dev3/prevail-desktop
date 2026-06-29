// Local-storage + cross-device prefs layer extracted from App.tsx.
import { invoke, isBrowser } from "./bridge";
import { domainTogglesKey } from "./helpers";
import type { DomainToggle } from "./types";

export const LS = {
  vault: "prevail.desktop.vaultPath",
  theme: "prevail.desktop.theme",
  palette: "prevail.desktop.palette",
  framework: "prevail.desktop.framework",
  lens: "prevail.desktop.lens",
  defaultChatCli: "prevail.desktop.defaultChatCli",
  defaultChairCli: "prevail.desktop.defaultChairCli",
  telegramToken: "prevail.desktop.telegramToken",
  telegramChatId: "prevail.desktop.telegramChatId",
  whatsappNumber: "prevail.desktop.whatsappNumber",
  mcpEnabled: "prevail.desktop.mcpEnabled",
  vaultProduction: "prevail.desktop.vaultProduction", // remembered own-vault path for demo<->production round-trips
} as const;

// Per-domain toggles mirroring the CLI status bar:
// council on/off · web access · save replies · serendipity · auto-council.
// `null` / "" domain means General — it gets its own bucket so the modes
// persist there too.
export function getDomainToggle(domain: string | null, t: DomainToggle, fallback: boolean): boolean {
  const raw = lsGet(domainTogglesKey(domain, t));
  if (raw === "") return fallback;
  return raw === "1";
}
export function setDomainToggle(domain: string | null, t: DomainToggle, v: boolean): void {
  lsSet(domainTogglesKey(domain, t), v ? "1" : "0");
}

export function lsGet(key: string, fallback: string = ""): string {
  return localStorage.getItem(key) ?? fallback;
}
export function lsSet(key: string, value: string): void {
  if (value) localStorage.setItem(key, value);
  else localStorage.removeItem(key);
  if (typeof key === "string" && key.startsWith("prevail.")) scheduleUiPrefsPush();
}

// Bunker Mode mirror. The backend (bunker.rs) is the source of truth and enforces
// at the execution layer; this localStorage mirror lets deeply-nested components
// (composer, model pickers, send/convene) read the flag synchronously without
// prop-threading through the tree. Kept in sync from bunker_status on mount and on
// every toggle. Default ON: absent flag ⇒ locked down (matches bunker.rs default).
export const BUNKER_LS = "prevail.pref.bunkerMode";
export function isBunkerOn(): boolean {
  return lsGet(BUNKER_LS, "1") !== "0";
}

// ── Cross-device UI prefs sync ───────────────────────────────────────────────
// Pins, model picks, and per-domain toggles live in per-surface localStorage,
// so the WebUI used to start blank versus the desktop. We mirror the syncable
// prevail.* keys through a backend blob (ui_prefs_get/set): the desktop pushes
// its working state; the browser hydrates from it on boot. Device-specific and
// sensitive keys are excluded.
const UI_PREFS_EXCLUDE_PREFIX = [
  "prevail.desktop.vaultPath", "prevail.desktop.vaultProduction", "prevail.web.",
  "prevail.about.", "prevail.backup.", "prevail.bench.schedule.", "prevail.desktop.theme",
  "prevail.desktop.palette",
  // Credentials must never replicate off-device through the synced prefs blob
  // (O13): the WebUI login is a remote control-plane password.
  "prevail.pref.webuiPass", "prevail.pref.webuiUser",
  // The profile registry is machine-local: it maps profiles to device-specific
  // vault paths and holds passcode hashes (a credential). Never replicate it.
  "prevail.profiles",
];
export function isSyncablePrefKey(k: string): boolean {
  if (!k.startsWith("prevail.")) return false;
  return !UI_PREFS_EXCLUDE_PREFIX.some((p) => k.startsWith(p));
}
export function snapshotUiPrefs(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && isSyncablePrefKey(k)) out[k] = localStorage.getItem(k) ?? "";
  }
  return out;
}
let uiPrefsPushTimer: number | null = null;
// Desktop: debounce-push the syncable prefs whenever they change.
export function scheduleUiPrefsPush() {
  if (isBrowser()) return;
  if (uiPrefsPushTimer !== null) window.clearTimeout(uiPrefsPushTimer);
  uiPrefsPushTimer = window.setTimeout(() => {
    void invoke("ui_prefs_set", { json: JSON.stringify(snapshotUiPrefs()) }).catch(() => {});
  }, 1500);
}
// Browser: hydrate localStorage from the desktop's pushed prefs before the app
// reads them. Returns a promise so boot can await it.
export async function hydrateUiPrefs(): Promise<void> {
  if (!isBrowser()) return;
  try {
    const raw = await invoke<string>("ui_prefs_get");
    const obj = JSON.parse(raw || "{}") as Record<string, string>;
    for (const [k, v] of Object.entries(obj)) {
      if (isSyncablePrefKey(k) && localStorage.getItem(k) === null) localStorage.setItem(k, v);
    }
  } catch { /* offline / first run */ }
}

export const PREF = {
  sendKey: "prevail.pref.sendKey",                  // "enter" | "cmd-enter"
  desktopNotif: "prevail.pref.desktopNotif",        // "1" | "0"
  closeToTray: "prevail.pref.closeToTray",          // "1" | "0" — hide to tray on window close
  soundOnDone: "prevail.pref.soundOnDone",          // "1" | "0"
  autoConvertLongPaste: "prevail.pref.autoConvertLongPaste", // "1" | "0"
  stripSycophancy: "prevail.pref.stripSycophancy",  // "1" | "0"
  alwaysShowContextUsage: "prevail.pref.alwaysShowContextUsage", // "1" | "0"
  dontCollapseToolCalls: "prevail.pref.dontCollapseToolCalls",   // "1" | "0"
  showThinking: "prevail.pref.showThinking",        // "1" | "0" — show model <think> reasoning
  // System — hard caps on CLI runs so a stuck process doesn't hang
  // the UI forever. Read by send() and passed to the Rust spawner.
  llmPromptTimeoutSec: "prevail.pref.llmPromptTimeoutSec",   // integer seconds
  streamStallTimeoutSec: "prevail.pref.streamStallTimeoutSec", // integer seconds — no chunks for this long → kill
  // Home screen — show the proactive Briefing/recommendations panel. Off by
  // default so the landing stays minimal; the user opts in from General.
  showHomeBriefing: "prevail.pref.showHomeBriefing",       // "1" | "0" — default "0" (hidden)
  // Budget — a soft monthly USD cap the user sets, plus the running spend
  // estimate. Display-only until the engine exposes a budget status command.
  budgetMonthlyCapUsd: "prevail.pref.budgetMonthlyCapUsd", // decimal USD, "" = no cap
  budgetSpentUsd: "prevail.pref.budgetSpentUsd",           // decimal USD estimate
  // Memory & Context — the self-learning layer. Persistent memory distills the
  // intent ledger into <vault>/<domain>/_memory.md and prepends it to prompts.
  persistentMemory: "prevail.pref.persistentMemory",       // "1" | "0" — master switch
  userProfile: "prevail.pref.userProfile",                 // "1" | "0" — prepend user.md
  incognito: "prevail.pref.incognito",                     // "1" | "0" — global master: plain model everywhere
  incognitoChat: "prevail.pref.incognitoChat",             // "1" | "0" — incognito for single Chat only
  incognitoCouncil: "prevail.pref.incognitoCouncil",       // "1" | "0" — incognito for Council only
  memoryBudgetChars: "prevail.pref.memoryBudgetChars",     // integer chars cap on _memory.md
  profileBudgetChars: "prevail.pref.profileBudgetChars",   // integer chars cap on user.md preamble
  memoryProvider: "prevail.pref.memoryProvider",           // cli used to distill (claude/ollama/…)
  distillModel: "prevail.pref.distillModel",               // cheap model id, e.g. claude-haiku-4-5
  contextEngine: "prevail.pref.contextEngine",             // "compressor" (only one wired)
  autoCompression: "prevail.pref.autoCompression",         // "1" | "0" — run the distill daemon
  compressionThreshold: "prevail.pref.compressionThreshold", // 0..1 of budget before distilling
  compressionTarget: "prevail.pref.compressionTarget",     // 0..1 of budget to compress toward
  protectedRecent: "prevail.pref.protectedRecent",         // keep most-recent N ledger records raw
  distillIntervalSec: "prevail.pref.distillIntervalSec",   // daemon tick cadence
  remindersIntervalSec: "prevail.pref.remindersIntervalSec", // reminders daemon cadence
  taskgenEnabled: "prevail.pref.taskgenEnabled",           // "1" | "0" — proactive task gen
  taskgenModel: "prevail.pref.taskgenModel",               // model for task generation
  taskgenIntervalSec: "prevail.pref.taskgenIntervalSec",   // task-gen daemon cadence (seconds)
  taskgenMaxPerDomain: "prevail.pref.taskgenMaxPerDomain", // max tasks generated per domain per day
  skillgenEnabled: "prevail.pref.skillgenEnabled",         // "1" | "0" — self-learning skill gen
  skillgenModel: "prevail.pref.skillgenModel",             // model for skill generation
  skillgenIntervalSec: "prevail.pref.skillgenIntervalSec", // skill-gen daemon cadence (seconds)
  skillgenMaxPerDomain: "prevail.pref.skillgenMaxPerDomain", // max skills learned per domain per day
  // Safety — guardrails. Most are read by the engine/ingestion; redactSecrets
  // is enforced desktop-side in the intent-ledger capture path.
  approvalMode: "prevail.pref.approvalMode",               // "manual" | "auto"
  approvalTimeoutSec: "prevail.pref.approvalTimeoutSec",   // seconds before an approval prompt times out
  confirmMcpReloads: "prevail.pref.confirmMcpReloads",     // "1" | "0"
  commandAllowlist: "prevail.pref.commandAllowlist",       // comma-separated allowed commands
  redactSecrets: "prevail.pref.redactSecrets",             // "1" | "0" — scrub secrets from saved content
  allowPrivateUrls: "prevail.pref.allowPrivateUrls",       // "1" | "0"
  fileCheckpoints: "prevail.pref.fileCheckpoints",         // "1" | "0" — snapshot before file edits
  // Remote / WebUI — serve the same UI to a browser via the bridge server.
  webuiPort: "prevail.pref.webuiPort",                     // integer port
  webuiUser: "prevail.pref.webuiUser",                     // login username
  webuiPass: "prevail.pref.webuiPass",                     // login password (local only)
  // Chat — auto-compact the conversation when the context window fills up
  // (summarize & continue), default ON. Keeps responses sharp without manual action.
  autoCompact: "prevail.pref.autoCompact",                 // "1" | "0"
  // Apps — run the autonomous app-sync daemon behind the scenes, default ON. The
  // tick just triggers a "due pass"; each app still syncs on its OWN schedule.
  appsAutoSync: "prevail.pref.appsAutoSync",               // "1" | "0"
  appsSyncIntervalSec: "prevail.pref.appsSyncIntervalSec", // how often to check for due apps
  appsSyncLastRun: "prevail.pref.appsSyncLastRun",         // epoch ms of last due-pass
  // Domain Loops — run the self-driving loop runner behind the scenes, default ON.
  loopsAutoRun: "prevail.pref.loopsAutoRun",                // "1" | "0"
  loopsIntervalSec: "prevail.pref.loopsIntervalSec",        // how often to advance due loops
  loopsLastRun: "prevail.pref.loopsLastRun",                // epoch ms of last in-app pass
  // Intent distillation daemon — automated, default ON. Re-distills high-level
  // intents on a cadence and/or after enough new prompts, no manual click.
  intentDaemonEnabled: "prevail.pref.intentDaemonEnabled",     // "1" | "0" (default on)
  intentDaemonIntervalSec: "prevail.pref.intentDaemonIntervalSec", // how often to CHECK
  intentDaemonMinNew: "prevail.pref.intentDaemonMinNew",       // distill after N new prompts
  intentDaemonMaxAgeSec: "prevail.pref.intentDaemonMaxAgeSec", // OR if older than this (daily)
  // Omega daemon — auto-distill the app-wide learned layer (vault/omega.md) on a
  // slow cadence (it's meta; it should change slowly). Default ON. See OMEGA-PLAN.
  omegaAuto: "prevail.pref.omegaAuto",                 // "1" | "0" (default on)
  omegaIntervalSec: "prevail.pref.omegaIntervalSec",   // re-distill cadence (default daily)
  omegaLastRun: "prevail.pref.omegaLastRun",           // epoch ms of last auto-distill
  // Telemetry — anonymous, opt-in, default OFF. Independent crash vs usage
  // sub-toggles. distinctId is a random local UUID, never tied to identity.
  telemetryUsage: "prevail.pref.telemetryUsage",           // "1" | "0" — PostHog anonymous usage analytics
  telemetryCrash: "prevail.pref.telemetryCrash",           // "1" | "0" — Sentry crash/error reports
  telemetryDistinctId: "prevail.pref.telemetryDistinctId", // random anonymous UUID
};
export function getPref(key: string, fallback: string): string {
  const v = lsGet(key);
  return v === "" ? fallback : v;
}
// Incognito: a surface runs incognito when the GLOBAL master is on OR that
// surface's own flag is on. Lets the user go incognito everywhere at once, or
// just for one surface (chat / council).
export type IncognitoSurface = "chat" | "council";
export function incognitoActive(surface: IncognitoSurface): boolean {
  if (getPref(PREF.incognito, "0") === "1") return true;
  const k = surface === "chat" ? PREF.incognitoChat : PREF.incognitoCouncil;
  return getPref(k, "0") === "1";
}
export function setPref(key: string, v: string): void { lsSet(key, v); }
