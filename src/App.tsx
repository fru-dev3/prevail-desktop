import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke, listen, isBrowser, type UnlistenFn } from "./bridge";
import { open } from "@tauri-apps/plugin-dialog";
import { titleCase } from "./format";
import type { CliInfo, Domain, DomainTab, EngineApp, TabId, ThreadMeta } from "./types";
import { BUNKER_LS, LS, PREF, getPref, hydrateUiPrefs, isBunkerOn, lsGet, lsSet } from "./storage";
import { BridgeStatusChips, DemoRibbon, ResizeHandle } from "./widgets";
import { OnboardingModal } from "./panels3";
import { AppFacetPanel, BunkerRibbon, VaultWizard } from "./shell";
// Heavy surfaces are code-split: each loads its own chunk on first use instead of
// inflating the initial bundle (and the live memory footprint). SettingsPanel
// alone transitively pulls in every settings section, so deferring it is the
// biggest single win. Mirrors how the engine spawns work lazily.
const ChatPanel = lazy(() => import("./chatpanel").then((m) => ({ default: m.ChatPanel })));
const CouncilPanel = lazy(() => import("./councilpanel").then((m) => ({ default: m.CouncilPanel })));
const SettingsPanel = lazy(() => import("./settingspanel").then((m) => ({ default: m.SettingsPanel })));
const BenchmarkPanel = lazy(() => import("./benchpanel").then((m) => ({ default: m.BenchmarkPanel })));
import { Sidebar } from "./sidebar";
import { useAppearance, useFrameworkLens } from "./hooks";
import { distillCfgFromPrefs, intentDaemonCfgFromPrefs, skillgenCfgFromPrefs, taskgenCfgFromPrefs } from "./daemoncfg";
import { autoVerifyClis } from "./verify";
import { startBenchScheduler } from "./bench";
import { bumpBackupChangeCount, startBackupScheduler } from "./backup";
import { startLoopsScheduler } from "./loops";
import { startAppsScheduler } from "./appspanel";
import { migrateModelPrefs } from "./helpers2";
import { AppHeaderBar, DomainActionsMenu, LockScreen, QuickSwitcher, ThreadsRail, WebLogin } from "./panels";

// Single source of truth for the version chip in title bar.

// Canonical on/off toggle. Track 36×20px, thumb 16×16px, slides
// 18px. Every switch in the app routes through this so we never
// drift back into bespoke implementations that misalign the thumb.

// VS Code-style quick switcher modal. Centered overlay, single
// search input at the top, combined list of domains + recent
// threads (loaded async from each domain's _threads/ dir).
//
// Arrow keys navigate, Enter picks, Esc dismisses. Click outside
// also dismisses. Items are sorted: domains first, then threads
// newest-first, with fuzzy substring filtering.

// Per-CLI model quickpicks. Picked in Settings → Defaults and per-
// session in Council. Display labels are friendly, ids are passed
// through to the CLI's --model flag.

// Live-discovered models per provider (filled at runtime by the engine's
// `models` command). Merged with the curated  catalog so newly released
// models surface without a code change. OpenRouter's catalog is huge (300+), so
// its extras are exposed via search in the provider card, not merged into the
// inline list. Module-level so every reader sees the latest; a
// `prevail:models-refreshed` event tells components to re-render.

/** Curated catalog for a provider, plus any live-discovered models not already
 *  in it. OpenRouter stays curated inline (search surfaces the rest). */


// Models a ChatGPT-login Codex account rejects (verified). A previously
// saved pick like "gpt-5-codex" persists in localStorage and keeps
// failing even after we trim the dropdown — so heal it on launch.

// One-time migration: reset any stale per-CLI model pick that's no longer
// in and replace any known-dead model id (global or per-domain)
// with the working gpt-5.5. Safe + idempotent.
import {
  
  
  
  
  
  
  
  
  
  
  
  
  
  

  
  
  MessageSquare,
  
  
  
  
  
  
  
  Scale,
  
  Settings as SettingsIcon,
  Sparkles,
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  X,
  
  
  
  Activity,
  
  Layers,
  
  Lightbulb,
  Plug,
  
  
  ShieldCheck,
  RefreshCw,
  Repeat,
  Power,
} from "lucide-react";

// Friendly one-line descriptions for the domain cards — plain, warm, no jargon.
// Shown as the card subtitle; falls back to a generic line for unknown domains.



// Top-level tabs. Council is NOT its own tab (a mode toggle inside Chat) and
// Tools is NOT its own tab (a section inside Settings), keeping the surface
// count low so each tab has a clear job.
const TABS: { id: TabId; label: string; icon: typeof MessageSquare }[] = [
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "council", label: "Council", icon: Scale },
  { id: "benchmark", label: "Benchmark", icon: Sparkles },
];

// Suspense fallback for the code-split panels. Quiet and centered — a lazy chunk
// loads in a few ms off local disk, so this should flash only on the very first
// open of a surface.
function PanelLoading() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-accent" aria-label="Loading" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// localStorage keys + helpers


// ── Bunker  (app-wide local-only trust mode) ──
// Providers that serve models from this machine only — mirror bunker.rs LOCAL_CLIS.
// Bunker  auto-switch target: the local provider to fall back to when a
// cloud CLI is selected. First *available* local CLI, or null if none is
// installed/running. Mirrors bunker.rs `preferred_local_cli` (Ollama today;
// LM Studio / MLX detection is a recorded deferred refinement).

// Does a prompt look like a judgment call worth convening the council for, vs a
// quick factual question a single model handles? Used by Auto-council's "smart"
// mode (the user's expectation: spin off a council only when the question needs
// it). Heuristic, deliberately transparent.

export default function App() {
  const appearance = useAppearance();
  // WebUI login gate — in a browser tab the app must authenticate to the
  // bridge server before any invoke works. On the desktop this is always true.
  const [webAuthed, setWebAuthed] = useState(() => !isBrowser() || !!sessionStorage.getItem("prevail.web.token"));
  // Desktop app lock (F4 Phase 0). If a passcode is set we gate the whole app
  // behind a lock screen until it's entered this session. Browser sessions use
  // the WebUI login instead, so the lock only applies on the desktop.
  const [lockSet, setLockSet] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [vaultEncrypted, setVaultEncrypted] = useState(false);
  useEffect(() => {
    if (isBrowser()) return;
    (async () => {
      try { const s = await invoke<{ set: boolean }>("engine_lock_status"); setLockSet(!!s.set); } catch { /* engine not ready */ }
    })();
  }, []);
  // On the desktop, the chosen vault lives in localStorage. In the browser the
  // vault physically lives on the desktop machine, so the browser's own
  // localStorage path is meaningless — start empty and always inherit the
  // desktop's authoritative vault from the backend (see the effect below).
  const [vaultPath, setVaultPath] = useState<string | null>(() =>
    isBrowser() ? null : localStorage.getItem(LS.vault),
  );
  // Is this vault encrypted (F4 Phase 1)? Checked once the vault path resolves.
  // If it is, the LockScreen unlocks the keyring (sets the DEK) before the app
  // renders. If the engine reports the session already unlocked, skip the gate.
  useEffect(() => {
    if (isBrowser() || !vaultPath) return;
    (async () => {
      try {
        const s = await invoke<{ encrypted: boolean; unlocked: boolean }>("engine_vault_status", { vault: vaultPath });
        setVaultEncrypted(!!s.encrypted);
        if (s.unlocked) setUnlocked(true);
      } catch { /* engine not ready */ }
    })();
  }, [vaultPath]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  // App view — clicking an app in the sidebar opens it in the canvas: a detail
  // bar (schedule, cadence, last run, vault paths, domains) above a chat scoped
  // to the app's primary domain, so you converse against the app's own data
  // exactly like a domain. Cleared whenever you navigate to a domain/General.
  const [selectedApp, setSelectedApp] = useState<EngineApp | null>(null);
  const [appView, setAppView] = useState(false);
  // Which facet of the open app the canvas shows. "chat" = the app's own
  // conversation; the rest are app sub-views (mirror of DomainTab, but for an
  // app's own concerns — never the grounding domain's).
  type AppTab = "chat" | "runs" | "settings" | "domains";
  const [appTab, setAppTab] = useState<AppTab>("chat");
  // Thread scope — WHERE conversations are stored/listed. An open app gets its
  // OWN thread space (`_app-<id>`) that's INDEPENDENT of any domain, so you can
  // hold several ongoing conversations with an app over time without them
  // being tied to (or scattered across) the app's many bound domains. A plain
  // domain (or General) scopes to the domain itself. This is distinct from the
  // GROUNDING domain (what the model reads) — app chats still ground in the
  // app's primary domain so engine_chat has real state to reason over.
  const threadScope = useMemo(
    () =>
      appView && selectedApp
        ? `_app-${selectedApp.id.replace(/[^a-z0-9_-]/gi, "-")}`
        : selectedDomain,
    [appView, selectedApp, selectedDomain],
  );
  // True when an app is open in the canvas. An app is isolated: it does NOT
  // borrow the active domain's chrome (hero header, "apps refreshing this
  // domain" strip, Benchmark tab). Those are domain concepts; an app feeds
  // domains, it isn't one.
  const onApp = appView && !!selectedApp;
  // Open an app in the canvas. Shared by the sidebar and the per-domain Apps
  // strip so "click an app anywhere → jump to it" works the same everywhere.
  const openApp = useCallback((app: EngineApp) => {
    setSelectedApp(app);
    setAppView(true);
    setAppTab("chat");
    setSelectedDomain(app.domains[0] ?? "");
    setActiveThreadPath(null);
    setChatViewNonce((n) => n + 1);
    setDomainTab("chat");
    setTab("chat");
  }, []);
  // Navigate to a domain's own chat, leaving app view. The mirror of openApp:
  // app detail links to its domains, domain Apps strip links to its apps.
  const openDomain = useCallback((name: string) => {
    setSelectedApp(null);
    setAppView(false);
    setSelectedDomain(name);
    setActiveThreadPath(null);
    setChatViewNonce((n) => n + 1);
    setDomainTab("chat");
    setTab("chat");
  }, []);
  // Enable / disable an app's autonomous sync. Disabled apps stay configured
  // and chattable; the sync daemon simply skips them. The apps-changed event
  // refreshes the open record so the UI reflects the new state.
  const [togglingEnabled, setTogglingEnabled] = useState(false);
  const toggleAppEnabled = useCallback(async () => {
    if (!selectedApp) return;
    const next = !(selectedApp.enabled ?? true);
    setTogglingEnabled(true);
    try {
      await invoke("engine_app_set_enabled", { id: selectedApp.id, enabled: next });
      window.dispatchEvent(new CustomEvent("prevail:apps-changed"));
    } catch (e) { console.error("set app enabled", e); }
    finally { setTogglingEnabled(false); }
  }, [selectedApp]);
  // The domain Apps strip lives deep in the tree; let it open an app via a
  // window event instead of threading a callback through every layer.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const app = (e as CustomEvent).detail as EngineApp | undefined;
      if (app && app.id) openApp(app);
    };
    window.addEventListener("prevail:open-app", onOpen);
    return () => window.removeEventListener("prevail:open-app", onOpen);
  }, [openApp]);
  // Broadcast which app is active so deeply-nested views (e.g. the per-domain
  // Apps strip) can highlight it without prop-drilling.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("prevail:active-app", { detail: appView && selectedApp ? selectedApp.id : null }));
  }, [appView, selectedApp]);
  // When an app's binding changes (e.g. domains added/removed on its canvas),
  // refresh the OPEN app record in place so grounding + the detail bar stay
  // current — WITHOUT re-opening it (which would reset the conversation).
  useEffect(() => {
    const onAppsChanged = () => {
      if (!appView || !selectedApp) return;
      const id = selectedApp.id;
      invoke<EngineApp[]>("engine_apps_list")
        .then((list) => {
          const fresh = (list ?? []).find((a) => a.id === id);
          if (fresh) setSelectedApp(fresh);
        })
        .catch(() => {});
    };
    window.addEventListener("prevail:apps-changed", onAppsChanged);
    return () => window.removeEventListener("prevail:apps-changed", onAppsChanged);
  }, [appView, selectedApp]);
  // Threads — backed by <vault>/<domain>/_threads/<slug>.md files.
  // Active thread defines what's loaded into the chat transcript.
  const [threads, setThreads] = useState<ThreadMeta[]>([]);
  const [activeThreadPath, setActiveThreadPath] = useState<string | null>(null);
  // Bumped on every thread pick so the chat panel returns to the chat view even
  // when the same thread is re-clicked (e.g. to escape the Preferences view).
  const [chatViewNonce, setChatViewNonce] = useState(0);
  // Per-domain import counts shown as a tiny badge in the sidebar.
  // Refreshed when ingestion:artifact fires (any tier writes a file)
  // or when the domain list changes.
  const [domainStats, setDomainStats] = useState<Record<string, number>>({});
  const domainsRef = useRef<Domain[]>([]);
  useEffect(() => { domainsRef.current = domains; }, [domains]);
  // Heal stale/unsupported model picks (e.g. gpt-5-codex → gpt-5.5) once on launch.
  useEffect(() => { migrateModelPrefs(); }, []);
  // Vault resolution.
  // - Browser (WebUI): the desktop is the source of truth. Always pull the
  //   desktop's current vault from the backend, and refresh on window focus so
  //   a vault changed on the desktop propagates to the web view without a
  //   reload (fixes the web view showing none of the desktop's domains).
  // - Desktop: if localStorage was wiped (e.g. webview cache clear) but we
  //   remembered a vault on disk, restore it so the user isn't bounced back to
  //   first-launch.
  useEffect(() => {
    if (isBrowser()) {
      const pull = async () => {
        try {
          const bp = await invoke<string | null>("bootstrap_vault");
          if (bp) setVaultPath((cur) => (cur === bp ? cur : bp));
        } catch { /* ignore */ }
      };
      // Mirror the desktop's pins / model picks / toggles, then pull its vault,
      // then nudge a re-render so the hydrated prefs take effect.
      void hydrateUiPrefs().then(() => pull()).then(() => setUiPrefsNonce((n) => n + 1));
      window.addEventListener("focus", pull);
      return () => window.removeEventListener("focus", pull);
    }
    (async () => {
      try {
        // Auto-enter DEMO with the bundled sample vault so a fresh (or healed)
        // launch lands in a populated app, never an empty/broken vault. Seeds
        // the bundled resources/sample-vault and marks it demo. (F3 auto-demo.)
        const seedDemo = async () => {
          const path = await invoke<string>("import_sample_vault");
          await invoke("engine_appmode_set", { mode: "demo", vault: path }).catch(() => {});
          await invoke("engine_appmode_mark_demo", { vault: path }).catch(() => {});
          setVaultPath(path);
          lsSet(LS.vault, path);
          setSelectedDomain(null);
        };
        // Check the persisted app mode. Production mode with a live vault is
        // the only case where we skip demo — the user explicitly set it up.
        // Demo mode (or no mode yet) always re-seeds so the user always lands
        // in the populated sandbox with the latest bundled sample data.
        const mode = await invoke<{ mode: "demo" | "production" }>("engine_appmode_get").catch(() => null);
        if (mode?.mode === "production") {
          // User has switched to their own vault — respect it.
          if (vaultPath) {
            const ok = await invoke<boolean>("vault_exists", { path: vaultPath }).catch(() => false);
            if (ok) return;
            lsSet(LS.vault, "");
            setVaultPath(null);
          }
          const bp = await invoke<string | null>("bootstrap_vault");
          if (bp) {
            const ok = await invoke<boolean>("vault_exists", { path: bp }).catch(() => false);
            if (ok) { setVaultPath(bp); lsSet(LS.vault, bp); return; }
          }
        }
        // Demo mode (default) — always re-seed from the bundled sample vault
        // so every launch starts with fresh, up-to-date sample data.
        await seedDemo();
      } catch { /* fall through to the VaultWizard if seeding fails */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Keep the desktop's remembered vault (bootstrap-vault.txt) in lockstep with
  // whatever vault is actually active, so the WebUI — which inherits via
  // bootstrap_vault — always mirrors what's open on the desktop, not a stale
  // earlier pick. Desktop only; the browser is a consumer, never the source.
  useEffect(() => {
    if (isBrowser() || !vaultPath) return;
    void invoke("remember_vault", { path: vaultPath }).catch(() => {});
  }, [vaultPath]);
  const refreshDomainStats = useCallback(async (names: string[]) => {
    const results = await Promise.all(
      names.map(async (n) => {
        try {
          const s = await invoke<{ imports: number }>("ingestion_domain_stats", { domain: n });
          return [n, s.imports] as const;
        } catch { return [n, 0] as const; }
      }),
    );
    setDomainStats(Object.fromEntries(results));
  }, []);
  const [, setDueTasks] = useState<Record<string, number>>({});
  const checkReminders = useCallback(async (vault: string) => {
    try {
      const due = await invoke<{ domain: string }[]>("reminders_check", { vault });
      const counts: Record<string, number> = {};
      for (const t of due) counts[t.domain] = (counts[t.domain] ?? 0) + 1;
      setDueTasks(counts);
    } catch { /* ignore */ }
  }, []);
  // Fire reminders_check once when the vault becomes known, then again on
  // every window focus (catches a new day without a relaunch).
  useEffect(() => {
    if (isBrowser() || !vaultPath) return;
    void checkReminders(vaultPath);
    const onFocus = () => void checkReminders(vaultPath);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [vaultPath, checkReminders]);
  // Refresh sidebar badge counts silently after any task write (no new
  // notifications — just update the counts so checking a box clears the badge).
  useEffect(() => {
    if (isBrowser() || !vaultPath) return;
    const refresh = async () => {
      try {
        const due = await invoke<{ domain: string }[]>("reminders_due_today", { vault: vaultPath });
        const counts: Record<string, number> = {};
        for (const t of due) counts[t.domain] = (counts[t.domain] ?? 0) + 1;
        setDueTasks(counts);
      } catch { /* ignore */ }
    };
    window.addEventListener("prevail:tasks-changed", refresh);
    return () => window.removeEventListener("prevail:tasks-changed", refresh);
  }, [vaultPath]);
  // Onboarding flow — opt-in only, opened manually via "Set up domains".
  // It never auto-appears (the old auto-open raced the scan and popped over
  // a populated vault). The dismissed flag is retained so manual closes are
  // tracked even though nothing auto-reopens.
  const [onboardOpen, setOnboardOpen] = useState(false);
  const [, setUiPrefsNonce] = useState(0); // browser: re-render after prefs hydrate
  const [, setOnboardDismissed] = useState(false);
  // Tracks whether the first scan_vault for the current vault has resolved.
  const [, setDomainsLoaded] = useState(false);
  // Reusable vault re-scan (used by onboarding apply + archive/restore).
  const refreshDomains = useCallback(async () => {
    if (!vaultPath) return;
    try {
      const d = await invoke<Domain[]>("scan_vault", { path: vaultPath });
      setDomains(d);
      setVaultError(null);
      setDomainsLoaded(true);
      void refreshDomainStats(d.map((x) => x.name));
    } catch (e) {
      console.error("refreshDomains", e);
    }
  }, [vaultPath, refreshDomainStats]);
  // Rescan when a starter pack is imported (from Settings → Demo Mode) so the
  // new domains show up in the sidebar immediately, no reload needed.
  useEffect(() => {
    const h = () => void refreshDomains();
    window.addEventListener("prevail:domains-changed", h);
    return () => window.removeEventListener("prevail:domains-changed", h);
  }, [refreshDomains]);
  // WebUI host bridge: when running as the DESKTOP host (not a browser tab),
  // execute proxied invokes from web clients and forward events to them. This
  // is what lets the same UI run in a browser with zero duplicate code — the
  // host window is the executor (webview-proxy). No-op in a browser tab.
  useEffect(() => {
    if (isBrowser()) return;
    let unlistens: UnlistenFn[] = [];
    (async () => {
      unlistens.push(await listen<{ id: number; cmd: string; args: Record<string, unknown> }>("webui:invoke", async (e) => {
        const { id, cmd, args } = e.payload;
        try {
          const data = await invoke(cmd, args);
          await invoke("webui_resolve", { id, ok: true, data });
        } catch (err) {
          await invoke("webui_resolve", { id, ok: false, error: String(err) });
        }
      }));
      // Forward the event channels the UI listens to → web clients.
      const channels = ["chat:chunk", "chat:done", "engine-chat:line", "engine-chat:done", "benchmark:chunk", "benchmark:done", "ingestion:artifact", "ingestion:browser", "tg:message_in", "tg:message_out"];
      for (const ch of channels) {
        unlistens.push(await listen<unknown>(ch, (e) => { void invoke("webui_event", { event: ch, payload: e.payload }); }));
      }
    })();
    return () => { unlistens.forEach((u) => u()); unlistens = []; };
  }, []);
  // Start/stop background daemons (distill + reminders + task-gen) when vault is known.
  useEffect(() => {
    if (!vaultPath) return;
    if (isBrowser()) return;
    (async () => {
    // One-time, idempotent: migrate a legacy vault to the v3 layout (apps/ +
    // domains/ as siblings). Safe — only moves real domains, never overwrites,
    // never deletes. New + already-migrated vaults are a no-op.
    await invoke<number>("vault_migrate_layout", { path: vaultPath }).catch(() => 0);
    // If the headless learn agent (launchd) is installed, it owns distillation —
    // the in-app distiller defers so the two never double-run on the same vault.
    const headless = await invoke<boolean>("headless_learn_status").catch(() => false);
    // Distill
    const on = !headless && getPref(PREF.persistentMemory, "1") === "1" && getPref(PREF.autoCompression, "1") === "1";
    if (on) {
      invoke("distill_start", { cfg: distillCfgFromPrefs(vaultPath) }).catch((e) => console.error("distill_start", e));
    } else {
      invoke("distill_stop").catch(() => {});
    }
    })();
    // Reminders
    const remInterval = Number(getPref(PREF.remindersIntervalSec, "900")) || 900;
    invoke("reminders_daemon_start", { vault: vaultPath, interval_sec: remInterval }).catch(() => {});
    // Task generation
    if (getPref(PREF.taskgenEnabled, "0") === "1") {
      invoke("taskgen_start", { cfg: taskgenCfgFromPrefs(vaultPath) }).catch((e) => console.error("taskgen_start", e));
    }
    // Scheduled benchmark re-runs (drift tracking) — module-level timer; the
    // tick itself checks the enabled pref, so toggling needs no restart.
    startBenchScheduler(vaultPath);
    // Scheduled vault backups (data protection) — same pattern.
    startBackupScheduler(vaultPath);
    // Domain Loops — advance due loops behind the scenes (self-driving), not just
    // on the "Run loops now" button. Tick re-reads the enabled pref.
    startLoopsScheduler(vaultPath);
    // Apps — keep connected apps fresh on their own schedule while open.
    startAppsScheduler(vaultPath);
    // Skill generation (self-learning) — on by default so the app learns
    // skills from conversations out of the box; togglable in Settings.
    if (getPref(PREF.skillgenEnabled, "1") === "1") {
      invoke("skillgen_start", { cfg: skillgenCfgFromPrefs(vaultPath) }).catch((e) => console.error("skillgen_start", e));
    } else {
      invoke("skillgen_stop").catch(() => {});
    }
    // Intent distillation (self-learning) — on by default so high-level intents
    // + recommendations stay fresh automatically (cadence + new-prompt trigger),
    // with no manual button press.
    if (getPref(PREF.intentDaemonEnabled, "1") === "1") {
      invoke("intent_daemon_start", { cfg: intentDaemonCfgFromPrefs(vaultPath) }).catch((e) => console.error("intent_daemon_start", e));
    } else {
      invoke("intent_daemon_stop").catch(() => {});
    }
  }, [vaultPath]);
  useEffect(() => {
    let unl: UnlistenFn | null = null;
    (async () => {
      unl = await listen("ingestion:artifact", () => {
        void refreshDomainStats(domainsRef.current.map((d) => d.name));
      });
    })();
    return () => { if (unl) unl(); };
  }, [refreshDomainStats]);
  // Switching domains never drags the previous domain's thread pointer
  // along (the next auto-save would write into the wrong domain folder),
  // but returning to a domain lands on what you were working on: a stream
  // that's still running there first, else the thread you last had open.
  useEffect(() => {
    const scope = threadScope;
    if (!scope) { setActiveThreadPath(null); return; }
    const running = runningStreams.find((s) => s.threadPath && s.threadPath.includes(`/${scope}/`));
    const remembered = lsGet(`prevail.domain.${scope}.lastThread`);
    setActiveThreadPath(
      running?.threadPath
        ?? (remembered && remembered.includes(`/${scope}/`) ? remembered : null),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadScope]);
  // Cross-domain streaming awareness — App-level map of in-flight
  // streams. Sidebar + ThreadsRail read this to pulse domains/threads
  // that have work happening in the background.
  type RunningStream = {
    sessionId: string;
    domain: string | null;
    threadPath: string | null;
    title: string;
    startedAt: number;
  };
  const [runningStreams, setRunningStreams] = useState<RunningStream[]>([]);
  // Domains whose background run finished while you were looking elsewhere.
  // The live amber pulse vanishes the instant a stream ends; this keeps a
  // steady "ready" marker on the domain until you actually open it, so a
  // finished run is never silently lost when several are in flight at once.
  const [finishedDomains, setFinishedDomains] = useState<Record<string, number>>({});
  const notifyPermissionRef = useRef<NotificationPermission | "unknown">(typeof Notification !== "undefined" ? Notification.permission : "unknown");
  useEffect(() => {
    if (typeof Notification === "undefined") return;
    if (notifyPermissionRef.current === "default") {
      Notification.requestPermission().then((p) => { notifyPermissionRef.current = p; }).catch(() => {});
    }
  }, []);
  function notifyDone(title: string, body: string) {
    if (lsGet("prevail.pref.desktopNotif") !== "1") return;
    if (typeof Notification === "undefined") return;
    if (notifyPermissionRef.current === "granted") {
      try { new Notification(title, { body }); } catch {}
    }
  }
  // Memory watchdog surface. The Rust watchdog emits `system:memory-warning`
  // when Prevail's footprint approaches a machine-freezing fraction of RAM;
  // kind "killed" means it already stopped the largest runaway task to protect
  // the Mac. This is a SAFETY alert, so it shows regardless of the routine
  // notification pref. The banner auto-clears; the native notification reaches
  // the user even if they've switched to another app (when a freeze would hit).
  const [memoryAlert, setMemoryAlert] = useState<{ kind: string; message: string } | null>(null);
  useEffect(() => {
    let un: UnlistenFn | undefined;
    listen<{ kind: string; message: string }>("system:memory-warning", (e) => {
      const { kind, message } = e.payload;
      console.warn(`[memory ${kind}] ${message}`);
      setMemoryAlert({ kind, message });
      if (typeof Notification !== "undefined" && notifyPermissionRef.current === "granted") {
        try {
          new Notification(kind === "killed" ? "Prevail stopped a runaway task" : "Prevail memory is high", { body: message });
        } catch {}
      }
    }).then((f) => { un = f; }).catch(() => {});
    return () => { un?.(); };
  }, []);
  // Auto-dismiss the banner a while after the latest alert.
  useEffect(() => {
    if (!memoryAlert) return;
    const t = setTimeout(() => setMemoryAlert(null), 20000);
    return () => clearTimeout(t);
  }, [memoryAlert]);
  function playDoneChime() {
    if (lsGet("prevail.pref.soundOnDone") !== "1") return;
    try {
      const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
        || (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      o.type = "sine";
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.32);
      o.connect(g).connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.34);
      o.onended = () => ctx.close();
    } catch {}
  }
  const markStreamStart = useCallback((s: RunningStream) => {
    setRunningStreams((cur) => [...cur.filter((x) => x.sessionId !== s.sessionId), s]);
  }, []);
  const selectedDomainRef = useRef<string | null>(null);
  useEffect(() => { selectedDomainRef.current = selectedDomain; }, [selectedDomain]);
  const markStreamEnd = useCallback((sessionId: string) => {
    setRunningStreams((cur) => {
      const ended = cur.find((x) => x.sessionId === sessionId);
      if (ended) {
        playDoneChime();
        if (ended.domain !== selectedDomainRef.current) {
          const where = ended.domain ? titleCase(ended.domain) : "no domain";
          notifyDone(`Reply ready · ${where}`, ended.title || "Your conversation just finished.");
          // Leave a persistent "ready" marker on the domain you weren't watching.
          if (ended.domain) {
            const dom = ended.domain;
            setFinishedDomains((m) => ({ ...m, [dom]: Date.now() }));
          }
        }
      }
      return cur.filter((x) => x.sessionId !== sessionId);
    });
  }, []);
  const runningDomains = useMemo(() => new Set(runningStreams.map((s) => s.domain ?? "")), [runningStreams]);
  const runningThreadPaths = useMemo(() => new Set(runningStreams.map((s) => s.threadPath ?? "").filter(Boolean)), [runningStreams]);
  // Opening a domain clears its "ready" marker — you've now seen it.
  useEffect(() => {
    if (!selectedDomain) return;
    setFinishedDomains((m) => {
      if (!(selectedDomain in m)) return m;
      const next = { ...m };
      delete next[selectedDomain];
      return next;
    });
  }, [selectedDomain]);
  // A domain shows "ready" only when it's done AND not currently re-running.
  const finishedDomainSet = useMemo(
    () => new Set(Object.keys(finishedDomains).filter((d) => !runningDomains.has(d))),
    [finishedDomains, runningDomains],
  );
  // Persisted rail widths. Min/max enforced when dragging.
  const [domainRailWidth, setDomainRailWidth] = useState<number>(() => {
    const v = parseInt(lsGet("prevail.domainRailWidth"), 10);
    return Number.isFinite(v) && v > 0 ? v : 240;
  });
  const [threadsRailWidth, setThreadsRailWidth] = useState<number>(() => {
    const v = parseInt(lsGet("prevail.threadsRailWidth"), 10);
    return Number.isFinite(v) && v > 0 ? v : 240;
  });
  useEffect(() => { lsSet("prevail.domainRailWidth", String(domainRailWidth)); }, [domainRailWidth]);
  useEffect(() => { lsSet("prevail.threadsRailWidth", String(threadsRailWidth)); }, [threadsRailWidth]);
  const refreshThreads = useCallback(async () => {
    if (!vaultPath) return;
    try {
      const list = await invoke<ThreadMeta[]>("list_threads", { vault: vaultPath, domain: threadScope || null });
      setThreads(list);
    } catch (e) { console.error("list_threads", e); }
  }, [vaultPath, threadScope]);
  useEffect(() => { void refreshThreads(); }, [refreshThreads]);
  const [clis, setClis] = useState<CliInfo[]>([]);
  const [tab, setTab] = useState<TabId>("chat");
  // Lets in-app links (e.g. the Demo ribbon) open a specific Settings section.
  const [settingsJump, setSettingsJump] = useState<{ section: string; n: number } | null>(null);
  const openSettingsAt = (section: string) => {
    setSettingsJump((j) => ({ section, n: (j?.n ?? 0) + 1 }));
    setTab("settings");
  };
  // Window-event form of the same jump, for module-scope UI (sidebar
  // indicators) that has no prop line to the App.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const s = (e as CustomEvent<string>).detail;
      if (s) openSettingsAt(s);
    };
    window.addEventListener("prevail:open-settings", onOpen as EventListener);
    // Jump straight to a domain (from the Recommendations "Open" action).
    const onOpenDomain = (e: Event) => {
      const d = (e as CustomEvent<string>).detail;
      if (d) openDomain(d);
    };
    window.addEventListener("prevail:open-domain", onOpenDomain as EventListener);
    // Count vault-affecting changes for the change-based backup trigger.
    const bump = () => bumpBackupChangeCount();
    window.addEventListener("prevail:context-changed", bump);
    window.addEventListener("prevail:tasks-changed", bump);
    return () => {
      window.removeEventListener("prevail:open-settings", onOpen as EventListener);
      window.removeEventListener("prevail:open-domain", onOpenDomain as EventListener);
      window.removeEventListener("prevail:context-changed", bump);
      window.removeEventListener("prevail:tasks-changed", bump);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Lifted from ChatPanel so the top bar owns the domain Insights / Preferences
  // toggles. ChatPanel receives these as props and renders the matching view.
  const [domainTab, setDomainTab] = useState<DomainTab>("chat");
  // Bunker Mode: backend is the source of truth; mirror it into localStorage on
  // mount so synchronous reads (isBunkerOn) everywhere stay correct, and into
  // React state so the persistent ribbon re-renders on toggle.
  const [bunkerEnabled, setBunkerEnabled] = useState<boolean>(isBunkerOn);
  const [bunkerLocalOk, setBunkerLocalOk] = useState<boolean>(true); // assume ok until checked
  useEffect(() => {
    invoke<{ enabled: boolean; local_available: boolean }>("bunker_status")
      .then((s) => {
        const on = !!s.enabled;
        lsSet(BUNKER_LS, on ? "1" : "0");
        setBunkerEnabled(on);
        setBunkerLocalOk(!!s.local_available);
      })
      .catch(() => {});
  }, []);
  // Called by the Privacy & Connectivity section after a confirmed toggle.
  const applyBunker = useCallback((on: boolean) => {
    lsSet(BUNKER_LS, on ? "1" : "0");
    setBunkerEnabled(on);
  }, []);
  // A domain can launch a scoped benchmark; it dispatches this event and we
  // jump to the Benchmark page pre-scoped to that domain.
  const [benchScope, setBenchScope] = useState<string | null>(null);
  // The Benchmark panel stays mounted (hidden) on other tabs so an in-flight run
  // keeps its live progress when you navigate away. But it's a heavy lazy chunk,
  // so don't load it until the tab is first opened — if it was never visited,
  // there's no run to preserve. Once true, it stays mounted for the session.
  const [benchEverVisited, setBenchEverVisited] = useState(false);
  useEffect(() => { if (tab === "benchmark") setBenchEverVisited(true); }, [tab]);
  useEffect(() => {
    const onBench = (e: Event) => {
      const d = (e as CustomEvent<string>).detail || null;
      setBenchScope(d);
      setTab("benchmark");
    };
    window.addEventListener("prevail:benchmark-domain", onBench as EventListener);
    return () => window.removeEventListener("prevail:benchmark-domain", onBench as EventListener);
  }, []);
  // I4: a high-stakes quick-action (Decision / Risks) routes to the Council. The
  // card dispatches this event; we switch the domain + Council tab and seed the
  // question so the user just picks panelists and convenes.
  const [councilSeed, setCouncilSeed] = useState<string | null>(null);
  const [councilAutoConvene, setCouncilAutoConvene] = useState(false);
  // Auto-council: a chat send in a domain with the toggle on routes its
  // question here: seed the Council tab and convene without another click.
  useEffect(() => {
    const onAuto = (e: Event) => {
      const q = (e as CustomEvent<{ prompt?: string }>).detail?.prompt;
      if (!q) return;
      setCouncilSeed(q);
      setCouncilAutoConvene(true);
      setTab("council");
    };
    window.addEventListener("prevail:auto-council", onAuto as EventListener);
    return () => window.removeEventListener("prevail:auto-council", onAuto as EventListener);
  }, []);
  useEffect(() => {
    const onSeed = (e: Event) => {
      const detail = (e as CustomEvent<{ domain?: string; prompt: string }>).detail;
      if (!detail?.prompt) return;
      if (detail.domain) setSelectedDomain(detail.domain);
      setCouncilSeed(detail.prompt);
      setTab("council");
    };
    window.addEventListener("prevail:council-seed", onSeed as EventListener);
    return () => window.removeEventListener("prevail:council-seed", onSeed as EventListener);
  }, []);
  const [vaultError, setVaultError] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(
    () => lsGet("prevail.sidebarCollapsed") === "1",
  );
  useEffect(() => {
    lsSet("prevail.sidebarCollapsed", sidebarCollapsed ? "1" : "0");
  }, [sidebarCollapsed]);
  const fwLens = useFrameworkLens();

  const selectedDomainPath = useMemo(() => {
    if (!selectedDomain) return null;
    return domains.find((d) => d.name === selectedDomain)?.path ?? null;
  }, [domains, selectedDomain]);

  // Quick switcher (⌘P) — fuzzy finder over all domains + recent
  // threads across all domains. Modal owns its own state when open.
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false);

  // Keyboard shortcuts — global. Skip when a text input has focus
  // (so typing ⌘B in the composer doesn't toggle the sidebar).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase() ?? "";
      const editable = tag === "input" || tag === "textarea" || target?.isContentEditable;
      // Allow the global shortcuts that are clearly intentional even
      // when in a field (Cmd+,, Cmd+K, Cmd+P).
      const k = e.key.toLowerCase();
      if (editable && k !== "," && k !== "k" && k !== "p") return;
      switch (k) {
        case "k": // ⌘K — new chat (no domain)
          e.preventDefault();
          setSelectedDomain("");
          setActiveThreadPath(null);
          setTab("chat");
          break;
        case ",": // ⌘, — open settings
          e.preventDefault();
          setTab("settings");
          break;
        case "b": // ⌘B — toggle the domain rail
          e.preventDefault();
          setSidebarCollapsed((v) => !v);
          break;
        case "p": // ⌘P — quick switcher
          e.preventDefault();
          setQuickSwitcherOpen(true);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function openInFinder(path: string | null) {
    if (!path) return;
    try { await invoke("open_in_finder", { path }); } catch (e) { console.error("open_in_finder", e); }
  }

  // Re-detectable so saving a provider key (OpenRouter) or starting a local
  // server can refresh the picker without a reload. Returns the fresh list.
  const refreshClis = useCallback(async (): Promise<CliInfo[]> => {
    try {
      const list = await invoke<CliInfo[]>("detect_clis");
      setClis(list);
      // Validate every detected provider right away (once per session), so
      // valid / not-valid marks are visible without expanding anything.
      autoVerifyClis(list);
      return list;
    } catch {
      return [];
    }
  }, []);
  useEffect(() => {
    void refreshClis();
  }, [refreshClis]);

  useEffect(() => {
    if (!vaultPath) return;
    // In a browser tab, wait until authenticated — otherwise the scan fires a
    // pre-login invoke that 401s and leaves a stale "unauthorized" error. The
    // webAuthed dep re-runs this once sign-in completes.
    if (isBrowser() && !webAuthed) return;
    let cancelled = false;
    let attempts = 0;
    setDomainsLoaded(false);
    const tryScan = async () => {
      while (!cancelled && attempts < 5) {
        try {
          const d = await invoke<Domain[]>("scan_vault", { path: vaultPath });
          if (cancelled) return;
          setDomains(d);
          setVaultError(null);
          setDomainsLoaded(true);
          void refreshDomainStats(d.map((x) => x.name));
          // Land on no-domain chat by default. User picks a domain
          // from the sidebar to enter its context.
          return;
        } catch (e) {
          attempts++;
          const msg = String(e);
          // Transient macOS EINTR — wait briefly and retry.
          if (msg.includes("os error 4") || msg.toLowerCase().includes("interrupted")) {
            await new Promise((r) => setTimeout(r, 100 * attempts));
            continue;
          }
          if (!cancelled) {
            setVaultError(msg);
            setDomains([]);
          }
          return;
        }
      }
      if (!cancelled) {
        setVaultError("vault scan failed after retries: try toggling vault in Settings");
      }
    };
    tryScan();
    return () => { cancelled = true; };
  }, [vaultPath, webAuthed]);

  // Onboarding auto-open REMOVED. It raced the vault scan (firing while
  // domains were still loading) and popped a modal over an already-populated
  // vault, then never auto-closed. Onboarding is now opt-in only via the
  // explicit "Set up domains" control; it never auto-appears.

  async function pickVault() {
    // The native folder picker (tauri-plugin-dialog) only exists in the
    // desktop runtime; calling it in a browser throws "Cannot read properties
    // of undefined (reading 'invoke')". In the WebUI the browser inherits the
    // desktop's vault automatically (bootstrap_vault), so this path is a
    // fallback — guide the user to the desktop instead of crashing. (B4)
    if (isBrowser()) {
      window.alert(
        "Pick your vault from the Prevail desktop app on this Mac: a browser can't open a native folder picker. The web view then syncs to it automatically.",
      );
      return;
    }
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir === "string") {
      setVaultPath(dir);
      lsSet(LS.vault, dir);
      void invoke("remember_vault", { path: dir }).catch(() => {});
      setSelectedDomain(null);
    }
  }

  // Import the bundled sample vault (fully-populated demo domains) so the
  // user can explore every feature without creating anything.
  async function loadSample() {
    try {
      const path = await invoke<string>("import_sample_vault");
      // Loading the sample vault means you're exploring — mark demo mode so the
      // Settings banner offers the switch to production. (F3) Tag the vault as a
      // demo sandbox so the switch-to-production flow can safely clear it later.
      await invoke("engine_appmode_set", { mode: "demo", vault: path }).catch(() => {});
      await invoke("engine_appmode_mark_demo", { vault: path }).catch(() => {});
      setVaultPath(path);
      lsSet(LS.vault, path);
      setSelectedDomain(null);
    } catch (e) {
      console.error("import_sample_vault failed", e);
    }
  }

  if (isBrowser() && !webAuthed) return <WebLogin onAuthed={() => setWebAuthed(true)} />;
  if (!isBrowser() && (lockSet || vaultEncrypted) && !unlocked) return <LockScreen vault={vaultPath} encrypted={vaultEncrypted} onUnlock={() => setUnlocked(true)} />;
  if (!vaultPath) return <VaultWizard onPick={pickVault} onLoadSample={loadSample} />;

  if (tab === "settings") {
    return (
      <div className="relative flex h-screen flex-col bg-background text-text-primary">
        <Suspense fallback={<PanelLoading />}>
        <SettingsPanel
          appearance={appearance}
          vaultPath={vaultPath}
          onChangeVault={pickVault}
          clis={clis}
          onRefreshClis={refreshClis}
          bunkerEnabled={bunkerEnabled}
          onBunkerChange={applyBunker}
          onSetupDomains={() => { setOnboardDismissed(false); setOnboardOpen(true); }}
          onVaultMoved={(p) => {
            setVaultPath(p);
            lsSet(LS.vault, p);
            void invoke("remember_vault", { path: p }).catch(() => {});
            setSelectedDomain(null);
          }}
          onBack={() => setTab("chat")}
          jumpTo={settingsJump}
          onStartChatWith={(cliId, modelId) => {
            lsSet(LS.defaultChatCli, cliId);
            if (modelId) lsSet(`prevail.model.${cliId}`, modelId);
            setSelectedDomain("");
            setTab("chat");
          }}
        />
        </Suspense>
        <BunkerRibbon enabled={bunkerEnabled} />
        <DemoRibbon onSwitch={() => openSettingsAt("demo")} />
      </div>
    );
  }

  return (
    <div className="relative flex h-screen flex-col bg-background text-text-primary">
      {memoryAlert && (
        <div className="fixed left-1/2 top-3 z-[100] flex max-w-xl -translate-x-1/2 items-start gap-2.5 rounded-lg border border-warn/40 bg-warn/10 px-4 py-2.5 shadow-lg backdrop-blur">
          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-warn" />
          <div className="min-w-0 flex-1 text-[13px]">
            <div className="font-semibold text-warn">{memoryAlert.kind === "killed" ? "Runaway task stopped to protect your Mac" : "Memory is running high"}</div>
            <div className="text-text-secondary">{memoryAlert.message}</div>
          </div>
          <button onClick={() => setMemoryAlert(null)} title="Dismiss" className="shrink-0 rounded p-0.5 text-text-muted hover:text-text-primary"><X className="h-4 w-4" /></button>
        </div>
      )}
      {bunkerEnabled && !bunkerLocalOk && (
        <div className="flex shrink-0 items-center justify-center gap-2 border-b border-warn/30 bg-warn/10 px-4 py-1.5 text-xs text-warn">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span>Bunker Mode needs a local model provider, but none was detected.</span>
          <a href="https://ollama.com/download" target="_blank" rel="noreferrer" className="font-medium underline">Install Ollama ›</a>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <Sidebar
          collapsed={sidebarCollapsed}
          setCollapsed={setSidebarCollapsed}
          vaultPath={vaultPath}
          domains={domains}
          vaultError={vaultError}
          selectedDomain={selectedDomain}
          setSelectedDomain={(name) => { setSelectedApp(null); setAppView(false); setSelectedDomain(name); }}
          activeAppId={appView && selectedApp ? selectedApp.id : null}
          openInFinder={openInFinder}
          tab={tab}
          setTab={setTab}
          onDomainCreated={(d) => {
            setDomains((cur) => [...cur, d].sort((a, b) => a.name.localeCompare(b.name)));
            setSelectedApp(null); setAppView(false);
            setSelectedDomain(d.name);
          }}
          appearance={appearance}
          runningDomains={runningDomains}
          finishedDomains={finishedDomainSet}
          domainStats={domainStats}
          railWidth={domainRailWidth}
          onOpenOnboarding={() => { setOnboardDismissed(false); setOnboardOpen(true); }}
          onDomainsChanged={() => void refreshDomains()}
          onOpenApp={openApp}
        />
        {!sidebarCollapsed && (
          <ResizeHandle
            ariaLabel="Resize domain rail"
            onChange={(dx) => setDomainRailWidth((w) => Math.max(180, Math.min(420, w + dx)))}
          />
        )}
        {/* legacy single-render below disabled */}
        {false && !sidebarCollapsed && (
        <aside className="flex w-60 shrink-0 flex-col border-r border-border-subtle bg-surface" />
        )}

        {/* Threads rail — visible on every tab so the domain's conversation
            history stays one click away and the left chrome doesn't vanish
            when you switch to Benchmark. Picking a thread on Benchmark jumps
            back to Chat with that thread open. */}
        {(
          <>
            <ThreadsRail
              threads={threads}
              activePath={activeThreadPath}
              selectedDomain={selectedDomain}
              scopeLabel={appView && selectedApp ? selectedApp.title : null}
              vaultPath={vaultPath}
              onPick={(p) => { setActiveThreadPath(p); setChatViewNonce((n) => n + 1); if (tab === "benchmark") setTab("chat"); }}
              onNew={async () => {
                // Create the thread file immediately so the user gets
                // a renameable entry in the rail BEFORE typing the
                // first prompt. Backend accepts empty turns. Scoped to the
                // active app's own thread space when an app is open.
                try {
                  const path = await invoke<string>("save_thread", {
                    vault: vaultPath,
                    domain: threadScope || null,
                    slug: null,
                    title: "Untitled",
                    turns: [],
                  });
                  setActiveThreadPath(path);
                  await refreshThreads();
                } catch (e) {
                  console.error("create thread stub", e);
                  // Fall back to the old behavior on failure so + at
                  // least clears the chat for a fresh start.
                  setActiveThreadPath(null);
                }
              }}
              onRefresh={() => void refreshThreads()}
              runningThreadPaths={runningThreadPaths}
              railWidth={threadsRailWidth}
            />
            <ResizeHandle
              ariaLabel="Resize threads rail"
              onChange={(dx) => setThreadsRailWidth((w) => Math.max(180, Math.min(480, w + dx)))}
            />
          </>
        )}

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-1 border-b border-border-subtle bg-background px-4">
            {/* An open app is isolated: it shows only its own facet chips
                (Chat / Runs / Settings / Domains) on the right, so the global
                domain tabs (Chat | Council) are hidden to avoid a duplicate
                "Chat" and an out-of-context Council. */}
            {(onApp ? [] : TABS).map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => {
                    setTab(t.id);
                    // The Chat tab is also the way back from a domain sub-view
                    // (Insights / Preferences / Context) to the conversation.
                    if (t.id === "chat") setDomainTab("chat");
                  }}
                  className={`relative -mb-px flex items-center gap-2 px-4 py-3 text-sm transition-colors ${
                    active ? "text-accent" : "text-text-muted hover:text-text-secondary"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {t.label}
                  {active && <span className="absolute bottom-0 left-0 right-0 h-px bg-accent" />}
                </button>
              );
            })}
            <div className="flex-1" />
            {/* Insights / Preferences / actions — available for General too,
                not just domains. They toggle the Chat sub-view (jumping to Chat
                first if you're on Council/Benchmark). The actions menu hides
                "archive" for General (you can't archive your whole workspace),
                keeping just back up / export. */}
            <div className="flex items-center gap-1">
              {onApp ? (
                // An open app shows ITS OWN facets, independent of the domain it
                // grounds in (the isolation shipped in 0.7.24). Chat is the app's
                // conversation; Runs / Settings / Domains are the AppFacetPanel
                // views. The grounding domain's own Insights/Usage/Preferences no
                // longer leak in here.
                <>
                  {([
                    { key: "chat", label: "Chat", Icon: MessageSquare, title: `Conversations with ${selectedApp.title}` },
                    { key: "runs", label: "Runs", Icon: RefreshCw, title: "Last sync, schedule, and run history" },
                    { key: "settings", label: "Settings", Icon: SettingsIcon, title: "Connection, autonomy, schedule, and skills" },
                    { key: "domains", label: "Domains", Icon: Layers, title: "Domains this app refreshes" },
                  ] as const).map(({ key, label, Icon, title }) => (
                    <button
                      key={key}
                      onClick={() => { setTab("chat"); setAppTab(key); }}
                      title={title}
                      className={`flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[13px] transition-colors ${
                        tab === "chat" && appTab === key
                          ? "bg-accent-soft text-accent"
                          : "text-text-muted hover:bg-surface-warm hover:text-accent"
                      }`}
                    >
                      <Icon className="h-4 w-4" /> {label}
                    </button>
                  ))}
                  <button
                    onClick={toggleAppEnabled}
                    disabled={togglingEnabled}
                    title={(selectedApp.enabled ?? true) ? "Disable autonomous sync (stays configured and chattable)" : "Enable autonomous sync"}
                    className={`flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[13px] transition-colors disabled:opacity-50 ${
                      (selectedApp.enabled ?? true)
                        ? "text-text-muted hover:bg-surface-warm hover:text-accent"
                        : "text-warn hover:bg-surface-warm hover:text-warn"
                    }`}
                  >
                    <Power className="h-4 w-4" /> {(selectedApp.enabled ?? true) ? "Enabled" : "Disabled"}
                  </button>
                </>
              ) : (
                // Insights / Usage / Preferences / Apps — available for General
                // too, not just domains. They toggle the Chat sub-view (jumping
                // to Chat first if you're on Council/Benchmark).
                <>
                  <button
                    onClick={() => { setTab("chat"); setDomainTab(tab === "chat" && domainTab === "insights" ? "chat" : "insights"); }}
                    title="Insights: what to work on, your tasks, and recent intents"
                    className={`flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[13px] transition-colors ${
                      tab === "chat" && domainTab === "insights"
                        ? "bg-accent-soft text-accent"
                        : "text-text-muted hover:bg-surface-warm hover:text-accent"
                    }`}
                  >
                    <Lightbulb className="h-4 w-4" /> Insights
                  </button>
                  <button
                    onClick={() => { setTab("chat"); setDomainTab(tab === "chat" && domainTab === "usage" ? "chat" : "usage"); }}
                    title={selectedDomain ? "Usage: queries, tokens, and cost for this domain" : "Usage: queries, tokens, and cost across everything"}
                    className={`flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[13px] transition-colors ${
                      tab === "chat" && domainTab === "usage"
                        ? "bg-accent-soft text-accent"
                        : "text-text-muted hover:bg-surface-warm hover:text-accent"
                    }`}
                  >
                    <Activity className="h-4 w-4" /> Usage
                  </button>
                  <button
                    onClick={() => { setTab("chat"); setDomainTab(tab === "chat" && domainTab === "prefs" ? "chat" : "prefs"); }}
                    title={selectedDomain ? "Domain preferences" : "General preferences"}
                    className={`flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[13px] transition-colors ${
                      tab === "chat" && domainTab === "prefs"
                        ? "bg-accent-soft text-accent"
                        : "text-text-muted hover:bg-surface-warm hover:text-accent"
                    }`}
                  >
                    <SettingsIcon className="h-4 w-4" /> Preferences
                  </button>
                  {selectedDomain && (
                    <button
                      onClick={() => { setTab("chat"); setDomainTab(tab === "chat" && domainTab === "loops" ? "chat" : "loops"); }}
                      title="Loops: the standing forces working to reach this domain's desired state"
                      className={`flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[13px] transition-colors ${
                        tab === "chat" && domainTab === "loops"
                          ? "bg-accent-soft text-accent"
                          : "text-text-muted hover:bg-surface-warm hover:text-accent"
                      }`}
                    >
                      <Repeat className="h-4 w-4" /> Loops
                    </button>
                  )}
                  {selectedDomain && (
                    <button
                      onClick={() => { setTab("chat"); setDomainTab(tab === "chat" && domainTab === "apps" ? "chat" : "apps"); }}
                      title="Apps that refresh this domain"
                      className={`flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[13px] transition-colors ${
                        tab === "chat" && domainTab === "apps"
                          ? "bg-accent-soft text-accent"
                          : "text-text-muted hover:bg-surface-warm hover:text-accent"
                      }`}
                    >
                      <Plug className="h-4 w-4" /> Apps
                    </button>
                  )}
                </>
              )}
              <DomainActionsMenu
                domain={selectedDomain || "general"}
                vaultPath={vaultPath}
                label={selectedDomain ? "Archive" : "Back up"}
                canArchive={!!selectedDomain}
                onArchived={(name) => {
                  if (selectedDomain === name) setSelectedDomain("");
                  void refreshDomains();
                }}
              />
            </div>
          </div>

          {/* App view: a slim, always-visible identity bar above the canvas.
              Full-width chrome (not inside the chat scroll) so ChatPanel's own
              layout is untouched. The rich detail lives in the AppFacetPanel
              facets (Runs / Settings / Domains), reached via the top-bar chips. */}
          {appView && selectedApp && (
            <AppHeaderBar
              app={selectedApp}
              enabled={selectedApp.enabled ?? true}
              onOpenDomain={openDomain}
              onClose={() => { setSelectedApp(null); setAppView(false); }}
            />
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Suspense fallback={<PanelLoading />}>
            {tab === "chat" && onApp && selectedApp && appTab !== "chat" ? (
              <AppFacetPanel
                app={selectedApp}
                vaultPath={vaultPath}
                domains={domains}
                appTab={appTab}
                onOpenDomain={openDomain}
                onChanged={() => { void refreshThreads(); }}
              />
            ) : tab === "chat" && (
              <ChatPanel
                domain={selectedDomain}
                domainPath={selectedDomainPath}
                threadDomain={threadScope}
                isApp={onApp}
                vaultPath={vaultPath}
                clis={clis}
                fwLens={fwLens}
                onSwitchToCouncil={() => setTab("council")}
                activeThreadPath={activeThreadPath}
                chatViewNonce={chatViewNonce}
                onActiveThreadChange={setActiveThreadPath}
                onThreadsChanged={() => void refreshThreads()}
                onStreamStart={markStreamStart}
                onStreamEnd={markStreamEnd}
                domains={domains}
                domainStats={domainStats}
                runningDomains={runningDomains}
                finishedDomains={finishedDomainSet}
                onPickDomain={(name) => setSelectedDomain(name)}
                domainTab={domainTab}
                setDomainTab={setDomainTab}
              />
            )}
            {tab === "council" && (
              <CouncilPanel
                domain={selectedDomain}
                domainPath={selectedDomainPath}
                threadDomain={threadScope}
                vaultPath={vaultPath}
                clis={clis}
                fwLens={fwLens}
                activeThreadPath={activeThreadPath}
                onActiveThreadChange={setActiveThreadPath}
                onOpenInFinder={() => openInFinder(selectedDomainPath)}
                onSwitchToChat={() => setTab("chat")}
                onThreadsChanged={() => void refreshThreads()}
                seedPrompt={councilSeed}
                seedAutoConvene={councilAutoConvene}
                onSeedConsumed={() => { setCouncilSeed(null); setCouncilAutoConvene(false); }}
              />
            )}
            {/* Per-domain benchmark, full screen — scoped to whatever domain
                you're in. Remounts (via key) when you switch domains so it
                re-scopes cleanly. STAYS MOUNTED (hidden) on other tabs so an
                in-flight run keeps its live progress when you navigate away
                and back. The global cockpit lives in the configuration page. */}
            {benchEverVisited && (
              <div className={tab === "benchmark" ? "h-full" : "hidden"}>
                <BenchmarkPanel
                  key={selectedDomain || benchScope || "all"}
                  vaultPath={vaultPath}
                  initialDomain={selectedDomain || benchScope}
                />
              </div>
            )}
            </Suspense>
          </div>
        </main>
      </div>
      <BunkerRibbon enabled={bunkerEnabled} />
      <DemoRibbon onSwitch={() => openSettingsAt("demo")} />
      {/* A7: live bridge/WebUI chips — bottom-left, follow you across the app */}
      <BridgeStatusChips />
      {quickSwitcherOpen && (
        <QuickSwitcher
          vaultPath={vaultPath}
          domains={domains}
          onClose={() => setQuickSwitcherOpen(false)}
          onPickDomain={(name) => {
            setSelectedApp(null); setAppView(false);
            setSelectedDomain(name);
            setActiveThreadPath(null);
            setTab("chat");
            setQuickSwitcherOpen(false);
          }}
          onPickThread={(domain, path) => {
            setSelectedApp(null); setAppView(false);
            setSelectedDomain(domain ?? "");
            setActiveThreadPath(path);
            setTab("chat");
            setQuickSwitcherOpen(false);
          }}
        />
      )}
      {onboardOpen && (
        <OnboardingModal
          vaultPath={vaultPath}
          onClose={() => { setOnboardOpen(false); setOnboardDismissed(true); }}
          onApplied={() => void refreshDomains()}
        />
      )}
    </div>
  );
}

// Title-case helper. 'real-estate' → 'Real Estate', 'tax' → 'Tax'.
// Used to render life domain labels in the UI without mutating the
// underlying folder names that drive everything else.

// ─────────────────────────────────────────────────────────────────────
// Vault wizard

// Always-visible "the gateway is live" indicator: external messages can
// reach this app right now. Polls the bridge every 30s; click jumps to the
// Gateway settings.


// One row per live benchmark run, pinned above the Settings strip. The data
// lives in the module-scope registry, so the rows persist (and progress)
// across every navigation; each row can cancel its run.
































































































