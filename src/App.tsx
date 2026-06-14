import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke, listen, isBrowser, type UnlistenFn } from "./bridge";
import { open } from "@tauri-apps/plugin-dialog";
import { motion, useMotionValue, useSpring, useReducedMotion } from "framer-motion";
import { PrevailLogo } from "./PrevailLogo";
import { Markdown } from "./Markdown";
import { scoreColor, formatFreshness, titleCase, relTime } from "./format";
import { Toggle, ThinkingDisclosure } from "./ui";
import type { AppRunHistory, ChatEvent, ChatMessage, CliInfo, ContextScore, Domain, DomainContextBundle, DomainManifest, DomainTab, EngineApp, LifeReadiness, ModelPick, PanelistReply, PanelistSlot, SkillEntry, TabId, ThreadMeta, ThreadTurn } from "./types";
import { appScheduleText, domainBlurb, domainColor, isLocalCli, looksLikeJudgmentCall, preferredLocalCli, splitThinking, stripAnsi, vendorAccent } from "./helpers";
import { APP_VERSION, AUTONOMY_LABEL, AUTONOMY_TINT, FRAMEWORKS, INTEGRATION_LABEL, LENSES, MODELS, STATUS_TINT } from "./constants";
import { BUNKER_LS, LS, PREF, getDomainToggle, getPref, hydrateUiPrefs, isBunkerOn, lsGet, lsSet } from "./storage";
import { AppCard, AppKV, BridgeStatusChips, DemoRibbon, FloatingChip, ResizeHandle } from "./widgets";
import { ContextScorePanel, DomainAppsTab, OnboardingModal } from "./panels3";
import { AppearanceSection, DemoModeSection, VaultSettings } from "./settings8";
import { BenchmarkPanel } from "./benchpanel";
import { DomainHome, DomainStatusBar, MessageList } from "./chatviews";
import { Sidebar } from "./sidebar";
import { ModelsSection } from "./settings7";
import { ConfigurationSection, CouncilSettingsSection, PrivacyConnectivitySection } from "./settings6";
import { AboutSection, GatewaySection, McpSection } from "./settings5";
import { GeneralSection, IdealStateSection, SafetySection } from "./settings4";
import { ConnectorsSection } from "./settings3";
import { DaemonsSection, IntentsSection, MemoryContextSection, SkillsSection, TasksCrossDomainSection } from "./settings2";
import { FrameworksSection, IngestionSection, RemoteSection, ShortcutsSection } from "./settings1";
import { BenchScheduleCard } from "./cards";
import { ProviderMark } from "./marks";
import { BrandMark } from "./brandmark";
import { ThinkingDots, useAppearance, useFrameworkLens } from "./hooks";
import { SettingsHeader, pickSkillColor } from "./sectionutil";
import { DOMAIN_ICONS, domainIcon } from "./icons";
import { extractCliError } from "./textutil";
import { distillCfgFromPrefs, skillgenCfgFromPrefs, taskgenCfgFromPrefs } from "./daemoncfg";
import { COUNCIL_CHAIR_KEY, readCouncilChair, readCouncilMembers } from "./council";
import { autoVerifyClis, useCliVerifyLive } from "./verify";
import { startBenchScheduler } from "./bench";
import { bumpBackupChangeCount, startBackupScheduler } from "./backup";
import { buildChatContext, buildCouncilQuickActions, buildIdealStatePreamble, buildQuickActions, buildSynthesisPrompt, loadPreferredSkills, maybeRedact, maybeStripSycophancy, migrateModelPrefs, savePreferredSkills } from "./helpers2";
import { InsightsPanel, UsageDashboard } from "./panels2";
import { AppHeaderBar, ContextScoreBadge, DomainActionsMenu, DrawerImportsSection, LockScreen, NewSkillForm, QuickSwitcher, SkillsList, ThreadsRail, WebLogin } from "./panels";

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
// `models` command). Merged with the curated MODELS catalog so newly released
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
// in MODELS, and replace any known-dead model id (global or per-domain)
// with the working gpt-5.5. Safe + idempotent.
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Brain,
  Briefcase,
  Check,
  
  ChevronRight,
  
  Crown,
  
  
  
  
  FileText,

  Folder,
  Heart,
  Home,
  Github,
  
  MessageSquare,
  
  
  
  Paperclip,
  
  Pin,
  Plus,
  Receipt,
  
  Scale,
  
  Settings as SettingsIcon,
  Shield,
  Sparkles,
  
  
  MessagesSquare,
  
  
  PanelRightClose,
  PanelRightOpen,
  Target,
  
  
  
  
  
  
  
  
  TrendingUp,
  Users,
  Wallet,
  Wrench,
  X,
  
  
  
  Activity,
  
  Layers,
  
  Lightbulb,
  Plug,
  ThumbsUp,
  ThumbsDown,
  ShieldCheck,
  Cloud,
  Zap,
  RefreshCw,
  Clock,
  KeyRound,
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

function BunkerRibbon({ enabled }: { enabled: boolean }) {
  // High-contrast in BOTH modes: a clear tinted bar (not a translucent wash that
  // disappears over warm/cream themes) with dark text in light mode and light
  // text in dark mode. Legibility is non-negotiable for an always-on trust bar.
  return (
    <div
      className={`relative flex shrink-0 items-center justify-center gap-2 border-t px-4 py-1 text-[11px] ${
        enabled
          ? "border-ai bg-ai text-[#0a2230]"
          : "border-black/30 bg-[#141416] text-white/90"
      }`}
      title={
        enabled
          ? "Bunker Mode: your data stays on this device. No requests leave your machine."
          : "Cloud Connected: cloud models, web search, and external services are enabled."
      }
    >
      {enabled ? <ShieldCheck className="h-3.5 w-3.5" /> : <Cloud className="h-3.5 w-3.5" />}
      <span className="font-mono font-semibold uppercase tracking-[0.18em]">
        {enabled ? "Bunker Mode" : "Cloud Connected"}
      </span>
      <span className="opacity-90">
        ·{" "}
        {enabled
          ? "Local models only • Network disabled"
          : "Cloud models and web access enabled"}
      </span>
      {/* Version — inside the ribbon so it inherits the high-contrast ribbon
          text color (the old standalone pill was invisible over the dark bar). */}
      <span className="pointer-events-none absolute right-3 select-none font-mono text-[10px] tracking-wider opacity-70">
        v{APP_VERSION}
      </span>
    </div>
  );
}

// A7: live "bridge running" chips in the app footer — so you always know a
// Telegram bridge or the WebUI is serving your vault, from anywhere in the app
// (not just buried in Settings). Polls every 4s; renders nothing when idle.

// A prominent, full-width ribbon pinned to the very bottom of the app whenever
// you're in the demo sandbox — so you always know this is sample data. The
// "Switch to Production" link takes you to the configuration page. Removed
// entirely (no ribbon) the moment you're in production.

// Per-domain preferred skills — auto-attach on entering a domain.

// Concatenates a list of chat messages into a single text payload for
// passing as context to a stateless CLI. Drops the oldest turns until
// the total stays under `maxChars`. Empty-content messages (the streaming
// placeholder for an in-flight reply) are excluded automatically.
//
// IMPORTANT: callers pass the PRIOR conversation — at send() time React's
// state update for the just-typed user turn + its placeholder has not yet
// committed, so `msgs` does NOT contain them. We must therefore keep every
// prior turn (filtering only empties). A previous version sliced off the
// last two entries on the assumption the new pair was already present, which
// silently dropped the most-recent completed exchange — so a follow-up that
// referenced it (e.g. "was he any good?") reached the model with no context,
// most visibly when switching models mid-thread. (feedback v0.4.1 B1)

// ─────────────────────────────────────────────────────────────────────
// App root — vault picker, sidebar, tabs.
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
    // Skill generation (self-learning) — on by default so the app learns
    // skills from conversations out of the box; togglable in Settings.
    if (getPref(PREF.skillgenEnabled, "1") === "1") {
      invoke("skillgen_start", { cfg: skillgenCfgFromPrefs(vaultPath) }).catch((e) => console.error("skillgen_start", e));
    } else {
      invoke("skillgen_stop").catch(() => {});
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
    // Count vault-affecting changes for the change-based backup trigger.
    const bump = () => bumpBackupChangeCount();
    window.addEventListener("prevail:context-changed", bump);
    window.addEventListener("prevail:tasks-changed", bump);
    return () => {
      window.removeEventListener("prevail:open-settings", onOpen as EventListener);
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
            {TABS.filter((t) => !(onApp && t.id === "benchmark")).map((t) => {
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
            <div className={tab === "benchmark" ? "h-full" : "hidden"}>
              <BenchmarkPanel
                key={selectedDomain || benchScope || "all"}
                vaultPath={vaultPath}
                initialDomain={selectedDomain || benchScope}
              />
            </div>
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


function VaultWizard({ onPick, onLoadSample }: { onPick: () => void; onLoadSample: () => void }) {
  // Staggered entrance for the center column.
  const container = { hidden: {}, show: { transition: { staggerChildren: 0.09, delayChildren: 0.12 } } };
  const item = {
    hidden: { opacity: 0, y: 14 },
    show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 120, damping: 16 } },
  };
  const reduce = useReducedMotion();
  // Pointer parallax — shared springs the chips read from for depth.
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 60, damping: 18 });
  const sy = useSpring(py, { stiffness: 60, damping: 18 });
  const onMove = (e: React.MouseEvent) => {
    if (reduce) return;
    px.set(e.clientX / window.innerWidth - 0.5);
    py.set(e.clientY / window.innerHeight - 0.5);
  };
  // Decorative life-domain chips (icons, never emojis) that drift + parallax.
  const chips = [
    { Icon: Wallet,    t: "Wealth",  x: "11%", y: "24%", d: 0.0, depth: 26 },
    { Icon: Heart,     t: "Health",  x: "79%", y: "18%", d: 0.6, depth: 38 },
    { Icon: Receipt,   t: "Tax",     x: "17%", y: "71%", d: 1.2, depth: 20 },
    { Icon: Briefcase, t: "Career",  x: "82%", y: "67%", d: 0.9, depth: 32 },
    { Icon: Home,      t: "Home",    x: "7%",  y: "48%", d: 1.6, depth: 44 },
    { Icon: Archive,   t: "Records", x: "87%", y: "45%", d: 0.3, depth: 16 },
  ];
  return (
    <div
      className="relative flex h-screen flex-col items-center justify-center overflow-hidden bg-background text-text-primary"
      data-tauri-drag-region
      onMouseMove={onMove}
    >
      {/* animated aurora background */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <motion.div
          className="absolute -left-40 -top-40 h-[42rem] w-[42rem] rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle at center, rgba(196,163,90,0.20), transparent 60%)" }}
          animate={{ x: [0, 60, -20, 0], y: [0, 40, 10, 0], scale: [1, 1.1, 0.95, 1] }}
          transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute -right-40 top-1/4 h-[38rem] w-[38rem] rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle at center, rgba(45,127,228,0.15), transparent 60%)" }}
          animate={{ x: [0, -50, 20, 0], y: [0, 30, -20, 0], scale: [1, 1.08, 1, 1] }}
          transition={{ duration: 26, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute bottom-[-12rem] left-1/3 h-[34rem] w-[34rem] rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle at center, rgba(196,163,90,0.13), transparent 60%)" }}
          animate={{ x: [0, 40, -30, 0], y: [0, -30, 10, 0] }}
          transition={{ duration: 30, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>

      {/* film grain */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04] mix-blend-overlay"
        aria-hidden
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
          backgroundSize: "140px 140px",
        }}
      />

      {/* drifting + parallaxing life-domain chips */}
      <div className="pointer-events-none absolute inset-0 hidden md:block" aria-hidden>
        {chips.map((c) => (
          <FloatingChip key={c.t} chip={c} sx={sx} sy={sy} reduce={!!reduce} />
        ))}
      </div>

      {/* center column */}
      <motion.div variants={container} initial="hidden" animate="show" className="relative z-10 max-w-xl px-8 text-center">
        {/* logo with orbiting rings + pulsing glow */}
        <motion.div variants={item} className="mb-7 flex justify-center">
          <div className="relative flex items-center justify-center" style={{ width: 132, height: 132 }}>
            <motion.div
              className="absolute rounded-full"
              style={{ inset: 16, boxShadow: "0 0 60px rgba(196,163,90,0.40)" }}
              animate={{ opacity: [0.45, 0.85, 0.45], scale: [0.95, 1.06, 0.95] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.svg className="absolute" width={132} height={132} viewBox="0 0 132 132" fill="none"
              animate={{ rotate: 360 }} transition={{ duration: 24, repeat: Infinity, ease: "linear" }}>
              <circle cx="66" cy="66" r="62" stroke="var(--color-accent)" strokeOpacity="0.35" strokeWidth="1" strokeDasharray="3 7" />
            </motion.svg>
            <motion.svg className="absolute" width={112} height={112} viewBox="0 0 112 112" fill="none"
              animate={{ rotate: -360 }} transition={{ duration: 18, repeat: Infinity, ease: "linear" }}>
              <circle cx="56" cy="56" r="53" stroke="#2d7fe4" strokeOpacity="0.28" strokeWidth="1" strokeDasharray="2 10" />
            </motion.svg>
            <PrevailLogo size={88} src="/logo-512.png" />
          </div>
        </motion.div>

        <motion.div variants={item} className="font-mono text-[11px] uppercase tracking-[0.3em] text-accent">◆ first launch</motion.div>

        <motion.div variants={item} className="relative mt-5 inline-block overflow-hidden px-1 py-1">
          <h1 className="font-display text-5xl font-semibold leading-[0.95] tracking-tight sm:text-6xl">
            Welcome to <BrandMark />.
          </h1>
          {!reduce && (
            <motion.span
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                background: "linear-gradient(105deg, transparent 35%, rgba(255,255,255,0.55) 50%, transparent 65%)",
                mixBlendMode: "overlay",
              }}
              initial={{ x: "-130%" }}
              animate={{ x: "130%" }}
              transition={{ duration: 1.1, delay: 0.7, ease: "easeInOut" }}
            />
          )}
        </motion.div>

        <motion.p variants={item} className="mx-auto mt-5 max-w-2xl whitespace-nowrap text-[15px] text-text-secondary">
          Your life in <span className="font-medium text-text-primary">domains</span>: scored, private, <span className="font-medium text-accent">local-first</span>.
        </motion.p>

        {/* feature pills */}
        <motion.div variants={item} className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {[
            { Icon: Shield, t: "Local-first · no cloud" },
            { Icon: TrendingUp, t: "Context Score" },
            { Icon: Users, t: "Multi-model council" },
          ].map(({ Icon, t }) => (
            <span key={t} className="inline-flex items-center gap-1.5 rounded-full border border-accent-border bg-accent-soft px-3 py-1 font-mono text-[11px] text-accent">
              <Icon className="h-3 w-3" />{t}
            </span>
          ))}
        </motion.div>

        {/* CTA — point to a vault, or import bundled sample data */}
        <motion.div variants={item} className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <motion.button
            onClick={onPick}
            whileHover={{ y: -2, scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="inline-flex items-center gap-2.5 rounded-xl bg-accent px-7 py-3.5 text-[15px] font-semibold text-background shadow-lg transition-colors hover:bg-accent-hover"
          >
            <Folder className="h-4 w-4" /> Pick your vault folder
          </motion.button>
          <motion.button
            onClick={onLoadSample}
            whileHover={{ y: -2, scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="inline-flex items-center gap-2.5 rounded-xl border border-accent-border bg-accent-soft px-7 py-3.5 text-[15px] font-semibold text-accent transition-colors hover:bg-accent hover:text-background"
          >
            <Sparkles className="h-4 w-4" /> Load sample data
          </motion.button>
        </motion.div>

        <motion.div variants={item} className="mt-5 text-xs text-text-muted">
          Sample data drops in a fully-populated vault so you can explore every feature.
          <span className="mx-2 opacity-40">·</span>
          <span className="font-mono">v{APP_VERSION} · stays on your Mac</span>
        </motion.div>
      </motion.div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// CLI badges in sidebar footer

// CLI badges moved to Settings → CLIs section (was in main sidebar).

// MODELS quickpicks (Claude Opus 4.7, GPT 5.4, Gemini 3.1 Pro, etc.)
// land in v0.2.6 — wiring them into Defaults + per-council picker.

// ─────────────────────────────────────────────────────────────────────
// FRAMEWORK + LENS CHIPS — shared above both Chat and Council composers

// A composer pill that opens a popover listing every framework (or lens) with
// a one-line description, so you pick directly instead of cycling blind.


function AppFacetPanel({ app, vaultPath, domains, appTab, onOpenDomain, onChanged }: { app: EngineApp; vaultPath: string; domains: Domain[]; appTab: "runs" | "settings" | "domains"; onOpenDomain: (d: string) => void; onChanged: () => void }) {
  const [skills, setSkills] = useState<{ id: string; runner: string; trigger: string }[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [doms, setDoms] = useState<string[]>(app.domains);
  const [savingDoms, setSavingDoms] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addValue, setAddValue] = useState("");
  useEffect(() => { setDoms(app.domains); setAddOpen(false); setAddValue(""); }, [app.id, app.domains]);
  useEffect(() => {
    setSkills(null);
    invoke<{ id: string; runner: string; trigger: string }[]>("engine_app_skills", { id: app.id }).then(setSkills).catch(() => setSkills([]));
  }, [app.id]);
  // Per-app run history (the bounded ring the sync layer records). Refetched
  // when the app changes and after a manual "Sync now" so the list stays live.
  const [history, setHistory] = useState<AppRunHistory | null>(null);
  const loadRuns = useCallback(() => {
    invoke<AppRunHistory>("engine_app_runs", { id: app.id })
      .then(setHistory)
      .catch(() => setHistory({ runs: [], nextDueTs: null, consecutiveFailures: 0 }));
  }, [app.id]);
  useEffect(() => { setHistory(null); loadRuns(); }, [app.id, loadRuns]);
  const addable = useMemo(
    () => domains.map((d) => d.name).filter((n) => !doms.includes(n)).sort((a, b) => a.localeCompare(b)),
    [domains, doms],
  );
  async function persistDomains(next: string[]) {
    const prev = doms;
    setDoms(next); setSavingDoms(true); setNote(null);
    try {
      const r = await invoke<{ ok: boolean; domains?: string[]; error?: string }>("engine_app_set_domains", { id: app.id, domains: next });
      if (!r.ok) { setDoms(prev); setNote(`failed: ${r.error}`); return; }
      if (r.domains) setDoms(r.domains);
      window.dispatchEvent(new CustomEvent("prevail:apps-changed"));
      onChanged();
    } catch (e) { setDoms(prev); setNote(`error: ${e}`); } finally { setSavingDoms(false); }
  }
  function removeDomain(d: string) { void persistDomains(doms.filter((x) => x !== d)); }
  function addDomain(raw: string) {
    const d = raw.trim().toLowerCase();
    if (!d || doms.includes(d)) { setAddOpen(false); setAddValue(""); return; }
    if (!/^[a-z0-9][a-z0-9-]{0,48}$/.test(d)) { setNote(`invalid domain "${raw}"`); return; }
    setAddOpen(false); setAddValue("");
    void persistDomains([...doms, d]);
  }
  async function test() {
    setBusy("test"); setNote(null);
    try { const r = await invoke<{ status?: string; message?: string }>("engine_app_probe", { id: app.id }); setNote(r.message || r.status || "tested"); }
    catch (e) { setNote(`error: ${e}`); } finally { setBusy(null); }
  }
  async function sync() {
    setBusy("sync"); setNote(null);
    try {
      const r = await invoke<{ ok: boolean; artifacts?: number; error?: string }>("engine_app_sync", { id: app.id, vault: vaultPath });
      setNote(r.ok ? `Synced. ${r.artifacts ?? 0} artifact(s) written.` : `Failed: ${r.error}`);
      onChanged();
      loadRuns();
    } catch (e) { setNote(`error: ${e}`); } finally { setBusy(null); }
  }
  const tint = STATUS_TINT[app.status] ?? "#9aa0a6";
  const autonomy = app.autonomy ?? "read-only";

  const domainEditor = (
    <AppCard icon={Layers} label="Domains this app refreshes" action={savingDoms ? <span className="font-mono text-[9px] text-text-muted/60">saving…</span> : undefined}>
      <p className="mb-2 text-[12px] text-text-muted">Many-to-many. Click a domain to open it and chat there; remove or add bindings here.</p>
      {doms.length === 0 ? (
        <div className="text-[12px] text-text-muted">Not bound to any domain yet. Add one below to start refreshing it.</div>
      ) : (
        <ul className="space-y-1">
          {doms.map((d) => (
            <li key={d} className="group/dom flex items-center gap-2 rounded-lg border border-border-subtle bg-background px-3 py-2">
              {(() => { const I = domainIcon(d); return I ? <I className="h-4 w-4 shrink-0 text-accent" /> : <span className="text-accent">◆</span>; })()}
              <button onClick={() => onOpenDomain(d)} className="text-sm font-medium text-text-primary hover:text-accent hover:underline" title={`Open ${titleCase(d)} and chat there`}>{titleCase(d)}</button>
              <span className="font-mono text-[10px] text-text-muted/60">vault/{d}/</span>
              <button onClick={() => onOpenDomain(d)} title={`Open ${titleCase(d)}`} className="ml-auto flex h-6 w-6 items-center justify-center rounded text-text-muted opacity-0 transition-opacity hover:bg-accent-soft hover:text-accent group-hover/dom:opacity-100"><ArrowRight className="h-3.5 w-3.5" /></button>
              <button onClick={() => removeDomain(d)} disabled={savingDoms} title={`Remove ${titleCase(d)} from ${app.title}`} className="flex h-6 w-6 items-center justify-center rounded text-text-muted opacity-0 transition-opacity hover:bg-surface-warm hover:text-warn group-hover/dom:opacity-100 disabled:opacity-30"><X className="h-3.5 w-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2">
        {addOpen ? (
          <div className="flex items-center gap-1.5">
            <input list={`app-doms-${app.id}`} autoFocus value={addValue} onChange={(e) => setAddValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addDomain(addValue); if (e.key === "Escape") { setAddOpen(false); setAddValue(""); } }}
              placeholder="domain name" className="w-44 rounded-lg border border-border bg-background px-2.5 py-1.5 text-[13px] text-text-primary outline-none focus:border-accent-border" />
            <datalist id={`app-doms-${app.id}`}>{addable.map((n) => <option key={n} value={n}>{titleCase(n)}</option>)}</datalist>
            <button onClick={() => addDomain(addValue)} disabled={savingDoms || !addValue.trim()} className="rounded-lg border border-border bg-background px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-40">add</button>
            <button onClick={() => { setAddOpen(false); setAddValue(""); }} className="rounded p-1.5 text-text-muted hover:text-text-primary"><X className="h-4 w-4" /></button>
          </div>
        ) : (
          <button onClick={() => setAddOpen(true)} disabled={savingDoms} className="flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent disabled:opacity-40"><Plus className="h-3.5 w-3.5" /> add domain</button>
        )}
      </div>
    </AppCard>
  );

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-6 py-6">
      {appTab === "settings" && (
        <>
          <AppCard icon={KeyRound} label="Connection" action={
            <button onClick={test} disabled={busy === "test"} className="rounded-lg border border-border bg-background px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-50">{busy === "test" ? "testing…" : "test"}</button>
          }>
            <AppKV k="Status"><span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: tint }} />{app.status}</span></AppKV>
            <AppKV k="Method">{INTEGRATION_LABEL[app.integration] ?? app.integration}</AppKV>
            <AppKV k="Account">{app.account?.label ? <span>{app.account.label}{app.account.address ? <span className="text-text-muted"> · {app.account.address}</span> : null}</span> : <span className="text-text-muted">-</span>}</AppKV>
            <AppKV k="Autonomy"><span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ backgroundColor: `${AUTONOMY_TINT[autonomy] ?? "#9aa0a6"}1a`, color: AUTONOMY_TINT[autonomy] ?? "#9aa0a6" }}><ShieldCheck className="h-3 w-3" />{AUTONOMY_LABEL[autonomy] ?? autonomy}</span></AppKV>
            {app.connections && app.connections.length > 0 && (
              <AppKV k="Strategies">{app.connections.map((c) => c.kind).join(" → ")}</AppKV>
            )}
            {note && <div className="mt-2 rounded-lg bg-surface-warm px-3 py-1.5 font-mono text-[11px] text-text-secondary">{note}</div>}
          </AppCard>
          <AppCard icon={Clock} label="Schedule">
            <div className="text-sm text-text-primary">{appScheduleText(app)}</div>
            <p className="mt-1 text-[11px] text-text-muted">The sync daemon refreshes this app on this cadence when it is enabled.</p>
          </AppCard>
          <AppCard icon={Zap} label="Skills">
            {skills === null ? (
              <div className="text-[12px] text-text-muted">loading…</div>
            ) : skills.length === 0 ? (
              <div className="text-[12px] text-text-muted">No skills yet. Add one under <code className="text-accent">skills/</code> to enable syncing.</div>
            ) : (
              <ul className="space-y-1">
                {skills.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 text-[13px] text-text-secondary"><span className="text-accent">▸</span> <span className="font-medium text-text-primary">{s.id}</span> <span className="font-mono text-[10px] text-text-muted">{s.runner} · {s.trigger}</span></li>
                ))}
              </ul>
            )}
          </AppCard>
        </>
      )}

      {appTab === "runs" && (
        <>
          <AppCard icon={RefreshCw} label="Last run" action={
            <button onClick={sync} disabled={busy === "sync"} className="inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-soft px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-accent hover:bg-accent/10 disabled:opacity-50"><RefreshCw className={`h-3 w-3 ${busy === "sync" ? "animate-spin" : ""}`} />{busy === "sync" ? "syncing…" : "sync now"}</button>
          }>
            <div className="text-2xl font-semibold text-text-primary">{relTime(app.lastSuccessTs)}</div>
            <div className="mt-0.5 text-[12px] text-text-muted">{app.lastSuccessTs ? "last successful refresh" : "this app has never run"}</div>
            {app.lastError && (
              <div className="mt-3 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-[12px] text-warn"><span className="font-mono uppercase tracking-wider">last error</span> · {app.lastError}</div>
            )}
            {note && <div className="mt-3 rounded-lg bg-surface-warm px-3 py-1.5 font-mono text-[11px] text-text-secondary">{note}</div>}
          </AppCard>
          <AppCard icon={Clock} label="Schedule">
            <div className="text-sm text-text-primary">{appScheduleText(app)}</div>
            {history?.nextDueTs && <div className="mt-1 text-[11px] text-text-muted">Next autonomous run {relTime(history.nextDueTs)}.</div>}
          </AppCard>
          <AppCard icon={Activity} label="Run history">
            {history === null ? (
              <div className="text-[12px] text-text-muted">loading…</div>
            ) : history.runs.length === 0 ? (
              <div className="text-[12px] text-text-muted">No runs recorded yet. Use Sync now above to run this app.</div>
            ) : (
              <ul className="space-y-1">
                {[...history.runs].reverse().map((r, i) => (
                  <li key={`${r.ts}-${i}`} title={r.error ?? r.summary ?? undefined} className="flex items-center gap-2.5 rounded-lg border border-border-subtle bg-background px-3 py-2 text-[12px]">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: r.ok ? "#2fb87a" : "#e06c75" }} />
                    <span className="shrink-0 text-text-secondary">{relTime(r.ts)}</span>
                    <span className="truncate font-mono text-[10px] text-text-muted">{r.skill}</span>
                    <span className="ml-auto flex shrink-0 items-center gap-2.5 font-mono text-[10px] text-text-muted">
                      {r.artifacts > 0 && <span>{r.artifacts} artifact{r.artifacts === 1 ? "" : "s"}</span>}
                      <span>{r.duration_ms < 1000 ? `${r.duration_ms}ms` : `${(r.duration_ms / 1000).toFixed(1)}s`}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {history && history.runs.length > 0 && (
              <p className="mt-2 text-[10px] text-text-muted/60">Most recent {history.runs.length} run{history.runs.length === 1 ? "" : "s"} (manual and autonomous). Older runs roll off.</p>
            )}
          </AppCard>
        </>
      )}

      {appTab === "domains" && (
        <>
          {domainEditor}
          <p className="px-1 text-[11px] text-text-muted/70">Conversations with {app.title} are kept here, independent of any domain{doms.length > 0 ? `, grounded in ${titleCase(doms[0])}` : ""}.</p>
        </>
      )}
    </div>
  );
}


// I8 + I6: domain-level Insights — aggregates the proactive "For You" surface
// (questions + suggested next steps), the per-domain task list, and the recent
// intents ledger in one place, independent of any single thread. This is where
// "what should I work on?" and "what have I been asking?" live for a domain.


// Compact strip of the apps bound to this domain, with live status dots, shown
// at the top of the domain view so you can see at a glance which feeds are fresh.

const SECTION_LABEL =
  "font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary";

// agent stays expanded. Clicking sets the chat panel's primary CLI.
// Full-canvas preferences panel for the currently-selected domain.
// Replaces the popover. Every control writes to localStorage on
// click; no save button — picks are immediate. Pickers use brand
// icons for CLIs, prose labels for everything else.
function DomainPrefsPanel({
  domain,
  vaultPath,
  clis,
  skills,
  preferredSkills,
  onTogglePreferredSkill,
  onChanged,
  onBack,
}: {
  domain: string;
  vaultPath: string;
  clis: CliInfo[];
  skills: SkillEntry[];
  preferredSkills: string[];
  onTogglePreferredSkill: (name: string) => void;
  onChanged: () => void;
  onBack?: () => void;
}) {
  // Read overrides directly so save buttons are unnecessary —
  // bump tick on every write so this component re-renders.
  const [tick, setTick] = useState(0);
  const force = () => { setTick((t) => t + 1); onChanged(); };
  void tick;
  // Skill list collapses by default so a long roster doesn't crowd the panel.
  const [skillsOpen, setSkillsOpen] = useState(false);

  const cliKey = `prevail.domain.${domain}.cli`;
  const modelKey = `prevail.domain.${domain}.model`;
  const fwKey = `prevail.domain.${domain}.framework`;
  const lensKey = `prevail.domain.${domain}.lens`;
  const autoStateKey = `prevail.domain.${domain}.autoState`;
  // Privacy / sandbox / routing live in top-level manifest blocks (not
  // config), but we mirror to localStorage too so the rest of the app
  // (ChatPanel reads prevail.domain.<name>.localOnly) keeps working.
  const localOnlyKey = `prevail.domain.${domain}.localOnly`;
  const sandboxKey = `prevail.domain.${domain}.sandbox`;
  const keywordsKey = `prevail.domain.${domain}.routing.keywords`;

  // Per-domain daemon config (_daemon.json) — taskgen + reminders toggles.
  // Default true so domains work without any config file.
  const daemonCfgPath = `${vaultPath}/${domain}/_daemon.json`;
  const [daemonTaskgen, setDaemonTaskgen] = useState(true);
  const [daemonReminders, setDaemonReminders] = useState(true);
  const [daemonSkillgen, setDaemonSkillgen] = useState(true);
  useEffect(() => {
    invoke<string>("read_text_file", { path: daemonCfgPath })
      .then((raw) => {
        try {
          const cfg = JSON.parse(raw);
          if (typeof cfg.taskgen === "boolean") setDaemonTaskgen(cfg.taskgen);
          if (typeof cfg.reminders === "boolean") setDaemonReminders(cfg.reminders);
          if (typeof cfg.skillgen === "boolean") setDaemonSkillgen(cfg.skillgen);
        } catch {}
      })
      .catch(() => {}); // file absent → defaults (true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daemonCfgPath]);
  function saveDaemonCfg(patch: { taskgen?: boolean; reminders?: boolean; skillgen?: boolean }) {
    const next = { taskgen: daemonTaskgen, reminders: daemonReminders, skillgen: daemonSkillgen, ...patch };
    invoke("write_text_file", { path: daemonCfgPath, contents: JSON.stringify(next, null, 2) }).catch(() => {});
  }

  // Per-domain prefs are stored in the domain's manifest (config block)
  // when the engine supports it, and ALSO mirrored to localStorage so the
  // rest of the app (ChatPanel) — which reads localStorage — keeps working.
  // On mount we load the manifest and hydrate any localStorage keys that
  // aren't already set from it. When the manifest is unavailable we fall
  // back to localStorage-only (the previous behavior).
  const [manifestReady, setManifestReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const m = await invoke<DomainManifest>("engine_manifest_get", { vault: vaultPath, domain });
        if (cancelled) return;
        const cfg = m?.config;
        if (cfg) {
          // Hydrate localStorage from the manifest only where the user
          // hasn't already set a local override, so the manifest acts as
          // the durable store without clobbering an in-flight local edit.
          if (!lsGet(cliKey) && cfg.cli) lsSet(cliKey, cfg.cli);
          if (!lsGet(modelKey) && cfg.model) lsSet(modelKey, cfg.model);
          if (!lsGet(fwKey) && cfg.framework) lsSet(fwKey, cfg.framework);
          if (!lsGet(lensKey) && cfg.lens) lsSet(lensKey, cfg.lens);
          if (!lsGet(autoStateKey)) lsSet(autoStateKey, cfg.autoState === false ? "0" : "1");
          // Preferred skills come from the parent; seed them from the
          // manifest when none are pinned yet.
          if (Array.isArray(cfg.skills) && cfg.skills.length > 0 && preferredSkills.length === 0) {
            for (const s of cfg.skills) onTogglePreferredSkill(s);
          }
        }
        // Hydrate top-level privacy / sandbox / routing blocks.
        if (!lsGet(localOnlyKey)) lsSet(localOnlyKey, m?.privacy?.localOnly ? "1" : "0");
        if (!lsGet(sandboxKey)) lsSet(sandboxKey, m?.sandbox?.mode === "locked" ? "locked" : "open");
        if (!lsGet(keywordsKey) && Array.isArray(m?.routing?.keywords)) {
          // A6: the domain name is an implicit, non-editable default keyword, so
          // strip it from the editable "extras" we hydrate into the input.
          const extras = (m.routing!.keywords as string[]).filter(
            (k) => k.trim().toLowerCase() !== domain.toLowerCase(),
          );
          lsSet(keywordsKey, extras.join(", "));
        }
        // Nothing stored and nothing in the manifest: derive routing keywords
        // from the domain's own goals/soul so routing works without manual
        // setup. Frequency-ranked distinctive words, top six.
        if (!lsGet(keywordsKey)) {
          try {
            const texts = await Promise.all(
              ["goals.md", "soul.md", "config.md"].map((f) =>
                invoke<string>("read_text_file", { path: `${vaultPath}/${domain}/${f}` }).catch(() => ""),
              ),
            );
            const STOP = new Set("the and for with that this from your you are was have has not but they them then than when what where which while will would could should about into over under each every some most more very just also like been being our their his her its only own same can may might must a an of to in on at by it is as or be do if no so we i me my".split(" "));
            const freq = new Map<string, number>();
            for (const w of texts.join(" ").toLowerCase().split(/[^a-z][^a-z]*/)) {
              if (w.length < 4 || STOP.has(w) || w === domain.toLowerCase()) continue;
              freq.set(w, (freq.get(w) ?? 0) + 1);
            }
            const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([w]) => w);
            if (top.length > 0) lsSet(keywordsKey, top.join(", "));
          } catch { /* derivation is best-effort */ }
        }
      } catch {
        // Engine/manifest unavailable — localStorage remains the source.
      } finally {
        if (!cancelled) { setManifestReady(true); force(); }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultPath, domain]);

  // Merge a partial config block into the manifest. Best-effort: failures
  // are swallowed so localStorage stays the working fallback.
  const persistManifest = useCallback(
    (config: Record<string, unknown>) => {
      const json = JSON.stringify({ config });
      invoke("engine_manifest_set", { vault: vaultPath, domain, json }).catch(() => {
        /* manifest write unsupported — localStorage already holds the value */
      });
    },
    [vaultPath, domain],
  );

  // Merge an arbitrary top-level manifest patch (e.g. privacy / sandbox /
  // routing blocks). Best-effort — same fallback contract as persistManifest.
  const persistManifestTop = useCallback(
    (patch: Record<string, unknown>) => {
      const json = JSON.stringify(patch);
      invoke("engine_manifest_set", { vault: vaultPath, domain, json }).catch(() => {
        /* manifest write unsupported — localStorage already holds the value */
      });
    },
    [vaultPath, domain],
  );

  // Mirror preferred-skill changes into the manifest once loaded.
  const skillsSig = preferredSkills.join(",");
  useEffect(() => {
    if (!manifestReady) return;
    persistManifest({ skills: preferredSkills });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skillsSig, manifestReady]);

  const pickedCli = lsGet(cliKey);
  const pickedModel = lsGet(modelKey);
  const pickedFw = lsGet(fwKey);
  const pickedLens = lsGet(lensKey);
  const autoState = lsGet(autoStateKey) !== "0";
  const localOnly = lsGet(localOnlyKey) === "1";
  const sandboxMode = lsGet(sandboxKey) === "locked" ? "locked" : "open";
  const keywordsRaw = lsGet(keywordsKey);

  // Map a localStorage pref key to its manifest config field so writes go
  // to both stores.
  const KEY_TO_CONFIG: Record<string, string> = {
    [cliKey]: "cli",
    [modelKey]: "model",
    [fwKey]: "framework",
    [lensKey]: "lens",
  };

  function setOverride(key: string, value: string) {
    lsSet(key, value);
    const field = KEY_TO_CONFIG[key];
    if (field) persistManifest({ [field]: value || null });
    force();
  }

  void onBack;
  return (
    <div className="w-full">
      {/* Header */}
      <div className="mb-6 flex items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-semibold tracking-tight">Preferences</h2>
          <p className="mt-1 text-sm text-text-secondary">
            Domain-only overrides. Pickers apply on the next reload of this domain; global defaults still apply when these are unset.
          </p>
        </div>
        <button
          onClick={() => {
            for (const k of [cliKey, modelKey, fwKey, lensKey, autoStateKey, `prevail.domain.${domain}.skills`, localOnlyKey, sandboxKey, keywordsKey]) {
              lsSet(k, "");
            }
            // Clear the manifest config overrides too.
            persistManifest({ cli: null, model: null, framework: null, lens: null, autoState: true, skills: [] });
            persistManifestTop({ privacy: { localOnly: false }, sandbox: { mode: "open" }, routing: { keywords: [] } });
            force();
          }}
          className="shrink-0 rounded-md border border-border bg-background px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:border-warn hover:text-warn"
        >
          reset all
        </button>
      </div>

      {/* CLI picker — select a CLI to expand its models inline (collapse & indent) */}
      <section className="mb-6 rounded-xl border border-border bg-surface p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">CLI</div>
            <p className="mt-0.5 text-sm text-text-secondary">Which agent runs every prompt in {titleCase(domain)}. Pick one to choose its model.</p>
          </div>
          {pickedCli && (
            <button
              onClick={() => { setOverride(cliKey, ""); setOverride(modelKey, ""); }}
              className="rounded border border-border bg-background px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent"
            >
              use global
            </button>
          )}
        </div>
        {/* List rows; the selected CLI expands to show its models indented below. */}
        <div className="flex flex-col gap-1.5">
          {clis.filter((c) => !isBunkerOn() || isLocalCli(c.id)).map((c) => {
            const picked = pickedCli === c.id;
            const disabled = !c.available;
            const models = MODELS[c.id] ?? [];
            return (
              <div key={c.id}>
                <button
                  disabled={disabled}
                  onClick={() => setOverride(cliKey, c.id)}
                  title={disabled ? `${c.label} not installed` : c.label}
                  className={`group flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors ${
                    picked
                      ? "border-accent bg-accent-soft ring-1 ring-accent/20"
                      : disabled
                      ? "border-border-subtle bg-background opacity-40"
                      : "border-border bg-background hover:bg-surface-warm"
                  }`}
                >
                  <ProviderMark vendor={c.id} size={22} />
                  <span className={`flex-1 font-display text-sm font-semibold tracking-tight ${picked ? "text-accent" : "text-text-primary"}`}>
                    {c.label}
                  </span>
                  {disabled && (
                    <span className="font-mono text-[9px] uppercase tracking-wider text-text-muted">not installed</span>
                  )}
                  {!disabled && models.length > 0 && (
                    <svg className={`h-3.5 w-3.5 text-text-muted transition-transform ${picked ? "rotate-180" : ""}`} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5}>
                      <path d="M3 4.5L6 7.5L9 4.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                  {picked && (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-background">
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </span>
                  )}
                </button>
                {/* Models — indented under the selected CLI, collapsed otherwise. */}
                {picked && models.length > 0 && (
                  <div className="ml-4 mt-1.5 flex flex-col gap-1.5 border-l-2 border-accent-border/40 pl-4">
                    <div className="flex items-center justify-between pt-0.5">
                      <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-text-muted">Model</span>
                      {pickedModel && (
                        <button
                          onClick={() => setOverride(modelKey, "")}
                          className="rounded border border-border bg-background px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent"
                        >
                          use cli default
                        </button>
                      )}
                    </div>
                    {models.map((m) => {
                      const mpicked = pickedModel === m.id;
                      return (
                        <button
                          key={m.id}
                          onClick={() => setOverride(modelKey, m.id)}
                          className={`flex items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors ${
                            mpicked
                              ? "border-accent bg-accent-soft"
                              : "border-border-subtle bg-background hover:border-accent-border"
                          }`}
                        >
                          <span className={`shrink-0 font-mono text-sm ${mpicked ? "font-semibold text-accent" : "text-text-primary"}`}>{m.label}</span>
                          {m.blurb && <span className="min-w-0 flex-1 truncate text-[11px] text-text-muted">{m.blurb}</span>}
                          {mpicked && (
                            <span className="ml-auto flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent text-background">
                              <Check className="h-2.5 w-2.5" strokeWidth={3} />
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Framework + Lens — stacked full-width, one per row */}
      <section className="mb-6 grid grid-cols-1 gap-4">
        <PrefPickerColumn
          glyph="◆"
          title="Framework"
          options={FRAMEWORKS as readonly { id: string; label: string; blurb: string }[]}
          selected={pickedFw}
          onSelect={(id) => setOverride(fwKey, id)}
          onClear={() => setOverride(fwKey, "")}
        />
        <PrefPickerColumn
          glyph="◇"
          title="Lens"
          options={LENSES as readonly { id: string; label: string; blurb: string }[]}
          selected={pickedLens}
          onSelect={(id) => setOverride(lensKey, id)}
          onClear={() => setOverride(lensKey, "")}
        />
      </section>

      {/* Skills — star-toggle list with avatars; collapsed by default, indented when open */}
      <section className="mb-6 rounded-xl border border-border bg-surface p-4">
        <button
          onClick={() => setSkillsOpen((v) => !v)}
          className="flex w-full items-start gap-2 text-left"
        >
          <ChevronRight className={`mt-1 h-3.5 w-3.5 shrink-0 text-text-muted transition-transform ${skillsOpen ? "rotate-90" : ""}`} strokeWidth={2.5} />
          <div className="flex-1">
            <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">Skills · {skills.length}</div>
            <p className="mt-0.5 text-sm text-text-secondary">
              Pinned skills auto-attach to every new chat in {titleCase(domain)}.
              <span className="ml-2 font-mono text-[10px] text-text-muted">★ pinned · ☆ tap to pin</span>
            </p>
          </div>
        </button>
        {skillsOpen && (skills.length === 0 ? (
          <div className="mt-3 ml-5 rounded border border-dashed border-border bg-background p-4 text-sm text-text-muted">
            No skills under <code className="text-accent">{titleCase(domain)}/skills/</code> yet.
          </div>
        ) : (
          <ul className="mt-3 ml-5 flex flex-col gap-1.5 border-l border-border-subtle pl-3">
            {skills.map((s) => {
              const on = preferredSkills.includes(s.name);
              const color = pickSkillColor(s.name);
              return (
                <li key={s.path} className="flex items-center gap-3 rounded-md border border-border-subtle bg-background px-3 py-2">
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md font-display text-sm font-bold ring-1 ring-black/5"
                    style={{ background: color.bg, color: color.fg }}
                  >
                    {(s.name || "·").charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-sm text-accent">/{s.name}</div>
                    {s.description && <div className="line-clamp-1 text-[11px] text-text-muted">{s.description}</div>}
                  </div>
                  <button
                    onClick={() => onTogglePreferredSkill(s.name)}
                    className={`shrink-0 rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-wider ${
                      on
                        ? "border-accent-border bg-accent-soft text-accent"
                        : "border-border bg-background text-text-muted hover:border-accent-border hover:text-accent"
                    }`}
                  >
                    {on ? "★ pinned" : "☆ pin"}
                  </button>
                </li>
              );
            })}
          </ul>
        ))}
      </section>

      {/* Behavior toggles */}
      <section className="mb-6 rounded-xl border border-border bg-surface p-4">
        <div className="mb-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">Behavior</div>
        <div className="flex items-center justify-between gap-3 py-2">
          <div>
            <div className="text-sm font-semibold text-text-primary">Auto-attach state.md</div>
            <div className="mt-0.5 text-xs text-text-secondary">
              {autoState
                ? "Each new chat starts with state.md as a context chip you can remove."
                : "Manual: drag the domain in or use the Context drawer to attach state.md."}
            </div>
          </div>
          <Toggle
            on={autoState}
            onChange={(v) => { lsSet(autoStateKey, v ? "1" : "0"); persistManifest({ autoState: v }); force(); }}
            label="Auto-attach state.md"
          />
        </div>
      </section>

      {/* Privacy — local-only (Ollama) pin → manifest.privacy.localOnly */}
      <section className="mb-6 rounded-xl border border-border bg-surface p-4">
        <div className="mb-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">Privacy</div>
        <div className="flex items-center justify-between gap-3 py-2">
          <div>
            <div className="text-sm font-semibold text-text-primary">Local-only (Ollama)</div>
            <div className="mt-0.5 text-xs text-text-secondary">
              {localOnly
                ? "Every prompt in this domain is forced through a local model: nothing leaves your machine."
                : "Off: prompts use the domain's configured CLI, which may call a cloud model."}
            </div>
          </div>
          <Toggle
            on={localOnly}
            onChange={(v) => {
              lsSet(localOnlyKey, v ? "1" : "0");
              persistManifestTop({ privacy: { localOnly: v } });
              force();
            }}
            label="Local-only (Ollama)"
          />
        </div>
      </section>

      {/* Sandbox — open | locked → manifest.sandbox.mode */}
      <section className="mb-6 rounded-xl border border-border bg-surface p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">Sandbox</div>
            <p className="mt-0.5 text-sm text-text-secondary">
              {sandboxMode === "locked"
                ? "Locked: agents can read this domain but cannot write files or run shell side-effects."
                : "Open: agents can read and write within this domain's folder."}
            </p>
          </div>
          <select
            value={sandboxMode}
            onChange={(e) => {
              const v = e.target.value === "locked" ? "locked" : "open";
              lsSet(sandboxKey, v);
              persistManifestTop({ sandbox: { mode: v } });
              force();
            }}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:border-accent-border focus:outline-none"
          >
            <option value="open">open</option>
            <option value="locked">locked</option>
          </select>
        </div>
      </section>

      {/* Channels / routing — domain name is always matched (A6); the input
          holds extra keywords → manifest.routing.keywords = [domain, ...extras] */}
      <section className="mb-6 rounded-xl border border-border bg-surface p-4">
        <div className="mb-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">Channels &amp; routing</div>
        <p className="mb-3 text-sm text-text-secondary">
          When a bridge (e.g. Telegram) receives a message, these keywords route it to {titleCase(domain)}.
          The domain name always matches; add extras below. Saved to the domain manifest.
        </p>
        <div className="mb-2 flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full border border-accent-border bg-accent-soft px-2.5 py-1 font-mono text-xs text-accent" title="Always matched: the domain name is a built-in keyword">
            <Pin className="h-3 w-3" /> {domain.toLowerCase()}
          </span>
          <span className="font-mono text-[10px] text-text-muted">always on</span>
        </div>
        <input
          defaultValue={keywordsRaw}
          key={`kw-${domain}-${manifestReady ? 1 : 0}`}
          placeholder="extra keywords: invoices, taxes, deductions…"
          onBlur={(e) => {
            const extras = e.target.value
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
              .filter((k) => k.toLowerCase() !== domain.toLowerCase());
            lsSet(keywordsKey, extras.join(", "));
            // Persist the domain name as the first keyword so routing always
            // matches it even when the user adds none.
            const full = [domain.toLowerCase(), ...extras].filter(
              (k, i, a) => a.indexOf(k) === i,
            );
            persistManifestTop({ routing: { keywords: full } });
            force();
          }}
          className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm focus:border-accent-border focus:outline-none"
          spellCheck={false}
        />
        <div className="mt-2 font-mono text-[10px] text-text-muted">
          Edits save when the field loses focus.
        </div>
      </section>

      <section className="mb-6 rounded-xl border border-border bg-surface p-4">
        <div className="mb-3 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">Daemons</div>
        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm font-medium text-text-primary">Task generation</div>
              <div className="mt-0.5 text-xs text-text-secondary">AI proactively writes tasks for this domain from your goals and memory.</div>
            </div>
            <Toggle on={daemonTaskgen} onChange={(v) => { setDaemonTaskgen(v); saveDaemonCfg({ taskgen: v }); }} />
          </div>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm font-medium text-text-primary">Reminders</div>
              <div className="mt-0.5 text-xs text-text-secondary">Fire a notification when tasks in this domain are due or overdue.</div>
            </div>
            <Toggle on={daemonReminders} onChange={(v) => { setDaemonReminders(v); saveDaemonCfg({ reminders: v }); }} />
          </div>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm font-medium text-text-primary">Skill learning</div>
              <div className="mt-0.5 text-xs text-text-secondary">Distill reusable skills from this domain's conversations as you use it.</div>
            </div>
            <Toggle on={daemonSkillgen} onChange={(v) => { setDaemonSkillgen(v); saveDaemonCfg({ skillgen: v }); }} />
          </div>
        </div>
      </section>
    </div>
  );
}

function PrefPickerColumn({
  glyph,
  title,
  options,
  selected,
  onSelect,
  onClear,
}: {
  glyph: string;
  title: string;
  options: readonly { id: string; label: string; blurb: string }[];
  selected: string;
  onSelect: (id: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className={`flex items-center gap-2 ${SECTION_LABEL}`}>
          <span className="text-accent">{glyph}</span> {title}
        </div>
        {selected && (
          <button
            onClick={onClear}
            className="rounded border border-border bg-background px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent"
          >
            use global
          </button>
        )}
      </div>
      <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
        {options.map((o) => {
          const picked = selected === o.id;
          return (
            <button
              key={o.id}
              onClick={() => onSelect(o.id)}
              className={`flex items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors ${
                picked
                  ? "border-accent bg-accent-soft"
                  : "border-border-subtle bg-background hover:border-accent-border"
              }`}
            >
              <span className={`shrink-0 font-mono text-sm ${picked ? "font-semibold text-accent" : "text-text-primary"}`}>{o.label}</span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-text-muted">{o.blurb}</span>
              {picked && (
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent text-background">
                  <Check className="h-2.5 w-2.5" strokeWidth={3} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AgentPickerRail({
  clis,
  selected,
  onSelect,
}: {
  clis: CliInfo[];
  selected: string | null;
  onSelect: (cliId: string) => void;
}) {
  const verify = useCliVerifyLive();
  if (clis.length === 0) return null;
  return (
    <div className="mt-3 flex items-center gap-1 rounded-full border border-border bg-surface px-1.5 py-1 shadow-sm">
      {clis
        .filter((c) => !isBunkerOn() || isLocalCli(c.id))
        // A provider that failed validation is not offered for chat: pick a
        // dead provider and the send just errors. It stays on the Models page
        // with the reason and a login hint.
        .filter((c) => verify.get(c.id)?.status !== "failed")
        .map((c) => {
        const active = c.id === selected;
        const v = verify.get(c.id)?.status;
        return (
          <button
            key={c.id}
            onClick={() => onSelect(c.id)}
            title={`${c.label}${v === "ok" ? " · validated" : v === "verifying" ? " · validating…" : " · not validated yet"}`}
            className={`group relative flex items-center gap-2 rounded-full px-2 py-1 transition-all ${
              active ? "bg-surface-warm" : "hover:bg-surface-warm"
            }`}
          >
            <span className="relative">
              <ProviderMark vendor={c.id} size={24} />
              {v === "ok" && (
                <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-ok text-[8px] font-bold leading-none text-background">✓</span>
              )}
              {v === "verifying" && (
                <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 animate-pulse rounded-full bg-text-muted" />
              )}
            </span>
            <span
              className={`overflow-hidden whitespace-nowrap font-display text-sm font-semibold tracking-tight transition-all duration-200 ease-out ${
                active
                  ? "max-w-[160px] pr-1 opacity-100"
                  : "max-w-0 pr-0 opacity-0 group-hover:max-w-[160px] group-hover:pr-1 group-hover:opacity-100"
              }`}
            >
              {c.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// I7: create a reusable skill from the UI — the "build skills over time" path.
// A skill is just a named, reusable prompt the model runs on demand (slash
// `/name` in chat). Seeded from the composer's "Save as skill" or written here.


// Side drawer that shows the current domain's state.md, decisions,
// journal, recent session logs, and skills. Loaded on-demand via the
// `domain_context` Rust command. Items can be "used in chat" to
// inject as prompt context.
function DomainContextDrawer({
  domain,
  vaultPath,
  domainPath,
  onClose,
  onInjectContext,
  onInsertSkill,
  preferredSet,
  onTogglePreferred,
}: {
  domain: string;
  vaultPath: string;
  domainPath: string;
  onClose: () => void;
  onInjectContext: (text: string, label: string) => void;
  onInsertSkill: (skillName: string) => void;
  preferredSet?: Set<string>;
  onTogglePreferred?: (name: string) => void;
}) {
  const [ctx, setCtx] = useState<DomainContextBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({
    recent: true, memory: false, state: false, decisions: false, journal: false, logs: false, skills: false,
  });
  // Live decision ledger (_decisions.jsonl) + distilled long-term memory.
  // These update the moment a verdict is saved — no waiting on distillation.
  type DecisionRecord = { id?: string; ts?: number; kind?: string; prompt?: string; verdict?: string; feedback?: { rating?: string } | string | null };
  const [decisionLog, setDecisionLog] = useState<DecisionRecord[]>([]);
  const [memory, setMemory] = useState<string>("");
  const [drawerWidth, setDrawerWidth] = useState<number>(() => {
    const v = parseInt(lsGet("prevail.contextDrawer.width"), 10);
    return Number.isFinite(v) && v > 0 ? v : 320;
  });
  useEffect(() => { lsSet("prevail.contextDrawer.width", String(drawerWidth)); }, [drawerWidth]);
  useEffect(() => {
    let mounted = true;
    setLoading(true);
    const load = () => {
      // Domain files (state/decisions/journal/logs/skills) only exist for a
      // real domain; General has none, so skip the call and show the
      // cross-cutting context instead.
      if (domain) {
        invoke<DomainContextBundle>("domain_context", { vault: vaultPath, domain })
          .then((c) => { if (mounted) { setCtx(c); setErr(null); } })
          .catch((e) => { if (mounted) setErr(String(e)); })
          .finally(() => { if (mounted) setLoading(false); });
      } else {
        if (mounted) { setCtx(null); setErr(null); setLoading(false); }
      }
      invoke<DecisionRecord[]>("decisions_read", { vault: vaultPath, domain: domain || null, limit: 15 })
        .then((d) => { if (mounted) setDecisionLog(Array.isArray(d) ? d : []); })
        .catch(() => { if (mounted) setDecisionLog([]); });
      invoke<string>("read_memory_md", { vault: vaultPath, domain: domain || null })
        .then((m) => { if (mounted) setMemory(m || ""); })
        .catch(() => { if (mounted) setMemory(""); });
      invoke<string>("read_ideal_state", { vault: vaultPath })
        .then((s) => { if (mounted) setIdealState(s || ""); })
        .catch(() => { if (mounted) setIdealState(""); });
    };
    load();
    // Refresh the instant a decision/verdict is saved anywhere in the app.
    const onChanged = () => load();
    window.addEventListener("prevail:context-changed", onChanged);
    return () => { mounted = false; window.removeEventListener("prevail:context-changed", onChanged); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultPath, domain]);

  const [idealState, setIdealState] = useState<string>("");

  const Section = ({
    keyName, title, count, body,
  }: { keyName: string; title: string; count?: number; body: React.ReactNode }) => (
    <div className="border-b border-border-subtle">
      <button
        onClick={() => setOpen((o) => ({ ...o, [keyName]: !o[keyName] }))}
        className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left hover:bg-surface-warm"
      >
        <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-text-secondary">
          <span className="text-accent">{open[keyName] ? "▾" : "▸"}</span>
          {title}
          {count !== undefined && <span className="text-text-muted">· {count}</span>}
        </span>
      </button>
      {open[keyName] && <div className="px-4 pb-4 text-sm">{body}</div>}
    </div>
  );

  return (
    <div className="flex shrink-0">
      <ResizeHandle
        ariaLabel="Resize context drawer"
        onChange={(dx) => setDrawerWidth((w) => Math.max(260, Math.min(640, w - dx)))}
      />
      <aside className="flex shrink-0 flex-col border-l border-border-subtle bg-surface-warm" style={{ width: drawerWidth }}>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border-subtle px-4 py-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-text-muted">Context</div>
          <div className="flex items-center gap-2 font-display text-base font-semibold">
            {(() => {
              const I = domain ? domainIcon(domain) : MessageSquare;
              return I ? <I className="h-4 w-4 text-accent" /> : <span className="text-accent">◆</span>;
            })()}
            {domain ? titleCase(domain) : "General"}
          </div>
        </div>
        <button
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-surface-warm hover:text-text-primary"
          title="Collapse context"
        >
          <PanelRightClose className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading && <div className="p-4 text-xs text-text-muted">loading…</div>}
        {err && <div className="m-2 rounded border border-warn/40 bg-warn/10 p-3 text-xs text-warn">{err}</div>}
        {!domain && (
          <div className="border-b border-border-subtle px-4 py-2.5 text-[11px] text-text-muted">
            Context that spans your whole workspace: decisions you've made and what Prevail has learned. Pick a domain for its state, journal, and skills.
          </div>
        )}
        {/* Recent decisions = the raw live ledger (_decisions.jsonl). "Decisions"
            below = the distiller's curated summary. The caption explains the
            promotion so the two are never confused (always shown, not just empty). */}
        <Section keyName="recent" title="Recent decisions" count={decisionLog.length} body={
          <>
          <div className="mb-2 text-[11px] leading-snug text-text-muted">
            The live feed: council verdicts and saved decisions appear here the instant they happen (latest 15). The distiller later folds these into a curated <span className="font-semibold">Decisions</span> summary below.
          </div>
          {decisionLog.length === 0 ? (
            <div className="text-xs text-text-muted">Nothing yet. Run a council or save a decision and it shows here immediately.</div>
          ) : (
            <ul className="flex flex-col gap-2">
              {decisionLog.map((d, i) => {
                const fb = typeof d.feedback === "object" && d.feedback ? d.feedback.rating : (typeof d.feedback === "string" ? d.feedback : undefined);
                const ago = d.ts ? formatFreshness(Math.max(0, Math.floor((Date.now() - d.ts) / 1000))) : "";
                return (
                  <li key={d.id ?? i} className="rounded-lg border border-border-subtle bg-background p-2.5">
                    <div className="mb-1 flex items-center justify-between gap-2 font-mono text-[9px] uppercase tracking-wider text-text-muted">
                      <span>{d.kind ?? "decision"}{ago ? ` · ${ago}` : ""}</span>
                      {fb === "up" && <ThumbsUp className="h-3 w-3 text-accent" />}
                      {fb === "down" && <ThumbsDown className="h-3 w-3 text-red-500" />}
                    </div>
                    {d.prompt && <div className="line-clamp-1 text-[11px] font-semibold text-text-primary">{d.prompt}</div>}
                    {d.verdict && <div className="mt-1 line-clamp-3 whitespace-pre-wrap text-[11px] leading-snug text-text-secondary">{d.verdict}</div>}
                    {d.verdict && (
                      <button
                        onClick={() => onInjectContext(d.verdict!, `decision · ${(d.prompt ?? "").slice(0, 30)}`)}
                        className="mt-1.5 rounded-md border border-accent-border bg-accent-soft px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-accent hover:bg-accent hover:text-background"
                      >
                        → use in chat
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          </>
        } />
        <Section keyName="ideal" title="Ideal state" body={
          idealState.trim() ? (
            <>
              <p className="mb-2 text-[11px] leading-relaxed text-text-muted">
                Your constitution. It is already injected at highest precedence into every chat and council turn; pull it in explicitly when you want the model to reason against it at length.
              </p>
              <button
                onClick={() => onInjectContext(idealState, "Ideal State · constitution")}
                className="mb-2 rounded-md border border-accent-border bg-accent-soft px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-accent hover:bg-accent hover:text-background"
              >
                → use in chat
              </button>
              <pre className="whitespace-pre-wrap rounded border border-border-subtle bg-background px-3 py-2 font-mono text-[11px] leading-relaxed text-text-secondary">
                {idealState.length > 1200 ? idealState.slice(0, 1200) + "\n…" : idealState}
              </pre>
            </>
          ) : <div className="text-xs text-text-muted">No Ideal State written yet. Settings → Ideal State.</div>
        } />
        <Section keyName="memory" title="Long-term memory" body={
          memory.trim() ? (
            <>
              <button
                onClick={() => onInjectContext(memory, `${domain ? titleCase(domain) : "General"} · memory`)}
                className="mb-2 rounded-md border border-accent-border bg-accent-soft px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-accent hover:bg-accent hover:text-background"
              >
                → use in chat
              </button>
              <pre className="whitespace-pre-wrap rounded border border-border-subtle bg-background px-3 py-2 font-mono text-[11px] leading-relaxed text-text-secondary">
                {memory.length > 1200 ? memory.slice(0, 1200) + "\n…" : memory}
              </pre>
            </>
          ) : <div className="text-xs text-text-muted">No distilled memory yet. The background distiller (Settings → Daemons) compacts your activity into memory once enough new material accumulates, usually within a few sessions.</div>
        } />
        {ctx && (
          <>
            <Section keyName="state" title="State" body={
              ctx.state ? (
                <>
                  <button
                    onClick={() => onInjectContext(ctx.state!, `${titleCase(domain)}/state.md`)}
                    className="mb-2 rounded-md border border-accent-border bg-accent-soft px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-accent hover:bg-accent hover:text-background"
                  >
                    → use in chat
                  </button>
                  <pre className="whitespace-pre-wrap rounded border border-border-subtle bg-background px-3 py-2 font-mono text-[11px] leading-relaxed text-text-secondary">
                    {ctx.state.length > 1200 ? ctx.state.slice(0, 1200) + "\n…" : ctx.state}
                  </pre>
                </>
              ) : <div className="text-xs text-text-muted">No state yet. The distiller derives a state snapshot from your activity in this domain; it appears after your first few chats here.</div>
            } />
            <Section keyName="decisions" title="Decisions" body={
              <>
              <div className="mb-2 text-[11px] leading-snug text-text-muted">
                The curated summary the distiller writes from your decision history (its file: <span className="font-mono">_journal/decisions.md</span>). A <span className="font-semibold">Recent decision</span> moves here on the distiller's next pass, condensed and deduplicated. Empty until that first pass runs.
              </div>
              {ctx.decisions ? (
                <>
                  <button
                    onClick={() => onInjectContext(ctx.decisions!, `${titleCase(domain)}/decisions.md`)}
                    className="mb-2 rounded-md border border-accent-border bg-accent-soft px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-accent hover:bg-accent hover:text-background"
                  >
                    → use in chat
                  </button>
                  <pre className="whitespace-pre-wrap rounded border border-border-subtle bg-background px-3 py-2 font-mono text-[11px] leading-relaxed text-text-secondary">
                    {ctx.decisions.length > 1200 ? ctx.decisions.slice(0, 1200) + "\n…" : ctx.decisions}
                  </pre>
                </>
              ) : <div className="text-xs text-text-muted">No curated summary yet. It appears after the distiller's next pass over your recent decisions.</div>}
              </>
            } />
            <Section keyName="journal" title="Journal" body={
              ctx.journal ? (
                <>
                  <button
                    onClick={() => onInjectContext(ctx.journal!, `${titleCase(domain)}/_journal`)}
                    className="mb-2 rounded-md border border-accent-border bg-accent-soft px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-accent hover:bg-accent hover:text-background"
                  >
                    → use in chat
                  </button>
                  <pre className="whitespace-pre-wrap rounded border border-border-subtle bg-background px-3 py-2 font-mono text-[11px] leading-relaxed text-text-secondary">
                    {ctx.journal.length > 1500 ? ctx.journal.slice(0, 1500) + "\n…" : ctx.journal}
                  </pre>
                </>
              ) : <div className="text-xs text-text-muted">No journal yet. Journal entries are curated from chat turns run through the engine; desktop chats feed State and Decisions via the distiller instead.</div>
            } />
            <Section keyName="logs" title="Session logs" count={ctx.recent_logs.length} body={
              ctx.recent_logs.length === 0 ? (
                <div className="text-xs text-text-muted">No session logs yet. Engine sessions write daily logs here; your desktop chat history lives under Insights and the thread list.</div>
              ) : (
                <ul className="space-y-1">
                  {ctx.recent_logs.map((l) => (
                    <li key={l.path}>
                      <button
                        onClick={async () => {
                          try {
                            const body = await invoke<string>("read_file", { path: l.path });
                            onInjectContext(body, l.name);
                          } catch (e) { console.error(e); }
                        }}
                        className="w-full rounded border border-border-subtle bg-background px-2 py-1.5 text-left hover:border-accent-border hover:bg-surface-warm"
                      >
                        <div className="font-mono text-[11px] text-text-primary">{l.name}</div>
                        {l.preview && <div className="mt-0.5 line-clamp-2 text-[10px] text-text-muted">{l.preview}</div>}
                      </button>
                    </li>
                  ))}
                </ul>
              )
            } />
            <Section keyName="skills" title="Skills" count={ctx.skills.length} body={
              ctx.skills.length === 0 ? (
                <div className="text-xs text-text-muted">drop a folder under <code className="text-accent">{titleCase(domain)}/skills/</code> with a SKILL.md.</div>
              ) : (
                <ul className="space-y-1">
                  {ctx.skills.map((s) => (
                    <li key={s.path} className="flex items-stretch gap-1">
                      <button
                        onClick={() => onInsertSkill(s.name)}
                        className="flex-1 rounded border border-border-subtle bg-background px-2 py-1.5 text-left hover:border-accent-border hover:bg-surface-warm"
                      >
                        <div className="font-mono text-[11px] text-accent">/{s.name}</div>
                        {s.description && <div className="mt-0.5 line-clamp-2 text-[10px] text-text-muted">{s.description}</div>}
                      </button>
                      {onTogglePreferred && (
                        <button
                          onClick={() => onTogglePreferred(s.name)}
                          title={preferredSet?.has(s.name) ? "Unpin" : "Pin: auto-attach"}
                          className={`shrink-0 rounded border px-2 text-[12px] transition-colors ${
                            preferredSet?.has(s.name)
                              ? "border-accent-border bg-accent-soft text-accent"
                              : "border-border-subtle bg-background text-text-muted hover:border-accent-border hover:text-accent"
                          }`}
                        >
                          {preferredSet?.has(s.name) ? "★" : "☆"}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )
            } />
            <DrawerImportsSection
              domain={domain}
              onInject={(body, label) => onInjectContext(body, label)}
            />
          </>
        )}
      </div>
      <button
        onClick={() => { void invoke("open_in_finder", { path: domainPath }); }}
        title={`Open ${domainPath} in Finder`}
        className="flex w-full items-center gap-1.5 border-t border-border-subtle px-4 py-2 text-left font-mono text-[10px] text-text-muted transition-colors hover:bg-surface-warm hover:text-accent"
      >
        <Folder className="h-3 w-3 shrink-0" />
        <span className="truncate">{domainPath.split("/").slice(-3).join("/")}</span>
      </button>
      </aside>
    </div>
  );
}

// Drawer section that surfaces a domain's ingested imports without
// the user having to navigate to Settings → Ingestion. Click a row
// to load the first chunk into the chat as primed context, or
// "reveal" to open in Finder. Read-only — toggling for attachment
// happens via the chips above the composer.

// Domain actions menu — "Back up" and "Archive" for a single domain.
// Used in the domain header. Backs up via engine_vault_backup(domainOpt),
// archives via engine_vault_archive. Archive never deletes data; it just
// flips the manifest flag and hides the domain from the active sidebar.

// ─────────────────────────────────────────────────────────────────────
// Usage dashboard (P4.7 Phase 4) — reads the aggregated <vault>/usage
// summary written by usage_append at each turn close and renders totals
// plus breakdowns by CLI, model, and domain, with a per-day activity
// strip. Surfaced on the no-domain landing; renders nothing until there's
// at least one captured turn, so new vaults stay clean.



// The user's Ideal State (constitution) framed as highest-precedence law and
// prepended to chat/council prompts the desktop sends directly. Mirrors the
// engine framing (cli-bridge.ts buildConstitutionPreamble) and the Rust daemon
// helper (lib.rs ideal_state_preamble) so the constitution reads identically
// everywhere. Empty string when the Ideal State is blank.


// Fetches the engine-backed usage roll-up (whole-vault, or scoped to one domain
// when `domain` is set) and renders it. On the no-domain landing we pass
// hideWhenEmpty so a fresh vault stays clean; in the Usage tab we show a
// friendly empty state instead.

function ChatPanel({
  domain,
  domainPath,
  threadDomain,
  isApp,
  vaultPath,
  clis,
  fwLens,
  onSwitchToCouncil,
  activeThreadPath,
  chatViewNonce,
  onActiveThreadChange,
  onThreadsChanged,
  onStreamStart,
  onStreamEnd,
  domains,
  domainStats,
  runningDomains,
  finishedDomains,
  onPickDomain,
  domainTab,
  setDomainTab,
}: {
  domain: string | null;
  domainPath: string | null;
  // Where threads are stored/listed. Defaults to `domain`. An open app passes
  // its own `_app-<id>` scope so conversations live in the app's space,
  // independent of the (possibly many) domains it's bound to — while `domain`
  // above still drives model grounding.
  threadDomain?: string | null;
  // True when an app (not a domain) is open. Suppresses domain-only chrome:
  // the domain hero header and DomainHome's "apps refreshing this domain"
  // strip. The app is isolated; it feeds domains, it isn't one.
  isApp?: boolean;
  vaultPath: string;
  clis: CliInfo[];
  fwLens: ReturnType<typeof useFrameworkLens>;
  onSwitchToCouncil: () => void;
  activeThreadPath: string | null;
  chatViewNonce: number;
  onActiveThreadChange: (p: string | null) => void;
  onThreadsChanged: () => void;
  onStreamStart: (s: { sessionId: string; domain: string | null; threadPath: string | null; title: string; startedAt: number }) => void;
  onStreamEnd: (sessionId: string) => void;
  domains: Domain[];
  domainStats: Record<string, number>;
  runningDomains: Set<string>;
  finishedDomains: Set<string>;
  onPickDomain: (name: string) => void;
  domainTab: DomainTab;
  setDomainTab: (t: DomainTab) => void;
}) {
  const available = useMemo(() => clis.filter((c) => c.available), [clis]);
  // Thread storage scope: the app's own space when given, else the domain.
  // `domain` keeps driving grounding/engine; `tDomain` drives where the
  // conversation's .md file is written and which lastThread we remember.
  const tDomain = threadDomain !== undefined ? threadDomain : domain;

  // ── Unified engine chat (Track D5) ────────────────────────────────
  // When the `prevail` CLI is present we prefer driving the conversation
  // through `engine_chat`, which streams a typed ChatEvent NDJSON stream
  // (start/user/delta/assistant/usage/done/error) and threads through the
  // domain manifest's configured engine, privacy (localOnly) and skills.
  // When it's absent we fall back to the native chat_send path below.
  // This is purely additive — neither path is removed.
  const [engineAvailable, setEngineAvailable] = useState(false);
  useEffect(() => {
    let alive = true;
    // Probe once: if `prevail domains` answers, the CLI is installed and
    // the engine chat path is usable. Any error (CLI missing, bad vault)
    // leaves us on the native path.
    (async () => {
      try {
        await invoke("engine_domains", { vault: vaultPath });
        if (alive) setEngineAvailable(true);
      } catch {
        if (alive) setEngineAvailable(false);
      }
    })();
    return () => { alive = false; };
  }, [vaultPath]);
  // Per-domain "local only" privacy pin (mirrors manifest.privacy.localOnly).
  // Persisted by the manifest editor; read here so engine chat can force a
  // local engine for this turn.
  // Bumped by the domain Preferences panel whenever a picker changes, so the
  // composer re-reads the domain's CLI/model/framework/lens overrides live.
  const [prefsTick, setPrefsTick] = useState(0);
  // Bunker Mode forces local-only regardless of the per-domain pin.
  const localOnly = isBunkerOn() || (domain ? lsGet(`prevail.domain.${domain}.localOnly`) === "1" : false);

  // Per-domain model preference. Keys: prevail.domain.<name>.cli and
  // prevail.domain.<name>.model. When set, override the global default
  // while in that domain. Global default kicks in for no-domain chats
  // or domains without an override.
  const domainCliKey = domain ? `prevail.domain.${domain}.cli` : "";
  const domainModelKey = domain ? `prevail.domain.${domain}.model` : "";
  const [selectedCli, setSelectedCli] = useState<string | null>(() => {
    const domSaved = domain ? lsGet(`prevail.domain.${domain}.cli`) : "";
    return domSaved || lsGet(LS.defaultChatCli) || null;
  });
  // Per-CLI model selection — persisted to localStorage as
  // prevail.model.<cli>. Defaults to first model for that CLI when no
  // saved choice exists.
  const [modelByCli, setModelByCli] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const c of clis) {
      out[c.id] = lsGet(`prevail.model.${c.id}`) || (MODELS[c.id]?.[0]?.id ?? "");
    }
    return out;
  });
  // When the active domain changes, swap to that domain's preferred
  // (cli, model, framework, lens) if one is set. Falls back to the
  // global default.
  useEffect(() => {
    if (!domain) {
      const globalCli = lsGet(LS.defaultChatCli);
      if (globalCli) setSelectedCli(globalCli);
      // Restore global framework/lens when leaving a domain.
      const globalFw = lsGet(LS.framework, "none");
      const globalLn = lsGet(LS.lens, "none");
      if (globalFw && globalFw !== fwLens.framework) fwLens.setFramework(globalFw);
      if (globalLn && globalLn !== fwLens.lens) fwLens.setLens(globalLn);
      return;
    }
    // Domain override when set, else fall back to the global default — so both
    // picking an override AND clearing it ("Use global") propagate live.
    const domCli = lsGet(`prevail.domain.${domain}.cli`);
    const effectiveCli = domCli || lsGet(LS.defaultChatCli) || null;
    if (effectiveCli) setSelectedCli(effectiveCli);
    const domModel = lsGet(`prevail.domain.${domain}.model`);
    if (domModel && effectiveCli) {
      setModelByCli((cur) => ({ ...cur, [effectiveCli]: domModel }));
    }
    const domFw = lsGet(`prevail.domain.${domain}.framework`);
    const domLn = lsGet(`prevail.domain.${domain}.lens`);
    fwLens.setFramework(domFw || lsGet(LS.framework, "none"));
    fwLens.setLens(domLn || lsGet(LS.lens, "none"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain, prefsTick]);
  // Mirror framework/lens changes into the domain key when in a domain.
  // useFrameworkLens's own effect already writes the global key, so we
  // just extend with a per-domain pin here.
  useEffect(() => {
    if (!domain) return;
    lsSet(`prevail.domain.${domain}.framework`, fwLens.framework);
  }, [domain, fwLens.framework]);
  useEffect(() => {
    if (!domain) return;
    lsSet(`prevail.domain.${domain}.lens`, fwLens.lens);
  }, [domain, fwLens.lens]);
  const selectedModel = selectedCli ? (modelByCli[selectedCli] ?? "") : "";
  const setSelectedModel = (cli: string, m: string) => {
    setModelByCli((cur) => ({ ...cur, [cli]: m }));
    lsSet(`prevail.model.${cli}`, m);
    // If we're in a domain, also save it as the domain's preference
    // so this becomes the default next time the user picks this domain.
    if (domain) {
      lsSet(domainCliKey, cli);
      lsSet(domainModelKey, m);
    }
  };
  // Reset the domain's per-(cli,model) override so global default
  // applies again.
  function clearDomainModelOverride() {
    if (!domain) return;
    lsSet(domainCliKey, "");
    lsSet(domainModelKey, "");
  }
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!modelMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setModelMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [modelMenuOpen]);
  const [input, setInput] = useState("");
  // The user's Ideal State (vault/ideal-state.md) — their constitution, always
  // prepended as the highest-precedence preamble so every turn aligns with it.
  // Loaded per vault path; read_ideal_state returns the starter template when
  // the file is absent so it's never empty on a fresh vault.
  const [idealMd, setIdealMd] = useState<string>("");
  useEffect(() => {
    if (!vaultPath) return;
    invoke<string>("read_ideal_state", { vault: vaultPath })
      .then(setIdealMd)
      .catch(() => setIdealMd(""));
  }, [vaultPath]);
  // Distilled long-term memory for this domain — prepended to prompts like
  // user.md so the assistant remembers across sessions (self-learning loop).
  const [memoryMd, setMemoryMd] = useState<string>("");
  useEffect(() => {
    if (!vaultPath) { setMemoryMd(""); return; }
    invoke<string>("read_memory_md", { vault: vaultPath, domain: domain ?? null })
      .then(setMemoryMd)
      .catch(() => setMemoryMd(""));
  }, [vaultPath, domain, chatViewNonce]);
  // Domain context column — a persistent right column showing state.md,
  // decisions, journal, recent logs, skills. Collapsible; state persisted.
  // Items can be "used in chat" to inject as prompt context.
  const [contextOpen, setContextOpen] = useState<boolean>(() => lsGet("prevail.contextOpen") === "1");
  useEffect(() => { lsSet("prevail.contextOpen", contextOpen ? "1" : "0"); }, [contextOpen]);
  const [primedContext, setPrimedContext] = useState<{ label: string; body: string }[]>([]);
  function injectContext(body: string, label: string) {
    setPrimedContext((cur) => {
      if (cur.some((c) => c.label === label)) return cur;
      return [...cur, { label, body }];
    });
  }
  // Per-domain preferences popover — explicit view of overrides saved
  // for this domain with reset controls. Implicit auto-save still
  // happens in pickers; this only surfaces + clears the result.
  // Skills attached to the next send. Decoupled from the textarea so
  // editing the prompt text doesn't affect them, and the user removes
  // them from the pills below — not by editing prompt text.
  const [attachedSkills, setAttachedSkills] = useState<string[]>(() => loadPreferredSkills(domain));
  const [preferredSkills, setPreferredSkills] = useState<string[]>(() => loadPreferredSkills(domain));
  // domainTab is lifted to App (the top bar owns the Insights/Preferences
  // toggles); it arrives as a prop. "chat" shows the transcript; the other
  // tabs replace the transcript with the domain's reference content. The
  // composer stays at the bottom regardless of tab.
  const [domainCtx, setDomainCtx] = useState<DomainContextBundle | null>(null);
  // Context score for the active domain. Cached in state per-domain; the
  // header badge and Context tab both read from here. Loaded (cheap,
  // no-audit) on domain open; the Re-scan button forces an audit.
  const [ctxScore, setCtxScore] = useState<ContextScore | null>(null);
  const [ctxScoreLoading, setCtxScoreLoading] = useState(false);
  const [ctxScoreRescanning, setCtxScoreRescanning] = useState(false);
  const [ctxScoreError, setCtxScoreError] = useState<string | null>(null);
  useEffect(() => {
    setDomainTab("chat");
    const pref = loadPreferredSkills(domain);
    setPreferredSkills(pref);
    setAttachedSkills(pref);
    if (!domain || !vaultPath) { setDomainCtx(null); return; }
    let mounted = true;
    invoke<DomainContextBundle>("domain_context", { vault: vaultPath, domain })
      .then((c) => { if (mounted) setDomainCtx(c); })
      .catch(() => { if (mounted) setDomainCtx(null); });
    return () => { mounted = false; };
  }, [domain, vaultPath]);
  // Re-pull the domain bundle (e.g. after creating a skill) without a remount.
  const refreshDomainCtx = useCallback(() => {
    if (!domain || !vaultPath) return;
    invoke<DomainContextBundle>("domain_context", { vault: vaultPath, domain })
      .then(setDomainCtx)
      .catch(() => {});
  }, [domain, vaultPath]);
  // I7: "Save as skill" — the composer dispatches this with the typed prompt;
  // we jump to the Skills tab and pre-fill the new-skill form.
  const [newSkillSeed, setNewSkillSeed] = useState<string | null>(null);
  useEffect(() => {
    const onNewSkill = (e: Event) => {
      const body = (e as CustomEvent<string>).detail ?? "";
      setNewSkillSeed(body);
      setDomainTab("skills");
    };
    window.addEventListener("prevail:new-skill", onNewSkill as EventListener);
    return () => window.removeEventListener("prevail:new-skill", onNewSkill as EventListener);
  }, []);
  // Load the (cached / heuristic) context score when a domain opens.
  useEffect(() => {
    setCtxScore(null);
    setCtxScoreError(null);
    if (!domain || !vaultPath) return;
    let mounted = true;
    setCtxScoreLoading(true);
    invoke<ContextScore>("engine_score", { vault: vaultPath, domain, audit: false })
      .then((s) => { if (mounted) setCtxScore(s); })
      .catch((e) => { if (mounted) setCtxScoreError(String(e)); })
      .finally(() => { if (mounted) setCtxScoreLoading(false); });
    return () => { mounted = false; };
  }, [domain, vaultPath]);
  const rescanContextScore = useCallback(() => {
    if (!domain || !vaultPath) return;
    setCtxScoreRescanning(true);
    setCtxScoreError(null);
    invoke<ContextScore>("engine_score", { vault: vaultPath, domain, audit: true })
      .then((s) => setCtxScore(s))
      .catch((e) => setCtxScoreError(String(e)))
      .finally(() => setCtxScoreRescanning(false));
  }, [domain, vaultPath]);
  // Aggregate "Life Readiness" — averaged across all domains. Loaded on
  // the no-domain landing. Re-fetched when a re-scan finishes so the
  // headline number stays roughly current.
  const [lifeReadiness, setLifeReadiness] = useState<LifeReadiness | null>(null);
  useEffect(() => {
    if (domain || !vaultPath) return;
    let mounted = true;
    invoke<LifeReadiness>("engine_score_all", { vault: vaultPath })
      .then((lr) => { if (mounted) setLifeReadiness(lr); })
      .catch(() => { if (mounted) setLifeReadiness(null); });
    return () => { mounted = false; };
  }, [domain, vaultPath, ctxScoreRescanning]);
  const togglePreferredSkill = useCallback((name: string) => {
    setPreferredSkills((cur) => {
      const next = cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name];
      savePreferredSkills(domain, next);
      return next;
    });
    // Mirror into currently attached set so the change is visible
    // immediately in the composer pills.
    setAttachedSkills((cur) => (cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name]));
  }, [domain]);
  const preferredSkillsSet = useMemo(() => new Set(preferredSkills), [preferredSkills]);
  function insertSkillSlash(name: string) {
    setAttachedSkills((cur) => (cur.includes(name) ? cur : [...cur, name]));
  }
  function removeAttachedSkill(name: string) {
    setAttachedSkills((cur) => cur.filter((n) => n !== name));
  }
  // Auto-prime the domain's state.md so the AI has context without
  // the user having to click "use in chat" in the drawer. Labels start
  // with "auto:" so they get cleared when the domain switches.
  useEffect(() => {
    if (!domain || !vaultPath) {
      setPrimedContext((cur) => cur.filter((x) => !x.label.startsWith("auto:")));
      return;
    }
    // Per-domain opt-out — when prevail.domain.<name>.autoState === "0"
    // we skip auto-attaching state.md. Default is on.
    if (lsGet(`prevail.domain.${domain}.autoState`) === "0") {
      setPrimedContext((cur) => cur.filter((x) => !x.label.startsWith("auto:")));
      return;
    }
    let mounted = true;
    invoke<DomainContextBundle>("domain_context", { vault: vaultPath, domain })
      .then((c) => {
        if (!mounted) return;
        const label = `auto: ${titleCase(domain)}/state.md`;
        setPrimedContext((cur) => {
          const cleared = cur.filter((x) => !x.label.startsWith("auto:"));
          if (!c.state) return cleared;
          return [...cleared, { label, body: c.state }];
        });
      })
      .catch(() => {/* ignore */});
    return () => { mounted = false; };
    // prefsTick bumps when popover toggles the autoState pref, so the
    // effect re-runs without needing the user to re-enter the domain.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain, vaultPath, prefsTick]);
  const [attachments, setAttachments] = useState<string[]>([]);
  // Ingested artifacts for this domain. Auto-fetched on entry so the
  // user can flip a chip to attach them to the next turn without
  // hunting through Finder.
  type DomainImport = {
    path: string;
    name: string;
    size: number;
    mtime: number;
    meta: { source?: string; tier_id?: string; sha256?: string } | null;
  };
  const [domainImports, setDomainImports] = useState<DomainImport[]>([]);
  useEffect(() => {
    if (!domain) { setDomainImports([]); return; }
    let mounted = true;
    invoke<DomainImport[]>("ingestion_list_artifacts", { domain })
      .then((rows) => { if (mounted) setDomainImports(rows); })
      .catch(() => { if (mounted) setDomainImports([]); });
    return () => { mounted = false; };
  }, [domain]);
  // Local recall history — arrow-up cycles backward, arrow-down forward.
  const HISTORY_KEY = `prevail.chat.history.${domain ?? "_root"}`;
  const [history, setHistory] = useState<string[]>(() => {
    try {
      const raw = lsGet(HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const [histIdx, setHistIdx] = useState<number>(-1);
  useEffect(() => {
    try { lsSet(HISTORY_KEY, JSON.stringify(history.slice(-50))); } catch { /* ignore */ }
  }, [history, HISTORY_KEY]);
  async function pickAttachment() {
    try {
      const picked = await open({ multiple: true, directory: false });
      if (!picked) return;
      const paths = Array.isArray(picked) ? picked : [picked];
      setAttachments((cur) => [...cur, ...paths.filter((p): p is string => typeof p === "string")]);
      setPlusOpen(false);
    } catch (e) {
      console.error("pickAttachment", e);
    }
  }
  const [plusOpen, setPlusOpen] = useState(false);
  const plusMenuRef = useRef<HTMLDivElement>(null);
  const [skillsCache, setSkillsCache] = useState<SkillEntry[]>([]);
  useEffect(() => {
    if (!plusOpen) return;
    const onClick = (e: MouseEvent) => {
      if (plusMenuRef.current && !plusMenuRef.current.contains(e.target as Node)) {
        setPlusOpen(false);
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [plusOpen]);
  // Pre-fetch skills whenever the domain changes so both the `+`
  // menu and the slash-autocomplete have a populated cache.
  useEffect(() => {
    if (!domain || !vaultPath) {
      setSkillsCache([]);
      return;
    }
    invoke<SkillEntry[]>("scan_skills", { vault: vaultPath })
      .then((s) => setSkillsCache(s.filter((sk) => sk.domain === domain)))
      .catch(() => setSkillsCache([]));
  }, [domain, vaultPath]);
  // Slash autocomplete — detect `/<word>` at the caret position and
  // expose the filtered skills + a completer for the textarea below.
  const taRef = useRef<HTMLTextAreaElement>(null);
  const slashMatch = useMemo(() => {
    const ta = taRef.current;
    if (!ta) return null;
    const caret = ta.selectionStart ?? input.length;
    const before = input.slice(0, caret);
    // Match the trailing /<word> right at the caret.
    const m = before.match(/(^|\s)\/([a-zA-Z0-9_-]*)$/);
    if (!m) return null;
    const start = caret - m[2].length - 1; // index of the `/`
    return { token: m[2], start, end: caret };
  }, [input]);
  const slashCandidates = useMemo(() => {
    if (!slashMatch) return [];
    const q = slashMatch.token.toLowerCase();
    return skillsCache
      .filter((s) => s.name.toLowerCase().includes(q))
      .slice(0, 6);
  }, [slashMatch, skillsCache]);
  const [slashIdx, setSlashIdx] = useState(0);
  useEffect(() => { setSlashIdx(0); }, [slashMatch?.token]);
  function applySlashCompletion(name: string) {
    if (!slashMatch) return;
    // Remove the /partial from the textarea and add the skill to the
    // attached-skills pill row instead. Keeps the prompt clean.
    const head = input.slice(0, slashMatch.start).replace(/\s$/, "");
    const tail = input.slice(slashMatch.end);
    const next = `${head}${head && tail && !tail.startsWith(" ") ? " " : ""}${tail}`;
    setInput(next);
    insertSkillSlash(name);
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(head.length, head.length);
    });
  }
  function attachDomainState() {
    if (!domain || !domainPath) return;
    setAttachments((cur) => [...cur, `${domainPath}/state.md`]);
    setPlusOpen(false);
  }
  function insertSkillRef(skill: SkillEntry) {
    setInput((cur) => `${cur}${cur && !cur.endsWith(" ") ? " " : ""}/${skill.name} `);
    setPlusOpen(false);
  }
  function pushHistory(prompt: string) {
    setHistory((h) => (h[h.length - 1] === prompt ? h : [...h, prompt]));
    setHistIdx(-1);
  }
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Use a ref for the active thread path so async saves don't capture
  // a stale closure value. Without this, every streaming chunk after
  // the first save still saw activeThreadPath=null and created a new
  // file — hence the duplicates the user reported.
  const activeThreadRef = useRef<string | null>(activeThreadPath);
  useEffect(() => { activeThreadRef.current = activeThreadPath; }, [activeThreadPath]);
  useEffect(() => {
    if (tDomain && activeThreadPath && activeThreadPath.includes(`/${tDomain}/`)) {
      lsSet(`prevail.domain.${tDomain}.lastThread`, activeThreadPath);
    }
  }, [tDomain, activeThreadPath]);
  // When the auto-save effect adopts a new path mid-stream we stamp
  // the path here. The load-on-change effect below uses this to skip
  // reloading from disk — the in-memory messages are already ahead of
  // what was saved (more chunks have arrived). Reloading would
  // overwrite them and the assistant placeholder loses streaming:true,
  // which is the original cause of the "(empty reply)" symptom.
  const selfSetPathRef = useRef<string | null>(null);
  // Any thread pick returns to the chat view — even re-clicking the active
  // thread (which doesn't change activeThreadPath), so you can always escape
  // the Preferences view by clicking a thread. Skips the initial mount.
  const chatViewMounted = useRef(false);
  useEffect(() => {
    if (chatViewMounted.current) setDomainTab("chat");
    else chatViewMounted.current = true;
  }, [chatViewNonce]);
  // Load the thread when activeThreadPath changes.
  useEffect(() => {
    // Picking a thread (or starting a new one) always returns to the chat view,
    // even if Preferences was open — otherwise the click appears to do nothing.
    setDomainTab("chat");
    if (!activeThreadPath) { setMessages([]); return; }
    if (selfSetPathRef.current === activeThreadPath) {
      selfSetPathRef.current = null;
      return;
    }
    let cancelled = false;
    invoke<{ meta: ThreadMeta; turns: ThreadTurn[] }>("load_thread", { path: activeThreadPath })
      .then((t) => {
        if (cancelled) return;
        setMessages(t.turns.map((tn) => ({
          role: tn.role,
          cli: tn.cli ?? undefined,
          content: tn.content,
          ts: Date.now(),
        })));
      })
      .catch((e) => console.error("load_thread", e));
    return () => { cancelled = true; };
  }, [activeThreadPath]);
  // Auto-save the thread on every message change (debounced). Reads
  // the ref so each save reuses the existing slug once one exists.
  const saveTimer = useRef<number | null>(null);
  const savePendingRef = useRef<boolean>(false);
  // Extra guard: once a save with slug=null has been DISPATCHED, block
  // any further slug=null dispatches until activeThreadRef is set.
  // savePendingRef alone wasn't enough in practice — duplicates kept
  // appearing, suggesting a race where a second timer fires between
  // the first save dispatching and activeThreadRef being adopted.
  const initialSaveDispatchedRef = useRef<boolean>(false);
  useEffect(() => {
    if (messages.length === 0) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      if (savePendingRef.current) return; // serialize saves
      const wantSlugNull = !activeThreadRef.current;
      // At most ONE save with slug=null is allowed per ChatPanel
      // instance. We claim the right BEFORE any await so any other
      // timer that fires next sees the claim and bails. Released
      // only on the catch branch below so a transient failure can
      // be retried, but a successful slug=null save never happens
      // twice.
      if (wantSlugNull && initialSaveDispatchedRef.current) {
        console.log("[prevail/save_thread] BLOCK slug=null: already claimed");
        return;
      }
      if (wantSlugNull) initialSaveDispatchedRef.current = true;
      savePendingRef.current = true;
      try {
        const first = messages.find((m) => m.role === "user");
        const title = first ? first.content.slice(0, 60).replace(/\n/g, " ") : "untitled";
        const current = activeThreadRef.current;
        const slug = current ? current.split("/").pop()?.replace(/\.md$/, "") ?? null : null;
        console.log("[prevail/save_thread]", { slug, current, msgCount: messages.length, domain: tDomain, t: Date.now() });
        const path = await invoke<string>("save_thread", {
          vault: vaultPath,
          domain: tDomain ?? null,
          slug,
          title,
          turns: messages.map((m) => ({
            role: m.role,
            cli: m.cli ?? null,
            model: m.model ?? null,
            content: m.content,
          })),
        });
        // Adopt the returned path so the NEXT save reuses the same slug.
        if (!activeThreadRef.current) {
          activeThreadRef.current = path;
          selfSetPathRef.current = path;
          onActiveThreadChange(path);
        }
        onThreadsChanged();
      } catch (e) {
        console.error("save_thread", e);
        // If we never got a path back, release the claim so a retry
        // can succeed. Otherwise the user would be stuck with no
        // saved thread until they restart.
        if (!activeThreadRef.current) initialSaveDispatchedRef.current = false;
      } finally {
        savePendingRef.current = false;
      }
    }, 600);
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);
  // The slug=null save guard above is one-shot PER ChatPanel INSTANCE, but the
  // panel persists across domain switches — so without this, only the first-ever
  // chat saved and later new-domain chats silently never created a thread. When
  // the active thread clears (new domain, "New chat", domain switch), release the
  // guard so the next fresh conversation can create its own thread.
  useEffect(() => {
    if (!activeThreadPath) {
      initialSaveDispatchedRef.current = false;
      savePendingRef.current = false;
    }
  }, [activeThreadPath]);
  const sessionRef = useRef(`s-${Date.now()}`);
  const unlistenRefs = useRef<UnlistenFn[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // P4.7 Phase 3 — capture real chat usage. We snapshot the turn's meta
  // (vault/domain/thread/cli/model) at send time so the mount-once 'done'
  // listeners (which have stale closures) can persist an accurate record
  // when the turn closes. One turn streams at a time, so a single pending
  // slot is sufficient; it's cleared after the matching 'done' to avoid
  // double-counting the same turn.
  const pendingUsageRef = useRef<{
    session: string;
    vault: string;
    domain: string | null;
    thread: string | null;
    cli: string | null;
    model: string | null;
    intent: string;
  } | null>(null);
  // Self-learning: accumulate the RAW, unprocessed assistant stream for the
  // current turn (before ANSI/sycophancy stripping) so the intent ledger
  // records the model's true output, not just the displayed text.
  const rawReplyRef = useRef<string>("");
  const persistUsage = useCallback(
    (session: string, ok: boolean, usage?: ChatMessage["usage"]) => {
      const p = pendingUsageRef.current;
      if (!p || p.session !== session) return;
      pendingUsageRef.current = null; // persist a turn exactly once
      const now = new Date();
      const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      invoke("usage_append", {
        vault: p.vault,
        record: {
          ts: now.getTime(),
          day,
          domain: p.domain,
          thread: p.thread,
          cli: p.cli || "unknown",
          model: p.model,
          input_tokens: usage?.input_tokens ?? null,
          output_tokens: usage?.output_tokens ?? null,
          cost_usd: usage?.cost_usd ?? null,
          ok,
        },
      }).catch((e) => console.error("usage_append failed", e));

      // Self-learning: append the RAW reply to the intent ledger, paired
      // with the intent by session, so the turn is fully reconstructable.
      const raw = maybeRedact(rawReplyRef.current);
      rawReplyRef.current = "";
      invoke("intent_append", {
        vault: p.vault,
        domain: p.domain,
        record: {
          kind: "reply",
          ts: now.getTime(),
          day,
          session: p.session,
          domain: p.domain,
          thread: p.thread,
          cli: p.cli,
          model: p.model,
          ok,
          raw,
          usage: usage ?? null,
        },
      }).catch((e) => console.error("intent_append (reply) failed", e));

      // Auto-journal: one distilled line per completed turn, so the journal
      // builds itself from every conversation (model + intent snippet).
      const hh = String(now.getHours()).padStart(2, "0");
      const mm = String(now.getMinutes()).padStart(2, "0");
      const snippet = p.intent.replace(/\s+/g, " ").slice(0, 100);
      const modelTag = p.model || p.cli || "?";
      const status = ok ? "" : " · ✗ failed";
      invoke("journal_append", {
        vault: p.vault,
        domain: p.domain,
        entry: `- ${day} ${hh}:${mm} · [${modelTag}] ${snippet}${status}`,
      }).catch((e) => console.error("journal_append failed", e));
    },
    [],
  );

  useEffect(() => {
    if (!selectedCli && available.length > 0) setSelectedCli(available[0].id);
  }, [available, selectedCli]);

  // Bunker Mode auto-switch: if the persisted/selected CLI is a cloud one (a
  // stale default from before Bunker was enabled), switch the picker to an
  // available local provider so what's highlighted matches what will actually
  // run. Re-evaluates whenever the bunker flag, selection, or CLI list changes.
  const bunkerOn = isBunkerOn();
  useEffect(() => {
    if (!bunkerOn || !selectedCli || isLocalCli(selectedCli)) return;
    const local = preferredLocalCli(clis);
    if (local) setSelectedCli(local);
  }, [bunkerOn, selectedCli, clis]);

  useEffect(() => {
    if (selectedCli) lsSet(LS.defaultChatCli, selectedCli);
  }, [selectedCli]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const u1 = await listen<{ session: string; cli: string; stream: string; data: string }>(
        "chat:chunk",
        (e) => {
          if (e.payload.session !== sessionRef.current) return;
          if (!mounted) return;
          // Capture stderr so a failing CLI's real error (model
          // rejected, quota, auth) can be surfaced in the "No output"
          // panel instead of a generic message.
          if (e.payload.stream === "stderr") {
            const errChunk = stripAnsi(e.payload.data);
            setMessages((m) => {
              const last = m[m.length - 1];
              if (last && last.streaming) {
                return [...m.slice(0, -1), { ...last, stderr: (last.stderr ?? "") + errChunk }];
              }
              return m;
            });
            return;
          }
          // Self-learning: keep the RAW chunk verbatim (pre-strip) for the
          // intent ledger before we clean it for display.
          rawReplyRef.current += e.payload.data;
          // Process only the new chunk (not the growing accumulator)
          // to keep stream rendering O(n) instead of O(n²) for long
          // replies. Sycophancy patterns are short so re-scanning the
          // chunk is still cheap.
          const clean = maybeStripSycophancy(stripAnsi(e.payload.data));
          setMessages((m) => {
            const last = m[m.length - 1];
            if (last && last.streaming) {
              return [...m.slice(0, -1), { ...last, content: last.content + clean }];
            }
            return m;
          });
        },
      );
      const u2 = await listen<{ session: string; cli: string; code: number }>(
        "chat:done",
        (e) => {
          if (!mounted) return;
          // Always notify the App-level tracker so background streams
          // started in this panel get reconciled even after the user
          // navigates away. The App layer ignores unknown sessions.
          onStreamEnd(e.payload.session);
          // Capture usage for native-path turns (no token accounting, but
          // the turn still counts). code===0 (or null timeout) → ok.
          persistUsage(e.payload.session, e.payload.code === 0);
          if (e.payload.session !== sessionRef.current) return;
          setMessages((m) => {
            const last = m[m.length - 1];
            if (last && last.streaming) return [...m.slice(0, -1), { ...last, streaming: false }];
            // No live bubble: the view lost this stream (navigated away and
            // back mid-run). Catch up from the thread file on disk.
            const p = activeThreadRef.current;
            if (p) {
              void invoke<{ meta: ThreadMeta; turns: ThreadTurn[] }>("load_thread", { path: p })
                .then((t) => setMessages(t.turns.map((tn) => ({ role: tn.role, cli: tn.cli ?? undefined, content: tn.content, ts: Date.now() }))))
                .catch(() => {});
            }
            return m;
          });
        },
      );
      // ── Unified engine chat stream (Track D5) ────────────────────
      // `engine_chat` emits a ChatEvent NDJSON stream wrapped as
      // { session, data: <ChatEvent> } on `engine-chat:line`, closing
      // with `engine-chat:done`. We render into the SAME `messages`
      // state and reuse the existing chat bubble rendering, so this is
      // purely an alternate producer for the assistant reply.
      const u3 = await listen<{ session: string; stream?: string; data: ChatEvent | string }>(
        "engine-chat:line",
        (e) => {
          if (e.payload.session !== sessionRef.current) return;
          if (!mounted) return;
          // stderr lines arrive as raw strings — capture them on the
          // streaming assistant bubble so failures surface like the
          // native path's "No output" panel.
          if (e.payload.stream === "stderr" || typeof e.payload.data === "string") {
            const errChunk = stripAnsi(String(e.payload.data));
            setMessages((m) => {
              const last = m[m.length - 1];
              if (last && last.streaming) {
                return [...m.slice(0, -1), { ...last, stderr: (last.stderr ?? "") + errChunk + "\n" }];
              }
              return m;
            });
            return;
          }
          const ev = e.payload.data as ChatEvent;
          switch (ev.type) {
            case "start":
            case "user":
              // 'start' opens the turn; 'user' echoes the prompt we
              // already optimistically rendered. Nothing to append.
              break;
            case "delta": {
              // Incremental text chunk — append to the streaming bubble.
              rawReplyRef.current += ev.text ?? ""; // raw, for the intent ledger
              const clean = maybeStripSycophancy(stripAnsi(ev.text ?? ""));
              setMessages((m) => {
                const last = m[m.length - 1];
                if (last && last.streaming) {
                  return [...m.slice(0, -1), { ...last, content: last.content + clean }];
                }
                return m;
              });
              break;
            }
            case "assistant": {
              // Finalized reply. If we streamed deltas the content is
              // already there; otherwise (engine emitted only a final
              // assistant event) set it now. Either way keep streaming
              // true until 'done' so the spinner persists.
              const full = maybeStripSycophancy(stripAnsi(ev.text ?? ""));
              setMessages((m) => {
                const last = m[m.length - 1];
                if (last && last.streaming) {
                  // Prefer the longer of accumulated deltas vs final text
                  // so we don't truncate a stream that already arrived.
                  const content = last.content.length >= full.length ? last.content : full;
                  return [...m.slice(0, -1), { ...last, content }];
                }
                return m;
              });
              break;
            }
            case "usage": {
              // Token / cost accounting — stash on the streaming bubble.
              setMessages((m) => {
                const last = m[m.length - 1];
                if (last && last.streaming) {
                  return [...m.slice(0, -1), { ...last, usage: ev.usage }];
                }
                return m;
              });
              break;
            }
            case "error": {
              setMessages((m) => {
                const last = m[m.length - 1];
                if (last && last.streaming) {
                  return [...m.slice(0, -1), { ...last, stderr: (last.stderr ?? "") + (ev.error ?? "engine error") + "\n" }];
                }
                return m;
              });
              break;
            }
            case "done":
              // 'done' on the stream closes the turn; the dedicated
              // engine-chat:done event below flips streaming off.
              break;
            default:
              // Unknown event type — tolerate per the schema's forward-
              // compat requirement. No-op.
              break;
          }
        },
      );
      const u4 = await listen<{ session: string; code: number }>(
        "engine-chat:done",
        (e) => {
          if (!mounted) return;
          onStreamEnd(e.payload.session);
          // Capture usage for engine-path turns — pull the token/cost
          // accounting off the streaming bubble before we flip it closed.
          setMessages((m) => {
            const last = m[m.length - 1];
            if (last && last.streaming) {
              persistUsage(e.payload.session, e.payload.code === 0, last.usage);
              return [...m.slice(0, -1), { ...last, streaming: false }];
            }
            persistUsage(e.payload.session, e.payload.code === 0);
            // No live bubble: the view lost this stream (navigated away and
            // back mid-run). The engine persisted the thread; reload it.
            const p = activeThreadRef.current;
            if (p) {
              void invoke<{ meta: ThreadMeta; turns: ThreadTurn[] }>("load_thread", { path: p })
                .then((t) => setMessages(t.turns.map((tn) => ({ role: tn.role, cli: tn.cli ?? undefined, content: tn.content, ts: Date.now() }))))
                .catch(() => {});
            }
            return m;
          });
        },
      );
      unlistenRefs.current = [u1, u2, u3, u4];
    })();
    return () => {
      mounted = false;
      unlistenRefs.current.forEach((u) => u());
      unlistenRefs.current = [];
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  // Bubble action handlers — shared across both renderers (in-domain
  // and no-domain). Copy uses the Clipboard API; Retry rewinds the
  // transcript to before the last user turn and resends; Edit pops
  // the user message back into the composer for revision.
  const copyToClipboard = useCallback(async (text: string) => {
    try { await navigator.clipboard.writeText(text); } catch (e) { console.error(e); }
  }, []);
  const retryFromHere = useCallback((index: number) => {
    // Find the user message that produced this assistant slot.
    let userIdx = index;
    while (userIdx >= 0 && messages[userIdx]?.role !== "user") userIdx--;
    if (userIdx < 0) return;
    const userMsg = messages[userIdx];
    // Drop everything from the user turn onward, then resend it.
    setMessages((m) => m.slice(0, userIdx));
    setInput(userMsg.content);
    // Defer send so React commits the slice + input update first.
    window.setTimeout(() => { void send(); }, 0);
  }, [messages]);
  const editFromHere = useCallback((text: string, index: number) => {
    // Rewind to just before this user message, repopulate the composer.
    setMessages((m) => m.slice(0, index));
    setInput(text);
    // Focus the textarea so the user can edit immediately.
    setTimeout(() => taRef.current?.focus(), 0);
  }, []);

  async function send() {
    if (!input.trim() || !selectedCli) return;
    // Auto-council: this domain convenes the full council on every send
    // instead of a single model. Route the question to the Council tab and
    // convene immediately. (Bunker Mode stays in chat: panelists are cloud
    // models, and chat auto-switches to a local provider instead.)
    if (domain && !isBunkerOn() && getDomainToggle(domain, "auto", false)) {
      const q = input.trim();
      // Smart mode (default): only convene the council when the prompt looks
      // like a judgment call; simple questions fall through to a single model.
      // "always" mode convenes on every send.
      const mode = getPref(`prevail.domain.${domain}.autoMode`, "smart");
      if (mode === "always" || looksLikeJudgmentCall(q)) {
        setInput("");
        window.dispatchEvent(new CustomEvent("prevail:auto-council", { detail: { prompt: q } }));
        return;
      }
      // else: not a judgment call → continue to the single-model chat below.
    }
    setDomainTab("chat"); // sending always shows the chat, even from Preferences
    // Bunker Mode: auto-switch a (stale) cloud selection to an available local
    // provider instead of letting the backend hard-block. If nothing local is
    // installed/running, surface the canonical guidance and bail. The backend
    // resolves this too (the real guarantee); doing it here keeps the bubble,
    // model pick, and usage capture honest about which provider actually ran.
    let chatCli = selectedCli;
    if (isBunkerOn() && !isLocalCli(chatCli)) {
      const local = preferredLocalCli(clis);
      if (!local) {
        setMessages((m) => [...m, { role: "user", content: input.trim(), ts: Date.now() }, { role: "assistant", content: "Bunker Mode is on, so replies stay on this device, but no local model provider (Ollama) was detected. Install or start Ollama, or leave Bunker Mode in Settings → Privacy.", ts: Date.now() }]);
        setInput("");
        return;
      }
      chatCli = local;
    }
    const chatModel = lsGet(`prevail.model.${chatCli}`) || null;
    const visible = input.trim();
    const userMsg: ChatMessage = { role: "user", content: visible, ts: Date.now() };
    const replyMsg: ChatMessage = { role: "assistant", cli: chatCli, model: chatModel || undefined, framework: fwLens.framework ?? undefined, lens: fwLens.lens ?? undefined, content: "", ts: Date.now(), streaming: true };
    setMessages((m) => [...m, userMsg, replyMsg]);
    // Attach file paths to the prompt so the CLI can read them.
    const attachPreamble = attachments.length > 0
      ? `Attached files (read these as context):\n${attachments.map((p) => `- ${p}`).join("\n")}\n\n`
      : "";
    // Items the user explicitly clicked "use in chat" on (state.md,
    // decisions.md, a session log, etc.) — included verbatim.
    const primedPreamble = primedContext.length > 0
      ? primedContext.map((c) => `--- ${c.label} ---\n${c.body.trim()}\n`).join("\n") + "\n"
      : "";
    const userPreamble = buildIdealStatePreamble(idealMd);
    // Self-learning: prepend the distilled long-term memory for this domain.
    const memoryPreamble = (getPref(PREF.persistentMemory, "1") === "1" && memoryMd.trim())
      ? `--- Long-term memory (${domain ?? "General"}) ---\n${memoryMd.trim().slice(0, Number(getPref(PREF.memoryBudgetChars, "4000")))}\n\n`
      : "";
    const skillsPreamble = attachedSkills.length > 0
      ? `Use the following skills as part of your reply: ${attachedSkills.map((n) => `/${n}`).join(", ")}\n\n`
      : "";
    // Build multi-turn context from prior messages. We pass it as a
    // single text payload because the CLIs spawn fresh each turn and
    // have no shared session. Cap at ~40K characters (~10K tokens) and
    // drop the oldest turns to fit, keeping at least the most recent.
    const history = buildChatContext(messages, 40000);
    const promptText = fwLens.buildPrompt(
      history
        ? `${userPreamble}${memoryPreamble}${attachPreamble}${primedPreamble}${skillsPreamble}You are mid-conversation. Below is the prior turn history; use it as context but do NOT repeat it back to the user.\n\n--- PRIOR TURNS ---\n${history}\n--- END PRIOR TURNS ---\n\nUser's next message: ${visible}`
        : `${userPreamble}${memoryPreamble}${attachPreamble}${primedPreamble}${skillsPreamble}${visible}`
    );
    pushHistory(visible);
    setAttachments([]);
    setAttachedSkills([]);
    setInput("");
    sessionRef.current = `s-${Date.now()}`;
    rawReplyRef.current = ""; // fresh raw-output buffer for this turn
    const turnModel = chatModel;
    // Snapshot this turn's meta for usage capture (P4.7 Phase 3). Read at
    // 'done' regardless of which path (engine vs native) serves the reply.
    pendingUsageRef.current = {
      session: sessionRef.current,
      vault: vaultPath,
      domain: domain ?? null,
      thread: activeThreadRef.current,
      cli: chatCli ?? null,
      model: turnModel,
      intent: visible,
    };
    // ── Self-learning: record the INTENT immediately, the instant the user
    // sends — BEFORE the async model call — so a chat is never lost even on
    // a crash/quit mid-reply. Captures the exact prompt sent + every
    // preference in effect, so a future better model can replay it. The
    // matching raw reply is appended on completion (persistUsage).
    const prefs = {
      framework: fwLens.framework ?? null,
      lens: fwLens.lens ?? null,
      localOnly: localOnly,
      web: isBunkerOn() ? false : getDomainToggle(domain, "web", false),
      serendipity: getDomainToggle(domain, "serendipity", false),
      auto: getDomainToggle(domain, "auto", false),
      council: getDomainToggle(domain, "council", false),
      skills: attachedSkills,
      attachments,
      primedContext: primedContext.map((c) => c.label),
    };
    invoke("intent_append", {
      vault: vaultPath,
      domain: domain ?? null,
      record: {
        kind: "intent",
        ts: Date.now(),
        session: sessionRef.current,
        domain: domain ?? null,
        thread: activeThreadRef.current,
        cli: chatCli ?? null,
        model: turnModel,
        message: maybeRedact(visible), // what the user typed
        prompt: maybeRedact(promptText), // the exact, fully-assembled prompt sent to the model
        prefs,
      },
    }).catch((e) => console.error("intent_append (intent) failed", e));
    // Announce the stream so the sidebar can pulse the originating
    // domain even if the user navigates away while it runs.
    onStreamStart({
      sessionId: sessionRef.current,
      domain: domain ?? null,
      threadPath: activeThreadRef.current,
      title: visible.slice(0, 60).replace(/\n/g, " "),
      startedAt: Date.now(),
    });
    // Engine chat: the installed `prevail` CLI is now v2-aware (detects domains
    // by soul.md / reads _state.md — VAULT-SPEC-v2 stages 3–4), so the engine
    // path grounds replies in the domain's real state again. Falls back to the
    // native chat_send path when the CLI isn't present.
    const ENGINE_CHAT_ENABLED = true;
    const useEngine = ENGINE_CHAT_ENABLED && engineAvailable && !!domain;
    // Engine-only providers (no spawnable binary): OpenRouter is an HTTP gateway;
    // LM Studio / MLX are local HTTP servers the engine reaches via the ollama
    // provider path. In the no-domain General space the engine path isn't used,
    // so guide the user to a domain rather than failing on a missing binary.
    const ENGINE_ONLY = new Set(["openrouter", "lmstudio", "mlx"]);
    if (chatCli && ENGINE_ONLY.has(chatCli) && !useEngine) {
      const label = chatCli === "openrouter" ? "OpenRouter" : chatCli === "lmstudio" ? "LM Studio" : "oMLX";
      setMessages((m) => [...m.slice(0, -1), { role: "assistant", content: `${label} runs through the engine, which needs a domain. Pick a domain (left sidebar) to chat with ${label}: or use an installed CLI here in General.`, ts: Date.now() }]);
      onStreamEnd(sessionRef.current);
      return;
    }
    try {
      if (useEngine) {
        await invoke("engine_chat", {
          session: sessionRef.current,
          vault: vaultPath,
          domain,
          message: promptText,
          cli: chatCli || null,
          model: chatModel,
          localOnly,
        });
      } else {
        await invoke("chat_send", {
          args: {
            cli: chatCli,
            model: chatModel,
            prompt: promptText,
            session_id: sessionRef.current,
            timeout_sec: (() => { const n = parseInt(getPref(PREF.llmPromptTimeoutSec, "300"), 10); return Number.isFinite(n) && n > 0 ? n : null; })(),
          },
        });
      }
    } catch (e) {
      // If the engine path failed to even spawn, fall back to the native
      // path once so a transient engine issue doesn't drop the turn — but only
      // for providers with a real spawnable binary (engine-only providers like
      // LM Studio / MLX / OpenRouter have none, so the native path can't serve
      // them and would just echo "unknown cli").
      if (useEngine && chatCli && !ENGINE_ONLY.has(chatCli)) {
        try {
          await invoke("chat_send", {
            args: {
              cli: chatCli,
              model: chatModel,
              prompt: promptText,
              session_id: sessionRef.current,
              timeout_sec: (() => { const n = parseInt(getPref(PREF.llmPromptTimeoutSec, "300"), 10); return Number.isFinite(n) && n > 0 ? n : null; })(),
            },
          });
          return;
        } catch { /* fall through to error rendering */ }
      }
      setMessages((m) => [...m.slice(0, -1), { role: "assistant", content: `(error spawning ${chatCli}: ${e})`, ts: Date.now() }]);
      onStreamEnd(sessionRef.current);
    }
  }

  // Quick-action seed prompts — currently surfaced via DomainHome,
  // not the no-domain landing (which shows the domains dashboard
  // instead). Keep the array allocation alive so DomainHome's
  // onPickPrompt continues to receive prompts.
  void buildQuickActions;

  const selectedCliLabel = selectedCli
    ? (clis.find((c) => c.id === selectedCli)?.label ?? selectedCli)
    : "no model";
  const selectedModelLabel = selectedModel
    ? (MODELS[selectedCli ?? ""]?.find((m) => m.id === selectedModel)?.label ?? selectedModel)
    : "";

  const [dragOver, setDragOver] = useState(false);
  // Resolve a drop payload to a domain name. Custom MIME first, then
  // text/plain "prevail-domain:<name>" sentinel, then any types we know.
  const resolveDroppedDomain = useCallback((dt: DataTransfer): string | null => {
    const direct = dt.getData("application/x-prevail-domain");
    if (direct) return direct;
    const txt = dt.getData("text/plain");
    if (txt && txt.startsWith("prevail-domain:")) return txt.slice("prevail-domain:".length);
    return null;
  }, []);
  // A8: drag a domain in as context. Default is the LIGHT state summary
  // (state.md only) to keep the window small; hold Shift to pull the FULL,
  // heavy context (state + decisions + journal); hold Option to attach the
  // ENTIRE folder as a readable map (path + file list) so the model can scan
  // any file in it. Same behavior in chat & council.
  const attachDomainAsContext = useCallback(async (name: string, mode: "light" | "full" | "folder" = "light") => {
    if (!name || !vaultPath) return;
    try {
      if (mode === "folder") {
        const t = await invoke<{ root: string; files: string[] }>("domain_tree", { vault: vaultPath, domain: name });
        const body = [
          `Domain folder: ${t.root}`,
          "Read any file in this folder directly (paths below, relative to the folder) when it is relevant to the question. Scan broadly; state alone may not have everything.",
          "",
          "Files:",
          ...t.files.map((f) => `- ${f}`),
        ].join("\n");
        injectContext(body, `extra (entire folder): ${titleCase(name)}`);
        return;
      }
      const c = await invoke<DomainContextBundle>("domain_context", { vault: vaultPath, domain: name });
      if (mode === "full") {
        const parts = [
          c.state && `## state.md\n${c.state}`,
          c.decisions && `## decisions\n${c.decisions}`,
          c.journal && `## journal\n${c.journal}`,
        ].filter(Boolean);
        const body = parts.length ? parts.join("\n\n") : `(no context files in ${name})`;
        injectContext(body, `extra (full): ${titleCase(name)}`);
      } else if (c.state) {
        injectContext(c.state, `extra: ${titleCase(name)}/state.md`);
      } else {
        injectContext(`(no state.md in ${name})`, `extra: ${titleCase(name)}/state.md`);
      }
    } catch (err) { console.error("attach domain", err); }
  }, [vaultPath, injectContext]);
  // Test hook — expose on window so we can verify the inject flow
  // without dispatching synthetic DragEvents through WebKit. Call
  // window.__prevailAttach('tax') in DevTools to confirm the chip
  // appears in the composer.
  useEffect(() => {
    (window as unknown as { __prevailAttach?: (n: string, mode?: "light" | "full" | "folder") => void }).__prevailAttach = (n, mode) => void attachDomainAsContext(n, mode ?? "light");
    return () => { try { delete (window as unknown as { __prevailAttach?: unknown }).__prevailAttach; } catch {} };
  }, [attachDomainAsContext]);
  return (
    <div
      className="flex h-full"
      onDragOver={(e) => {
        const types = Array.from(e.dataTransfer.types);
        const hasCustom = types.includes("application/x-prevail-domain");
        const hasText = types.includes("text/plain");
        if (hasCustom || hasText) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          if (!dragOver) setDragOver(true);
        }
      }}
      onDragLeave={(e) => {
        // Ignore leaves that bubble from descendants.
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={async (e) => {
        setDragOver(false);
        const name = resolveDroppedDomain(e.dataTransfer);
        if (!name) return;
        e.preventDefault();
        void attachDomainAsContext(name, e.altKey ? "folder" : e.shiftKey ? "full" : "light");
      }}
    >
      <div className="relative flex min-w-0 flex-1 flex-col">
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-accent-soft/80 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-accent bg-surface px-8 py-6 text-center font-mono text-sm uppercase tracking-wider text-accent shadow-xl">
            ⊕ drop to add as context
            <div className="mt-1 text-[10px] normal-case tracking-normal text-accent/70">state summary · ⇧ full context · ⌥ entire folder</div>
          </div>
        </div>
      )}
      {/* Header — just the domain identity now. Insights / Preferences /
          archive moved up to the top tab bar; the score badge opens the
          context view. When no domain is active there's no header at all —
          the empty state owns the canvas. */}
      {domain && !isApp && (
        <div className="flex shrink-0 items-center gap-3 border-b border-border-subtle px-4 py-2">
          {(() => {
            const I = domainIcon(domain);
            return I ? <I className="h-5 w-5 shrink-0 text-accent" /> : <span className="text-accent">◆</span>;
          })()}
          <span className="shrink-0 font-display text-lg font-semibold">{titleCase(domain)}</span>
          <span className="hidden min-w-0 flex-1 truncate text-sm text-text-muted md:inline">{domainBlurb(domain)}</span>
          <div className="ml-auto shrink-0">
            <ContextScoreBadge
              score={ctxScore}
              onClick={() => setDomainTab(domainTab === "context" ? "chat" : "context")}
            />
          </div>
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {messages.length === 0 && !domain && (
          <div className="flex h-full flex-col items-center justify-center px-6 py-8">
            <PrevailLogo size={64} src="/logo-512.png" />
            <h2 className="mt-6 font-display text-5xl font-bold tracking-tight">
              What should we work on?
            </h2>
            <p className="mt-3 max-w-lg text-center text-lg text-text-muted">
              Your private AI that learns you and gets sharper every time you use it.
            </p>
            {lifeReadiness && lifeReadiness.life_readiness !== null && (
              <div
                className="mt-3 flex items-center gap-3 rounded-full border px-4 py-1.5"
                style={{ borderColor: scoreColor(lifeReadiness.life_readiness) }}
                title={`Life Readiness · average context score across ${lifeReadiness.domains.length} domain${lifeReadiness.domains.length === 1 ? "" : "s"}`}
              >
                <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">
                  Life Readiness
                </span>
                <span
                  className="font-display text-2xl font-bold leading-none"
                  style={{ color: scoreColor(lifeReadiness.life_readiness) }}
                >
                  {lifeReadiness.life_readiness}
                </span>
                <span className="font-mono text-[11px] text-text-muted">
                  / 100 · {lifeReadiness.domains.length} domain{lifeReadiness.domains.length === 1 ? "" : "s"}
                </span>
              </div>
            )}
            <AgentPickerRail
              clis={available}
              selected={selectedCli}
              onSelect={(id) => setSelectedCli(id)}
            />

            {domains.length > 0 && (() => {
              // Show pinned first, then ones with the most imports,
              // capped at 4. The full domain list still lives in the
              // sidebar — this landing surface is a quick-pick only.
              const pinnedSet = (() => {
                try { return new Set<string>(JSON.parse(lsGet("prevail.pinnedDomains") || "[]")); }
                catch { return new Set<string>(); }
              })();
              const ranked = [...domains].sort((a, b) => {
                const pa = pinnedSet.has(a.name) ? 1 : 0;
                const pb = pinnedSet.has(b.name) ? 1 : 0;
                if (pa !== pb) return pb - pa;
                const sa = domainStats[a.name] ?? 0;
                const sb = domainStats[b.name] ?? 0;
                if (sa !== sb) return sb - sa;
                return a.name.localeCompare(b.name);
              });
              const featured = ranked.slice(0, 4);
              return (
              <div className="mt-10 w-full max-w-5xl">
                <div className="mb-1.5 flex items-center justify-between">
                  <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">
                    Jump to · {featured.length} of {domains.length}
                  </div>
                  <span className="font-mono text-[10px] text-text-muted">more in sidebar</span>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {featured.map((d, i) => {
                    const Icon = DOMAIN_ICONS[d.name];
                    const running = runningDomains.has(d.name);
                    const color = domainColor(d.name);
                    return (
                      <motion.button
                        key={d.name}
                        onClick={() => onPickDomain(d.name)}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.04 * i, type: "spring", stiffness: 140, damping: 18 }}
                        whileHover={{ y: -3 }}
                        whileTap={{ scale: 0.99 }}
                        className="group relative flex h-[60px] flex-col overflow-hidden rounded-2xl border border-border-subtle bg-surface p-3 text-left transition-all duration-200 hover:border-border hover:shadow-[0_10px_34px_-12px_rgba(0,0,0,0.18)]"
                      >
                        {/* oversized watermark glyph — editorial fill, no text clutter */}
                        {Icon && (
                          <Icon
                            aria-hidden
                            className="pointer-events-none absolute -bottom-6 -right-5 h-28 w-28 transition-transform duration-500 group-hover:scale-110 group-hover:-rotate-3"
                            style={{ color, opacity: 0.06 }}
                          />
                        )}
                        {/* faint accent wash, reveals on hover */}
                        <span
                          aria-hidden
                          className="pointer-events-none absolute -right-16 -top-16 h-32 w-32 rounded-full opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-25"
                          style={{ background: color }}
                        />

                        {/* top: accent glyph + reveal chevron */}
                        <div className="flex items-center justify-between">
                          <span style={{ color }}>
                            {Icon ? <Icon className="h-[18px] w-[18px]" /> : <span className="font-mono text-sm">◆</span>}
                          </span>
                          <span className="flex items-center gap-2">
                            {running ? (
                              <span className="pulse-soft inline-block h-1.5 w-1.5 rounded-full bg-warn" title="A reply is streaming here" />
                            ) : finishedDomains.has(d.name) ? (
                              <span
                                className="inline-block h-1.5 w-1.5 rounded-full"
                                style={{
                                  background: "var(--color-ok, #2e9e5b)",
                                  boxShadow: "0 0 0 3px color-mix(in srgb, var(--color-ok, #2e9e5b) 28%, transparent)",
                                }}
                                title="Just finished: open to view"
                              />
                            ) : null}
                            <ChevronRight
                              className="h-4 w-4 -translate-x-1 text-text-muted opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100"
                            />
                          </span>
                        </div>

                        {/* name + blurb anchored at the bottom; status moved into
                            the top row so the card stays short without clipping */}
                        <div className="relative mt-auto">
                          <div className="flex items-baseline gap-2">
                            <div className="font-display text-base font-semibold leading-tight tracking-tight text-text-primary">
                              {titleCase(d.name)}
                            </div>
                            <span className="ml-auto h-px w-6 shrink-0 self-center rounded-full transition-all duration-300 group-hover:w-10" style={{ background: color }} />
                          </div>
                        </div>
                      </motion.button>
                    );
                  })}
                </div>
              </div>
              );
            })()}

            {domains.length === 0 && (
              <div className="mt-8 w-full max-w-2xl rounded-xl border border-dashed border-border bg-surface p-8 text-center">
                <p className="text-sm text-text-muted">
                  No domains yet. Create one in the sidebar to start grounding conversations in real life areas.
                </p>
              </div>
            )}
          </div>
        )}
        {domain && domainTab === "chat" && messages.length === 0 && (
          <DomainHome
            domain={domain}
            vaultPath={vaultPath}
            isApp={isApp}
            onInjectContext={(body, label) => injectContext(body, label)}
            onPickPrompt={(text) => setInput(text)}
            onInsertSkill={(name) => insertSkillSlash(name)}
            preferredSet={preferredSkillsSet}
            onTogglePreferred={togglePreferredSkill}
          />
        )}
        {domain && domainTab === "chat" && messages.length > 0 && (
          <div className="mx-auto w-full max-w-3xl px-6 py-8">
            <MessageList
              messages={messages}
              resetKey={chatViewNonce}
              onCopy={copyToClipboard}
              onRetry={retryFromHere}
              onEdit={editFromHere}
            />
          </div>
        )}
        {domainTab !== "chat" && (
          <div className="w-full px-6 py-6">
            {domain && domainTab === "context" && (
              <ContextScorePanel
                score={ctxScore}
                loading={ctxScoreLoading}
                rescanning={ctxScoreRescanning}
                error={ctxScoreError}
                onRescan={rescanContextScore}
              />
            )}
            {domainTab === "insights" && (
              <InsightsPanel
                vaultPath={vaultPath}
                domain={domain ?? ""}
                onSeed={(t) => { setInput(t); setDomainTab("chat"); }}
              />
            )}
            {domainTab === "usage" && (
              <UsageDashboard vault={vaultPath} domain={domain ?? null} nonce={chatViewNonce} />
            )}
            {domainTab === "apps" && domain && (
              <DomainAppsTab domain={domain} vaultPath={vaultPath} />
            )}
            {!domainCtx && domainTab !== "prefs" && domainTab !== "context" && domainTab !== "insights" && domainTab !== "usage" && domainTab !== "apps" && <div className="text-sm text-text-muted">loading…</div>}
            {domainCtx && domainTab === "state" && (domainCtx.state ? <Markdown source={domainCtx.state} compact /> : <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-sm text-text-muted">no <code className="text-accent">state.md</code> in this domain.</div>)}
            {domainCtx && domainTab === "decisions" && (domainCtx.decisions ? <Markdown source={domainCtx.decisions} compact /> : <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-sm text-text-muted">no <code className="text-accent">decisions.md</code> yet.</div>)}
            {domainCtx && domainTab === "journal" && (domainCtx.journal ? <Markdown source={domainCtx.journal} compact /> : <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-sm text-text-muted">no journal entries yet.</div>)}
            {domainCtx && domainTab === "logs" && (
              domainCtx.recent_logs.length === 0
                ? <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-sm text-text-muted">no past sessions.</div>
                : (
                  <ul className="flex flex-col gap-2">
                    {domainCtx.recent_logs.map((l) => (
                      <li key={l.path}>
                        <button
                          onClick={async () => {
                            try {
                              const body = await invoke<string>("read_file", { path: l.path });
                              injectContext(body, l.name);
                              setDomainTab("chat");
                            } catch (e) { console.error(e); }
                          }}
                          className="block w-full rounded-xl border border-border bg-surface px-4 py-3 text-left shadow-sm hover:-translate-y-px hover:border-accent-border hover:shadow-md"
                        >
                          <div className="font-mono text-sm text-text-primary">{l.name}</div>
                          {l.preview && <div className="mt-1 line-clamp-2 text-xs text-text-muted">{l.preview}</div>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )
            )}
            {domainCtx && domainTab === "skills" && domain && (
              <>
                <NewSkillForm
                  vaultPath={vaultPath}
                  domain={domain}
                  seed={newSkillSeed}
                  onCreated={() => { setNewSkillSeed(null); refreshDomainCtx(); }}
                />
                <SkillsList
                  skills={domainCtx.skills}
                  onInsert={(name) => { insertSkillSlash(name); setDomainTab("chat"); }}
                  preferredSet={preferredSkillsSet}
                  onTogglePreferred={togglePreferredSkill}
                />
              </>
            )}
            {domainTab === "prefs" && (
              <DomainPrefsPanel
                domain={domain || "general"}
                vaultPath={vaultPath}
                clis={clis}
                skills={domainCtx?.skills ?? []}
                preferredSkills={preferredSkills}
                onTogglePreferredSkill={togglePreferredSkill}
                onChanged={() => setPrefsTick((t) => t + 1)}
                onBack={() => setDomainTab("chat")}
              />
            )}
          </div>
        )}
        {!domain && messages.length > 0 && (
          <div className="mx-auto w-full max-w-3xl px-6 py-8">
            <MessageList
              messages={messages}
              resetKey={chatViewNonce}
              onCopy={copyToClipboard}
              onRetry={retryFromHere}
              onEdit={editFromHere}
            />
          </div>
        )}
      </div>

      {/* Codex-style composer — full width to match Council. The reply
          transcript above stays in a centered max-w-3xl column for
          readability; only the composer goes edge-to-edge. */}
      <div className="shrink-0 px-6 pb-6 pt-2">
        <div className="relative rounded-2xl border border-border bg-surface p-3 shadow-sm">
          {/* Context pills — auto-loaded + dragged-in domains */}
          {primedContext.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-1.5 px-2">
              {primedContext.map((c, i) => (
                <span
                  key={c.label}
                  className="inline-flex items-center gap-1 rounded-full border border-accent-border bg-accent-soft py-0.5 pl-2 pr-1 font-mono text-[11px] text-accent"
                  title={c.body.slice(0, 200)}
                >
                  <BookOpen className="h-3 w-3" />
                  {c.label}
                  <button
                    onClick={() => setPrimedContext((cur) => cur.filter((_, j) => j !== i))}
                    className="ml-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full text-text-muted hover:bg-surface-warm hover:text-err"
                    title="Remove from context"
                  >×</button>
                </span>
              ))}
            </div>
          )}
          {/* Slash-command popover for skills */}
          {slashMatch && slashCandidates.length > 0 && (
            <div className="absolute bottom-full left-3 z-40 mb-1 w-80 overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
              <div className="border-b border-border-subtle bg-surface-warm px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-text-muted">
                Skills · enter to insert
              </div>
              {slashCandidates.map((s, i) => (
                <button
                  key={s.path}
                  onMouseDown={(e) => { e.preventDefault(); applySlashCompletion(s.name); }}
                  className={`flex w-full items-start gap-2 px-3 py-1.5 text-left ${
                    i === slashIdx ? "bg-accent-soft" : "hover:bg-surface-warm"
                  }`}
                >
                  <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted" />
                  <div className="min-w-0">
                    <div className={`font-mono text-xs ${i === slashIdx ? "text-accent" : "text-text-primary"}`}>
                      /{s.name}
                    </div>
                    {s.description && <div className="line-clamp-1 text-[10px] text-text-muted">{s.description}</div>}
                  </div>
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={taRef}
            value={input}
            onChange={(e) => { setInput(e.target.value); setHistIdx(-1); }}
            onDragOver={(e) => {
              const types = Array.from(e.dataTransfer.types);
              if (types.includes("application/x-prevail-domain") || types.includes("text/plain")) {
                // Suppress native text-insertion so the parent drop
                // handler runs and the dropped domain becomes a context
                // chip instead of inline text in the prompt.
                const t = e.dataTransfer.getData("text/plain");
                if (t && !t.startsWith("prevail-domain:") && !types.includes("application/x-prevail-domain")) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
              }
            }}
            onDrop={(e) => {
              let name = e.dataTransfer.getData("application/x-prevail-domain");
              if (!name) {
                const t = e.dataTransfer.getData("text/plain");
                if (t && t.startsWith("prevail-domain:")) name = t.slice("prevail-domain:".length);
              }
              if (!name) return;
              // Stop the native text drop AND prevent bubbling so the
              // parent attaches it once (avoid double-attach).
              e.preventDefault();
              e.stopPropagation();
              void attachDomainAsContext(name, e.altKey ? "folder" : e.shiftKey ? "full" : "light");
            }}
            onPaste={async (e) => {
              if (lsGet("prevail.pref.autoConvertLongPaste") !== "1") return;
              const txt = e.clipboardData.getData("text/plain");
              if (txt.length < 5000) return;
              e.preventDefault();
              try {
                const path = await invoke<string>("write_paste_attachment", { vault: vaultPath, body: txt });
                setAttachments((cur) => (cur.includes(path) ? cur : [...cur, path]));
              } catch (err) { console.error("write_paste_attachment", err); }
            }}
            onKeyDown={(e) => {
              // If slash popover open, route arrow keys + enter/tab to it.
              if (slashMatch && slashCandidates.length > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSlashIdx((i) => (i + 1) % slashCandidates.length);
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSlashIdx((i) => (i - 1 + slashCandidates.length) % slashCandidates.length);
                  return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  applySlashCompletion(slashCandidates[slashIdx].name);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  // Insert a space after the `/` to break the match.
                  setInput((cur) => cur + " ");
                  return;
                }
              }
              const wantCmd = getPref(PREF.sendKey, "enter") === "cmd-enter";
              const cmd = e.metaKey || e.ctrlKey;
              const fires = e.key === "Enter" && !e.shiftKey && !e.altKey && (wantCmd ? cmd : !cmd);
              if (fires) {
                e.preventDefault();
                send();
                return;
              }
              // Arrow-up / arrow-down recall — only when the textarea
              // is at the very start (so we don't fight normal
              // line-up navigation inside multi-line drafts).
              const ta = e.currentTarget;
              const atStart = ta.selectionStart === 0 && ta.selectionEnd === 0;
              if (e.key === "ArrowUp" && atStart && history.length > 0) {
                e.preventDefault();
                const next = histIdx === -1 ? history.length - 1 : Math.max(0, histIdx - 1);
                setHistIdx(next);
                setInput(history[next] ?? "");
              } else if (e.key === "ArrowDown" && histIdx !== -1) {
                e.preventDefault();
                const next = histIdx + 1;
                if (next >= history.length) {
                  setHistIdx(-1);
                  setInput("");
                } else {
                  setHistIdx(next);
                  setInput(history[next] ?? "");
                }
              }
            }}
            placeholder={history.length > 0 ? "ask anything · enter to send · ↑ history · / skills" : "ask anything · enter to send · / skills · shift+enter for newline"}
            rows={2}
            className="w-full resize-none bg-transparent px-2 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
          />
          {/* Domain imports — chips for files in this domain's
              imports/ folder. Click to toggle attach. Auto-fetched
              when the domain changes. */}
          {domainImports.length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5 px-2">
              <span className="font-mono text-[9px] uppercase tracking-wider text-text-muted">
                imports
              </span>
              {domainImports.slice(0, 8).map((it) => {
                const on = attachments.includes(it.path);
                const src = it.meta?.source ?? "manual";
                return (
                  <button
                    key={it.path}
                    onClick={() => setAttachments((cur) =>
                      cur.includes(it.path)
                        ? cur.filter((p) => p !== it.path)
                        : [...cur, it.path]
                    )}
                    title={`${it.path} · ${(it.size / 1024).toFixed(1)} KB · ${src}`}
                    className={`inline-flex items-center gap-1 rounded-md py-0.5 pl-1.5 pr-2 font-mono text-[11px] transition-colors ${
                      on
                        ? "border border-accent-border bg-accent-soft text-accent"
                        : "border border-dashed border-border bg-background text-text-secondary hover:border-accent-border hover:text-accent"
                    }`}
                  >
                    <FileText className="h-3 w-3" />
                    {it.name.length > 28 ? it.name.slice(0, 14) + "…" + it.name.slice(-12) : it.name}
                  </button>
                );
              })}
              {domainImports.length > 8 && (
                <span className="font-mono text-[10px] text-text-muted">+{domainImports.length - 8} more</span>
              )}
            </div>
          )}
          {/* Attached skills — separate from textarea text. Removing
              text in the input doesn't affect these; remove a skill
              by hovering its pill and clicking ×. */}
          {attachedSkills.length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5 px-2">
              {attachedSkills.map((name) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1 rounded-md border border-accent-border bg-accent-soft py-0.5 pl-1.5 pr-1 font-mono text-[11px] text-accent"
                  title="Attached skill: included as `/name` reference in the prompt"
                >
                  <Sparkles className="h-3 w-3" />
                  /{name}
                  <button
                    onClick={() => removeAttachedSkill(name)}
                    className="ml-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full text-text-muted hover:bg-surface-warm hover:text-err"
                    title={`Remove /${name}`}
                  >×</button>
                </span>
              ))}
            </div>
          )}
          {/* Suggested skills — match the prompt's words against skill
              names and the first non-empty line of each SKILL.md. Only
              fires when the prompt is at least 8 chars to avoid noise. */}
          {(() => {
            if (input.trim().length < 8) return null;
            const lower = input.toLowerCase();
            const tokens = new Set(lower.split(/[^a-z0-9]+/).filter((t) => t.length >= 3));
            const attached = new Set(attachedSkills);
            const matches = skillsCache.filter((s) => {
              if (attached.has(s.name)) return false;
              const name = s.name.toLowerCase();
              if (tokens.has(name)) return true;
              const desc = (s.description ?? "").toLowerCase();
              for (const t of tokens) {
                if (t.length >= 4 && (name.includes(t) || desc.includes(t))) return true;
              }
              return false;
            }).slice(0, 3);
            if (matches.length === 0) return null;
            return (
              <div className="mt-1 flex flex-wrap items-center gap-1.5 px-2">
                <span className="font-mono text-[9px] uppercase tracking-wider text-text-muted">suggested</span>
                {matches.map((s) => (
                  <button
                    key={s.name}
                    onClick={() => insertSkillSlash(s.name)}
                    title={s.description ?? `Attach /${s.name}`}
                    className="inline-flex items-center gap-1 rounded-md border border-dashed border-border bg-background py-0.5 pl-1.5 pr-2 font-mono text-[11px] text-text-secondary hover:border-accent-border hover:text-accent"
                  >
                    <Sparkles className="h-3 w-3" />
                    /{s.name}
                  </button>
                ))}
              </div>
            );
          })()}
          {/* Attachment pills */}
          {attachments.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 px-2">
              {attachments.map((p, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background py-0.5 pl-2 pr-1 font-mono text-[11px] text-text-secondary">
                  <Folder className="h-3 w-3 text-text-muted" />
                  {p.split("/").pop()}
                  <button
                    onClick={() => setAttachments((cur) => cur.filter((_, j) => j !== i))}
                    className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-text-muted hover:bg-surface-warm hover:text-err"
                    title="Remove attachment"
                  >×</button>
                </span>
              ))}
            </div>
          )}
          {/* Single inline toolbar: + then the per-domain toggles,
              then a spacer, then model picker / council / send. */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <div className="relative" ref={plusMenuRef}>
              <button
                onClick={() => setPlusOpen((v) => !v)}
                title="Add file · attach domain state · use a skill"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background text-text-muted hover:bg-surface-warm hover:text-accent"
              >
                <Plus className="h-4 w-4" />
              </button>
              {plusOpen && (
                <div className="absolute bottom-full left-0 z-40 mb-2 w-72 overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
                  <button
                    onClick={pickAttachment}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-warm"
                  >
                    <Paperclip className="h-4 w-4 text-text-muted" />
                    Add files
                  </button>
                  {domain && domainPath && (
                    <button
                      onClick={attachDomainState}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-warm"
                    >
                      <PrevailLogo size={16} src="/logo-512.png" animated={false} />
                      Attach {titleCase(domain)} state
                    </button>
                  )}
                  {/* I7: turn the prompt you're writing into a reusable skill. */}
                  {domain && input.trim() && (
                    <button
                      onClick={() => { window.dispatchEvent(new CustomEvent("prevail:new-skill", { detail: input.trim() })); setPlusOpen(false); }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-warm"
                    >
                      <Sparkles className="h-4 w-4 text-text-muted" />
                      Save prompt as skill
                    </button>
                  )}
                  <div className="border-t border-border-subtle px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-text-muted">
                    Skills · {skillsCache.length}
                  </div>
                  {skillsCache.length === 0 && (
                    <div className="px-3 py-2 text-xs text-text-muted">
                      no skills under <code className="text-accent">{titleCase(domain ?? "-")}/_skills/</code>
                    </div>
                  )}
                  <div className="max-h-48 overflow-y-auto">
                    {skillsCache.map((s) => (
                      <button
                        key={s.path}
                        onClick={() => insertSkillRef(s)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-warm"
                      >
                        <Sparkles className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                        <div className="min-w-0">
                          <div className="truncate font-mono text-xs text-text-primary">/{s.name}</div>
                          {s.description && (
                            <div className="truncate text-[10px] text-text-muted">{s.description}</div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <DomainStatusBar domain={domain} fwLens={fwLens} />
            <div className="flex-1" />

            {/* Model picker pill — Codex-style. Click opens cascading
                provider→model menu. */}
            <div className="relative" ref={modelMenuRef}>
              <button
                onClick={() => setModelMenuOpen((v) => !v)}
                className="flex items-center gap-1.5 rounded-full border border-border bg-background px-2 py-1 transition-colors hover:bg-surface-warm"
                title="Pick model"
              >
                {selectedCli && <ProviderMark vendor={selectedCli} size={18} />}
                <span className="font-mono text-xs text-text-primary">
                  {selectedCliLabel}
                </span>
                {selectedModelLabel && (
                  <span className="font-mono text-xs text-text-muted">· {selectedModelLabel}</span>
                )}
                <svg className="h-3 w-3 text-text-muted" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5}>
                  <path d="M3 4.5L6 7.5L9 4.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {modelMenuOpen && (
                // Anchor left: the picker button sits on the left of the
                // composer toolbar, so opening rightward keeps the menu on
                // screen. (right-0 ran it off the window's left edge at
                // non-maximized widths, hiding the left-aligned model names.)
                <div className="absolute bottom-full left-0 z-40 mb-1 w-72 overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
                  <div className="border-b border-border-subtle px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-text-muted">
                    Model
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {clis.filter((c) => !isBunkerOn() || isLocalCli(c.id)).map((c) => {
                      const cliModels = MODELS[c.id] ?? [];
                      if (cliModels.length === 0) return null;
                      return (
                        <div key={c.id} className={c.available ? "" : "opacity-40"}>
                          <div className="flex items-center gap-2 bg-surface-warm/60 px-3 py-1">
                            <ProviderMark vendor={c.id} size={14} />
                            <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
                              {c.label}
                            </span>
                            {!c.available && (
                              <span className="ml-auto font-mono text-[10px] text-text-muted">not installed</span>
                            )}
                          </div>
                          {cliModels.map((m) => {
                            const isActive = selectedCli === c.id && selectedModel === m.id;
                            return (
                              <button
                                key={m.id}
                                onClick={() => {
                                  if (!c.available) return;
                                  setSelectedCli(c.id);
                                  setSelectedModel(c.id, m.id);
                                  setModelMenuOpen(false);
                                }}
                                disabled={!c.available}
                                className={`flex w-full items-center justify-between px-4 py-1.5 text-left transition-colors ${
                                  isActive ? "bg-accent-soft" : "hover:bg-surface-warm"
                                }`}
                              >
                                <div className="min-w-0">
                                  <div className={`font-mono text-xs ${isActive ? "text-accent" : "text-text-primary"}`}>
                                    {m.label}
                                  </div>
                                  {m.blurb && (
                                    <div className="text-[10px] text-text-muted">{m.blurb}</div>
                                  )}
                                </div>
                                {isActive && <Check className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={3} />}
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                  {/* Domain default management — only shown when in a
                      domain. Setting a model already auto-saves; this
                      lets the user clear the override. */}
                  {domain && (
                    <div className="flex items-center justify-between gap-2 border-t border-border-subtle bg-surface-warm/60 px-3 py-2 font-mono text-[10px] text-text-muted">
                      <span>
                        {lsGet(domainCliKey)
                          ? <>default for <span className="text-accent">{titleCase(domain)}</span>: {selectedCli} · {selectedModel || "-"}</>
                          : <>using global default · pick a model to set one for <span className="text-accent">{titleCase(domain)}</span></>}
                      </span>
                      {lsGet(domainCliKey) && (
                        <button
                          onClick={() => {
                            clearDomainModelOverride();
                            setModelMenuOpen(false);
                          }}
                          className="rounded border border-border bg-background px-1.5 py-0.5 hover:border-accent-border hover:text-accent"
                        >
                          reset
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <button
              onClick={onSwitchToCouncil}
              title="Switch to Council mode"
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 font-mono text-xs text-text-secondary hover:border-accent-border hover:bg-accent-soft hover:text-accent"
            >
              <Scale className="h-3.5 w-3.5" />
              Council
            </button>

            {(() => {
              const last = messages[messages.length - 1];
              const streaming = !!(last && last.streaming);
              if (streaming) {
                return (
                  <button
                    onClick={async () => {
                      try {
                        await invoke("abort_sessions", { prefix: sessionRef.current });
                      } catch (e) { console.error("abort chat", e); }
                      // Force-finish the streaming bubble so the UI unwinds.
                      setMessages((m) => {
                        const lst = m[m.length - 1];
                        if (lst && lst.streaming) {
                          return [...m.slice(0, -1), {
                            ...lst,
                            streaming: false,
                            content: lst.content ? lst.content + "\n\n(aborted)" : "(aborted by user)",
                          }];
                        }
                        return m;
                      });
                    }}
                    title="Stop the reply"
                    className="inline-flex items-center gap-1.5 rounded-full border border-err bg-err/10 px-4 py-1.5 text-sm font-semibold text-err hover:bg-err hover:text-background"
                  >
                    ■ Stop
                  </button>
                );
              }
              return (
                <button
                  onClick={send}
                  disabled={!input.trim() || !selectedCli}
                  title="Send (enter)"
                  className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-background shadow-sm transition-all hover:bg-accent-hover disabled:bg-surface-strong disabled:text-text-muted"
                >
                  Send
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
              );
            })()}
          </div>
        </div>
      </div>
      </div>
      {contextOpen ? (
        <DomainContextDrawer
          domain={domain ?? ""}
          vaultPath={vaultPath}
          domainPath={domainPath ?? ""}
          onClose={() => setContextOpen(false)}
          onInjectContext={(body, label) => injectContext(body, label)}
          onInsertSkill={(name) => insertSkillSlash(name)}
          preferredSet={preferredSkillsSet}
          onTogglePreferred={togglePreferredSkill}
        />
      ) : (
        <button
          onClick={() => setContextOpen(true)}
          title="Show context"
          className="flex w-9 shrink-0 items-center justify-center border-l border-border-subtle bg-surface py-3 text-text-muted transition-colors hover:bg-surface-warm hover:text-accent"
        >
          <PanelRightOpen className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

// Resolve a human label for a model id (e.g. "claude-opus-4-8" → "Opus 4.8").

// Render only the most recent slice of a conversation. A long thread loaded
// from disk can hold thousands of turns; mounting a full ReactMarkdown subtree
// per turn balloons the WebView heap (audit finding #1). We cap the rendered
// window and offer a "show earlier" control that reveals more on demand. Real
// indices are preserved so retry/edit still target the right turn.

function CouncilPanel({
  domain,
  domainPath,
  threadDomain,
  vaultPath: _vaultPath,
  clis,
  fwLens,
  activeThreadPath,
  onActiveThreadChange,
  onOpenInFinder,
  onSwitchToChat,
  onThreadsChanged,
  seedPrompt,
  seedAutoConvene,
  onSeedConsumed,
}: {
  domain: string | null;
  domainPath: string | null;
  // See ChatPanel: thread storage scope (app space when set), distinct from
  // the grounding `domain`.
  threadDomain?: string | null;
  vaultPath: string;
  clis: CliInfo[];
  fwLens: ReturnType<typeof useFrameworkLens>;
  activeThreadPath: string | null;
  onActiveThreadChange: (path: string | null) => void;
  onOpenInFinder: () => void;
  onSwitchToChat: () => void;
  onThreadsChanged?: () => void;
  seedPrompt?: string | null;
  seedAutoConvene?: boolean;
  onSeedConsumed?: () => void;
}) {
  // Thread storage scope (app space when set), else the grounding domain.
  const tDomain = threadDomain !== undefined ? threadDomain : domain;
  // All possible (cli, model) panelist slots across ALL providers —
  // even ones not installed are listed (greyed out) so the user knows
  // what's possible. Same provider can appear multiple times with
  // different models (e.g. Opus 4.7 AND Sonnet 4.6 both on panel).
  const allSlots = useMemo<PanelistSlot[]>(() => {
    const out: PanelistSlot[] = [];
    for (const c of clis) {
      const models = MODELS[c.id] ?? [{ id: "", label: "default" } as ModelPick];
      for (const m of models) {
        out.push({
          key: `${c.id}::${m.id}`,
          cli: c.id,
          cliLabel: c.label,
          model: m.id,
          modelLabel: m.label,
          blurb: m.blurb,
        });
      }
    }
    return out;
  }, [clis]);

  // Selected panelists default to first model of each AVAILABLE CLI.
  const [selectedSlots, setSelectedSlots] = useState<Set<string>>(() => new Set());
  // Per-slot verification status — "verified" once a one-shot ping
  // succeeds with this exact (cli, model). Persisted in localStorage
  // so repeated app launches don't keep re-pinging.
  type VerifyStatus = "unknown" | "verifying" | "ok" | "failed";
  const VERIFY_KEY = "prevail.council.verifySlots";
  const [verifyStatus, setVerifyStatus] = useState<Record<string, VerifyStatus>>(() => {
    try {
      const raw = lsGet(VERIFY_KEY);
      if (!raw) return {};
      const obj = JSON.parse(raw) as Record<string, "ok" | "failed">;
      // Only restore "ok" results; failures get re-tried next session.
      const out: Record<string, VerifyStatus> = {};
      for (const k of Object.keys(obj)) if (obj[k] === "ok") out[k] = "ok";
      return out;
    } catch { return {}; }
  });
  const [verifyError, setVerifyError] = useState<Record<string, string>>({});
  function persistVerify(next: Record<string, VerifyStatus>) {
    const trimmed: Record<string, "ok"> = {};
    for (const k of Object.keys(next)) if (next[k] === "ok") trimmed[k] = "ok";
    try { lsSet(VERIFY_KEY, JSON.stringify(trimmed)); } catch {}
  }
  async function verifySlot(slot: PanelistSlot) {
    setVerifyStatus((s) => ({ ...s, [slot.key]: "verifying" }));
    try {
      await invoke<string>("verify_cli_model", {
        args: { cli: slot.cli, model: slot.model || null },
      });
      setVerifyStatus((s) => {
        const next = { ...s, [slot.key]: "ok" as VerifyStatus };
        persistVerify(next);
        return next;
      });
      setVerifyError((e) => { const { [slot.key]: _, ...rest } = e; return rest; });
    } catch (e) {
      const msg = String(e).slice(0, 200);
      setVerifyStatus((s) => ({ ...s, [slot.key]: "failed" }));
      setVerifyError((er) => ({ ...er, [slot.key]: msg }));
    }
  }
  // @ts-expect-error queued for v0.2.42 "verify all" button
  async function verifyAllSelected() {
    for (const s of panelistSlotsAll()) {
      if (verifyStatus[s.key] === "ok") continue;
      await verifySlot(s);
    }
  }
  function panelistSlotsAll() {
    return allSlots.filter((s) => selectedSlots.has(s.key));
  }
  useEffect(() => {
    setSelectedSlots((cur) => {
      if (cur.size > 0) return cur;
      // Seed from the configured default council panel (Settings → Council),
      // which stores exact slot keys (`${cli}::${model}`) — so a panel can hold
      // several models from the same provider. Only keep slots that still exist
      // and whose provider is available. If nothing's configured, default to one
      // slot per available CLI.
      const configured = readCouncilMembers();
      const def = new Set<string>();
      for (const key of configured) {
        const slot = allSlots.find((s) => s.key === key);
        const cli = slot && clis.find((c) => c.id === slot.cli);
        if (slot && cli?.available) def.add(key);
      }
      if (def.size === 0) {
        const seen = new Set<string>();
        for (const s of allSlots) {
          const cli = clis.find((c) => c.id === s.cli);
          if (!cli?.available || seen.has(s.cli)) continue;
          seen.add(s.cli);
          def.add(s.key);
        }
      }
      return def;
    });
  }, [allSlots, clis]);
  const toggleSlot = (key: string) => {
    setSelectedSlots((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const panelistSlots = useMemo(
    () => allSlots.filter((s) => selectedSlots.has(s.key)),
    [allSlots, selectedSlots],
  );
  // Auto-verify any panelist slot that hasn't been verified yet (or
  // failed last time). Triggers when slots are selected/changed.
  // Persisted "ok" results in localStorage skip the re-check.
  useEffect(() => {
    for (const s of panelistSlots) {
      const cur = verifyStatus[s.key] ?? "unknown";
      if (cur === "unknown") {
        // Stagger so we don't hammer all CLIs simultaneously.
        const delay = Math.random() * 500;
        setTimeout(() => { verifySlot(s); }, delay);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelistSlots]);

  // Chair is a single (cli, model) pair — defaults to first selected
  // panelist's CLI with its first model, or whatever's saved.
  const [chairSlot, setChairSlot] = useState<string>("");
  useEffect(() => {
    if (chairSlot) return;
    // Prefer the configured chair SLOT (a specific model); fall back to the
    // legacy chair-by-CLI, then the first panelist.
    const savedSlot = readCouncilChair();
    if (savedSlot && allSlots.some((s) => s.key === savedSlot)) {
      setChairSlot(savedSlot);
      return;
    }
    const savedCli = lsGet(LS.defaultChairCli);
    if (savedCli) {
      const match = allSlots.find((s) => s.cli === savedCli);
      if (match) {
        setChairSlot(match.key);
        return;
      }
    }
    if (panelistSlots.length > 0) setChairSlot(panelistSlots[0].key);
    else if (allSlots.length > 0) setChairSlot(allSlots[0].key);
  }, [allSlots, panelistSlots, chairSlot]);

  useEffect(() => {
    const s = allSlots.find((x) => x.key === chairSlot);
    if (s) { lsSet(COUNCIL_CHAIR_KEY, s.key); lsSet(LS.defaultChairCli, s.cli); }
  }, [chairSlot, allSlots]);

  const chairSlotObj = useMemo(
    () => allSlots.find((s) => s.key === chairSlot) ?? null,
    [allSlots, chairSlot],
  );

  // Context drawer + primed extras (state.md, decisions, dragged-in
  // domains). Same machinery as Chat — gets prepended to the convened
  // prompt so panelists and the chair both see it.
  const [contextOpen, setContextOpen] = useState(false);
  const [primedContext, setPrimedContext] = useState<{ label: string; body: string }[]>([]);
  function injectContext(body: string, label: string) {
    setPrimedContext((cur) => {
      if (cur.some((c) => c.label === label)) return cur;
      return [...cur, { label, body }];
    });
  }
  // Resolve a dragged domain into a primed-context chip. Shared by the panel
  // drop zone AND the composer textarea so a domain dropped directly onto the
  // input still attaches (the textarea would otherwise eat the native drop).
  // Default = light (state.md); hold Shift for the full context bundle.
  async function attachCouncilDomain(name: string, full: boolean) {
    if (!name || !_vaultPath) return;
    try {
      const c = await invoke<DomainContextBundle>("domain_context", { vault: _vaultPath, domain: name });
      if (full) {
        const parts = [
          c.state && `## state.md\n${c.state}`,
          c.decisions && `## decisions\n${c.decisions}`,
          c.journal && `## journal\n${c.journal}`,
        ].filter(Boolean);
        injectContext(parts.length ? parts.join("\n\n") : `(no context files in ${name})`, `extra (full): ${titleCase(name)}`);
      } else {
        injectContext(c.state || `(no state.md in ${name})`, `extra: ${titleCase(name)}/state.md`);
      }
    } catch (err) { console.error("attach council domain", err); }
  }
  // Skills attached to the next convene — same model as Chat.
  const [attachedSkills, setAttachedSkills] = useState<string[]>(() => loadPreferredSkills(domain));
  const [preferredSkills, setPreferredSkills] = useState<string[]>(() => loadPreferredSkills(domain));
  useEffect(() => {
    const pref = loadPreferredSkills(domain);
    setPreferredSkills(pref);
    setAttachedSkills(pref);
  }, [domain]);
  const togglePreferredSkill = useCallback((name: string) => {
    setPreferredSkills((cur) => {
      const next = cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name];
      savePreferredSkills(domain, next);
      return next;
    });
    setAttachedSkills((cur) => (cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name]));
  }, [domain]);
  const preferredSkillsSet = useMemo(() => new Set(preferredSkills), [preferredSkills]);
  function insertSkillSlash(name: string) {
    setAttachedSkills((cur) => (cur.includes(name) ? cur : [...cur, name]));
    setContextOpen(false);
  }
  function removeAttachedSkill(name: string) {
    setAttachedSkills((cur) => cur.filter((n) => n !== name));
  }
  // Auto-prime the domain's state.md whenever the domain changes.
  useEffect(() => {
    if (!domain || !_vaultPath) {
      setPrimedContext((cur) => cur.filter((x) => !x.label.startsWith("auto:")));
      return;
    }
    let mounted = true;
    invoke<DomainContextBundle>("domain_context", { vault: _vaultPath, domain })
      .then((c) => {
        if (!mounted) return;
        const label = `auto: ${titleCase(domain)}/state.md`;
        setPrimedContext((cur) => {
          const cleared = cur.filter((x) => !x.label.startsWith("auto:"));
          if (!c.state) return cleared;
          return [...cleared, { label, body: c.state }];
        });
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, [domain, _vaultPath]);
  const [prompt, setPrompt] = useState("");
  // I4: a Decision/Risks card from the domain home routes here with a seeded
  // question — drop it into the composer so the user just picks panelists and
  // convenes. Consumed once so it doesn't re-fire on re-render.
  useEffect(() => {
    if (seedPrompt) {
      const q = seedPrompt;
      setPrompt(q);
      const auto = seedAutoConvene;
      onSeedConsumed?.();
      // Auto-council: the chat send routed here; convene immediately with the
      // seeded question (slight delay so panelist slots finish mounting).
      if (auto) setTimeout(() => void conveneWith(q), 150);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedPrompt]);
  // Snapshot of the prompt at the moment the council was convened.
  // Composer `prompt` clears after submit so the textarea is empty for
  // the next question; this preserves the question text shown above
  // the responses in the transcript.
  const [submittedPrompt, setSubmittedPrompt] = useState("");
  const [phase, setPhase] = useState<"idle" | "panelists" | "synthesizing" | "done">("idle");
  const [replies, setReplies] = useState<Record<string, PanelistReply>>({});
  const [verdict, setVerdict] = useState<string>("");
  // The decision-log id for the verdict currently on screen, so the user can
  // attach a thumbs up/down (decision_feedback) to it. (feedback v0.4.1 I5)
  const [verdictDecisionId, setVerdictDecisionId] = useState<string | null>(null);
  const [verdictRating, setVerdictRating] = useState<"up" | "down" | null>(null);
  const sessionRef = useRef<string>("");
  const unlistenRefs = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const u1 = await listen<{ session: string; cli: string; stream: string; data: string }>(
        "chat:chunk",
        (e) => {
          if (!mounted) return;
          if (!e.payload.session.startsWith(sessionRef.current)) return;
          if (e.payload.session.endsWith(":chair")) {
            if (e.payload.stream !== "stdout") return;
            setVerdict((v) => v + stripAnsi(e.payload.data));
            return;
          }
          const slotMatch = e.payload.session.match(/:slot:(.+)$/);
          if (!slotMatch) return;
          const slotKey = slotMatch[1];
          // Capture stderr so a panelist that errored shows its real
          // failure reason instead of a silent empty card.
          if (e.payload.stream === "stderr") {
            const errChunk = stripAnsi(e.payload.data);
            setReplies((r) => {
              const existing = r[slotKey] ?? { cli: e.payload.cli, content: "", streaming: true, startedAt: Date.now() };
              return { ...r, [slotKey]: { ...existing, stderr: (existing.stderr ?? "") + errChunk } };
            });
            return;
          }
          if (e.payload.stream !== "stdout") return;
          const clean = maybeStripSycophancy(stripAnsi(e.payload.data));
          setReplies((r) => {
            const existing = r[slotKey] ?? { cli: e.payload.cli, content: "", streaming: true, startedAt: Date.now() };
            return { ...r, [slotKey]: { ...existing, content: existing.content + clean } };
          });
        },
      );
      const u2 = await listen<{ session: string; cli: string; code: number }>(
        "chat:done",
        (e) => {
          if (!mounted) return;
          if (!e.payload.session.startsWith(sessionRef.current)) return;
          if (e.payload.session.endsWith(":chair")) {
            setPhase("done");
            return;
          }
          const slotMatch = e.payload.session.match(/:slot:(.+)$/);
          if (!slotMatch) return;
          const slotKey = slotMatch[1];
          setReplies((r) => {
            const existing = r[slotKey];
            if (!existing) return r;
            return { ...r, [slotKey]: { ...existing, streaming: false } };
          });
        },
      );
      unlistenRefs.current = [u1, u2];
    })();
    return () => {
      mounted = false;
      unlistenRefs.current.forEach((u) => u());
      unlistenRefs.current = [];
    };
  }, []);

  const allPanelistsDone = useMemo(
    () => panelistSlots.length > 0 && panelistSlots.every((s) => replies[s.key] && !replies[s.key].streaming),
    [panelistSlots, replies],
  );
  // Panelists that have actually produced a usable answer (finished, with
  // content). Drives the quorum / "summarize now" path so one stuck or
  // slow panelist can't hold the whole council hostage.
  const respondedSlots = useMemo(
    () => panelistSlots.filter((s) => { const r = replies[s.key]; return r && !r.streaming && r.content.trim().length > 0; }),
    [panelistSlots, replies],
  );
  const respondedCount = respondedSlots.length;

  // The set of panelists the chair will actually synthesize from. Tracked so
  // that when we summarize early, the still-pending cards render as "skipped"
  // rather than spinning forever.
  const [synthesisSlots, setSynthesisSlots] = useState<PanelistSlot[] | null>(null);

  const triggerChair = useCallback(async (slotsOverride?: PanelistSlot[]) => {
    if (!chairSlotObj) return;
    const slots = (slotsOverride && slotsOverride.length > 0) ? slotsOverride : panelistSlots;
    setSynthesisSlots(slots);
    const missing = panelistSlots.filter((s) => !slots.some((x) => x.key === s.key));
    let synthesisPrompt = buildSynthesisPrompt(submittedPrompt || prompt, replies, slots);
    if (missing.length > 0) {
      synthesisPrompt += `\n\nNOTE: ${missing.length} panelist(s) did not respond in time (${missing
        .map((s) => `${s.cliLabel} · ${s.modelLabel}`)
        .join(", ")}). Synthesize a verdict from the ${slots.length} response(s) above; do not wait for the rest.`;
    }
    setPhase("synthesizing");
    try {
      await invoke("chat_send", {
        args: {
          cli: chairSlotObj.cli,
          model: chairSlotObj.model || null,
          prompt: synthesisPrompt,
          session_id: `${sessionRef.current}:chair`,
        },
      });
    } catch (e) {
      setVerdict(`(chair error: ${e})`);
      setPhase("done");
    }
  }, [chairSlotObj, submittedPrompt, prompt, replies, panelistSlots]);

  // Manually synthesize from whoever has answered so far (the flexible path).
  const synthesizeNow = useCallback(() => {
    if (respondedSlots.length === 0) return;
    void triggerChair(respondedSlots);
  }, [respondedSlots, triggerChair]);

  // Everyone finished → synthesize from all.
  useEffect(() => {
    if (phase === "panelists" && allPanelistsDone) void triggerChair();
  }, [phase, allPanelistsDone, triggerChair]);

  // Quorum fallback: if all-but-one have answered and nothing new has arrived
  // for a grace window, auto-summarize so a stuck panelist doesn't block the
  // verdict forever. The effect re-runs (resetting the timer) on every chunk,
  // so the countdown only completes once the responsive panelists go quiet.
  useEffect(() => {
    if (phase !== "panelists") return;
    const total = panelistSlots.length;
    const quorumMet = total >= 3 && respondedCount >= total - 1 && respondedCount < total;
    if (!quorumMet) return;
    const t = setTimeout(() => { synthesizeNow(); }, 180_000); // 3 min after the last response
    return () => clearTimeout(t);
  }, [phase, respondedCount, panelistSlots.length, synthesizeNow]);

  // Persist the council session as a thread once the verdict lands.
  // Mirrors ChatPanel's auto-save but fires only on phase === "done"
  // so the file represents the complete deliberation rather than
  // intermediate in-flight state.
  // Accumulated prior turns for the active council thread, so convenes
  // continue a multi-turn conversation instead of spawning a new thread.
  const [councilTurns, setCouncilTurns] = useState<ThreadTurn[]>([]);
  const councilThreadRef = useRef<string | null>(activeThreadPath);
  const councilSelfSetRef = useRef<string | null>(null);
  // Load (or clear) the council transcript when the active thread changes.
  useEffect(() => {
    councilThreadRef.current = activeThreadPath ?? null;
    // We just saved this convene and adopted its own path — keep the result on
    // screen (don't clear the replies/verdict the user is reading).
    if (activeThreadPath && councilSelfSetRef.current === activeThreadPath) {
      councilSelfSetRef.current = null;
      return;
    }
    // Genuine thread switch (+ New, a different thread, or cleared on domain
    // change): clear the live convene state so the panel reflects the SELECTED
    // thread, not the previous convene's question/replies/verdict.
    setReplies({});
    setVerdict("");
    setSynthesisSlots(null);
    setSubmittedPrompt("");
    setPhase("idle");
    if (!activeThreadPath) { setCouncilTurns([]); return; }
    let cancelled = false;
    invoke<{ meta: ThreadMeta; turns: ThreadTurn[] }>("load_thread", { path: activeThreadPath })
      .then((t) => { if (!cancelled) setCouncilTurns(t.turns ?? []); })
      .catch((e) => console.error("load_thread (council)", e));
    return () => { cancelled = true; };
  }, [activeThreadPath]);

  const councilSavedRef = useRef(false);
  useEffect(() => {
    if (phase !== "done") { councilSavedRef.current = false; return; }
    if (councilSavedRef.current) return;
    if (!_vaultPath || !submittedPrompt) return;
    councilSavedRef.current = true;
    // Start from whatever is already in this thread so each convene
    // appends rather than replaces.
    const prior = councilTurns;
    const fresh: ThreadTurn[] = [
      { role: "user", cli: null, model: null, content: submittedPrompt },
    ];
    for (const s of panelistSlots) {
      const r = replies[s.key];
      if (!r || !r.content.trim()) continue;
      fresh.push({
        role: "assistant",
        cli: s.cli,
        model: s.model || null,
        content: `### ${s.cliLabel} · ${s.modelLabel}\n\n${r.content.trim()}`,
      });
    }
    if (verdict.trim()) {
      fresh.push({
        role: "assistant",
        cli: chairSlotObj?.cli ?? null,
        model: chairSlotObj?.model || null,
        content: `### Council verdict\n\n${verdict.trim()}`,
      });
    }
    const allTurns = [...prior, ...fresh];
    // Self-learning: record the verdict as a durable DECISION so the domain
    // learns from it — feeds _state derivation, scoring, and the Insights
    // surface, and can carry a thumbs up/down. (feedback v0.4.1 I1/I5)
    if (verdict.trim()) {
      const decisionId = `d-${Date.now()}`;
      setVerdictDecisionId(decisionId);
      setVerdictRating(null);
      invoke("decision_append", {
        vault: _vaultPath,
        domain: domain ?? null,
        record: {
          id: decisionId,
          kind: "council",
          ts: Date.now(),
          domain: domain ?? null,
          thread: councilThreadRef.current,
          prompt: submittedPrompt,
          verdict: verdict.trim(),
          chair: chairSlotObj ? { cli: chairSlotObj.cli, model: chairSlotObj.model || null } : null,
          panelists: panelistSlots.map((s) => ({ cli: s.cli, model: s.model || null })),
        },
      })
        .then(() => window.dispatchEvent(new CustomEvent("prevail:context-changed")))
        .catch((e) => console.error("decision_append (council)", e));
    }
    // Reuse the existing thread's slug when continuing; else create new.
    const cur = councilThreadRef.current;
    const slug = cur ? cur.split("/").pop()?.replace(/\.md$/, "") ?? null : null;
    // Title comes from the FIRST user turn of the conversation.
    const firstUser = (prior.find((t) => t.role === "user")?.content ?? submittedPrompt);
    const title = `Council · ${firstUser.slice(0, 50).replace(/\n/g, " ")}`;
    invoke<string>("save_thread", {
      vault: _vaultPath,
      domain: tDomain ?? null,
      slug,
      title,
      turns: allTurns,
    })
      .then((path) => {
        setCouncilTurns(allTurns);
        if (!councilThreadRef.current) {
          councilThreadRef.current = path;
          councilSelfSetRef.current = path;
          onActiveThreadChange(path);
        }
        onThreadsChanged?.();
      })
      .catch((e) => console.error("save_thread (council)", e));
  }, [phase, submittedPrompt, replies, verdict, panelistSlots, chairSlotObj, _vaultPath, domain, councilTurns, onActiveThreadChange, onThreadsChanged]);

  async function convene() {
    return conveneWith(prompt);
  }
  async function conveneWith(raw: string) {
    if (!raw.trim() || panelistSlots.length === 0) return;
    sessionRef.current = `council-${Date.now()}`;
    setReplies({});
    setVerdict("");
    setSynthesisSlots(null);
    setPhase("panelists");
    const trimmed = raw.trim();
    setSubmittedPrompt(trimmed);
    // Ideal State (constitution) preamble — load fresh per convene so edits
    // propagate without app restart. Highest precedence; leads the prompt.
    let idealMd = "";
    try { idealMd = await invoke<string>("read_ideal_state", { vault: _vaultPath }); } catch {}
    const userPreamble = buildIdealStatePreamble(idealMd);
    // Self-learning: prepend distilled long-term memory to the council too.
    let memoryMd = "";
    try { memoryMd = await invoke<string>("read_memory_md", { vault: _vaultPath, domain: domain ?? null }); } catch {}
    const memoryPreamble = (getPref(PREF.persistentMemory, "1") === "1" && memoryMd.trim())
      ? `--- Long-term memory (${domain ?? "General"}) ---\n${memoryMd.trim().slice(0, Number(getPref(PREF.memoryBudgetChars, "4000")))}\n\n`
      : "";
    const primedPreamble = primedContext.length > 0
      ? primedContext.map((c) => `--- ${c.label} ---\n${c.body.trim()}\n`).join("\n") + "\n"
      : "";
    const skillsPreamble = attachedSkills.length > 0
      ? `Use the following skills as part of your reply: ${attachedSkills.map((n) => `/${n}`).join(", ")}\n\n`
      : "";
    // Continuation: feed prior council turns (questions + chair verdicts)
    // so this convene builds on the conversation so far.
    const histItems = councilTurns.filter(
      (t) => t.role === "user" || t.content.startsWith("### Council verdict"),
    );
    const historyPreamble = histItems.length
      ? "--- Conversation so far ---\n" +
        histItems
          .map((t) =>
            t.role === "user"
              ? `User: ${t.content}`
              : `Council verdict: ${t.content.replace(/^### Council verdict\n\n/, "")}`,
          )
          .join("\n\n")
          .slice(0, 6000) +
        "\n\n--- New question (continue the conversation) ---\n"
      : "";
    const enrichedPrompt = fwLens.buildPrompt(`${userPreamble}${memoryPreamble}${primedPreamble}${historyPreamble}${skillsPreamble}${trimmed}`);
    setPrompt("");
    setAttachedSkills([]);
    for (const s of panelistSlots) {
      try {
        await invoke("chat_send", {
          args: {
            cli: s.cli,
            model: s.model || null,
            prompt: enrichedPrompt,
            session_id: `${sessionRef.current}:slot:${s.key}`,
          },
        });
      } catch (e) {
        setReplies((r) => ({
          ...r,
          [s.key]: { cli: s.cli, content: `(error spawning: ${e})`, streaming: false, startedAt: Date.now() },
        }));
      }
    }
  }

  // Cascading menus for the composer toolbar — one for adding a
  // panelist (provider → model), one for picking the chair.
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [chairMenuOpen, setChairMenuOpen] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const chairMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!addMenuOpen && !chairMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setAddMenuOpen(false);
      }
      if (chairMenuRef.current && !chairMenuRef.current.contains(e.target as Node)) {
        setChairMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [addMenuOpen, chairMenuOpen]);

  const [dragOver, setDragOver] = useState(false);
  return (
    <div
      className="flex h-full"
      onDragOver={(e) => {
        const types = Array.from(e.dataTransfer.types);
        if (types.includes("application/x-prevail-domain") || types.includes("text/plain")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          if (!dragOver) setDragOver(true);
        }
      }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false); }}
      onDrop={async (e) => {
        setDragOver(false);
        let name = e.dataTransfer.getData("application/x-prevail-domain");
        if (!name) {
          const t = e.dataTransfer.getData("text/plain");
          if (t.startsWith("prevail-domain:")) name = t.slice("prevail-domain:".length);
        }
        if (!name || !_vaultPath) return;
        e.preventDefault();
        // Same light/heavy behavior as Chat — default state summary, hold
        // Shift for the full context bundle.
        await attachCouncilDomain(name, e.shiftKey);
      }}
    >
      <div className="relative flex min-w-0 flex-1 flex-col">
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-accent-soft/80 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-accent bg-surface px-8 py-6 text-center font-mono text-sm uppercase tracking-wider text-accent shadow-xl">
            ⊕ drop to add as context
            <div className="mt-1 text-[10px] normal-case tracking-normal text-accent/70">state summary · ⇧ full context · ⌥ entire folder</div>
          </div>
        </div>
      )}
      {/* Minimal header — same shape as Chat. Domain + Finder on left. */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border-subtle px-6 py-3">
        {domain ? (
          <>
            {(() => {
              const I = domainIcon(domain);
              return I ? <I className="h-5 w-5 text-accent" /> : <span className="text-accent">◆</span>;
            })()}
            <span className="font-display text-lg font-semibold">{titleCase(domain)}</span>
            {domainPath && (
              <button
                onClick={onOpenInFinder}
                title="Open in Finder"
                className="inline-flex items-center gap-1 rounded-md border border-border-subtle bg-surface px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:bg-surface-warm hover:text-accent"
              >
                <Folder className="h-3 w-3" />
                Finder
              </button>
            )}
          </>
        ) : (
          <span className="font-mono text-xs uppercase tracking-[0.2em] text-text-muted">Council</span>
        )}
        <div className="flex-1" />
        {/* Context is a collapse/expand sidebar (right edge), never a labeled
            button: see the rail at the end of this panel. */}
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
          {panelistSlots.length} on panel
        </span>
      </div>

      {/* Hero / transcript area */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Prior council turns — multi-turn continuation history */}
        {councilTurns.length > 0 && (
          <div className="mx-auto max-w-3xl space-y-4 px-6 pt-6">
            {councilTurns.map((t, i) =>
              t.role === "user" ? (
                <div key={i} className="rounded-2xl border border-border-subtle bg-surface px-4 py-3 font-mono text-sm text-text-primary">
                  <span className="text-accent">$ </span>
                  {t.content}
                </div>
              ) : t.content.startsWith("### Council verdict") ? (
                <div key={i} className="rounded-2xl border border-accent-border bg-accent-soft px-4 py-3">
                  <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-accent">Council verdict</div>
                  <div className="text-sm leading-relaxed text-text-secondary">
                    <Markdown source={t.content.replace(/^### Council verdict\n\n/, "")} />
                  </div>
                </div>
              ) : null,
            )}
            {phase !== "idle" && (
              <div className="pb-1 pt-1 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">
                continuing…
              </div>
            )}
          </div>
        )}
        {councilTurns.length === 0 && phase === "idle" && (
          <div className="flex h-full flex-col items-center justify-start px-6 py-6">
            <img src="/logo.png" alt="" className="h-10 w-10 rounded-2xl opacity-90" />
            <h2 className="mt-3 font-display text-2xl font-semibold tracking-tight">
              <BrandMark /> Council
            </h2>
            <p className="mt-1.5 max-w-md text-center text-[13px] text-text-muted">
              {panelistSlots.length === 0 ? (
                <>Add panelists below, then ask the council.</>
              ) : (
                <>
                  {panelistSlots.length} model{panelistSlots.length === 1 ? "" : "s"} on panel · chair:{" "}
                  <span className="text-accent">
                    {chairSlotObj ? `${chairSlotObj.cliLabel.toLowerCase()} · ${chairSlotObj.modelLabel}` : "-"}
                  </span>
                  {" "}· best for <span className="text-accent">why</span> / <span className="text-accent">should-I</span> decisions, not quick lookups.
                </>
              )}
            </p>

            {/* Compact starter rows — one line each (glyph · label · the short
                question). Clicking loads the full prompt into the composer, so
                the body text doesn't need to sit here as a wall. */}
            <ul className="mt-5 flex w-full max-w-2xl flex-col gap-1.5">
              {buildCouncilQuickActions(domain).map((q) => (
                <li key={q.label}>
                  <button
                    onClick={() => setPrompt(q.prompt)}
                    title={q.prompt}
                    className="flex w-full items-center gap-2.5 rounded-lg border border-border bg-surface px-4 py-2.5 text-left transition-colors hover:border-accent-border hover:bg-surface-warm"
                  >
                    <span className="shrink-0 font-mono text-[11px] uppercase tracking-wider text-accent">{q.glyph} {q.label}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-text-secondary">{q.blurb}</span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {phase !== "idle" && (
          <div className="px-6 py-6">
            <div className="mb-6 rounded-lg border border-border bg-surface px-4 py-3 font-mono text-sm">
              <span className="text-accent">$</span> {submittedPrompt || prompt}
            </div>

            {/* Quorum control — once at least one panelist has answered but the
                council isn't fully back, let the user synthesize from whoever
                responded instead of waiting on a stuck panelist. */}
            {phase === "panelists" && respondedCount >= 1 && !allPanelistsDone && (
              <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-accent-border bg-accent-soft/50 px-4 py-2.5">
                <span className="text-sm text-text-secondary">
                  <span className="font-semibold text-accent">{respondedCount} of {panelistSlots.length}</span> panelists have answered.
                  {panelistSlots.length >= 3 && respondedCount >= panelistSlots.length - 1
                    ? " Auto-summarizing soon if the rest stay quiet."
                    : " Don't wait on a slow one."}
                </span>
                <button
                  onClick={synthesizeNow}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-background shadow-sm transition-colors hover:bg-accent-hover"
                >
                  <Crown className="h-3.5 w-3.5" /> Summarize now
                </button>
              </div>
            )}

            <div className="space-y-4">
              {panelistSlots.map((s) => {
                const r = replies[s.key];
                const cardAccent = vendorAccent(s.cli);
                const cardErrored = !!r && !r.streaming && !r.content;
                const cardError = cardErrored ? extractCliError(r.stderr) : null;
                // Synthesis ran without this panelist → it was skipped, not pending.
                const skipped = !!synthesisSlots && !synthesisSlots.some((x) => x.key === s.key) && (!r || (!r.content && r.streaming));
                const showThinking = getPref(PREF.showThinking, "1") === "1";
                const parts = r?.content ? splitThinking(r.content) : { thinking: "", answer: "" };
                return (
                  <details
                    key={s.key}
                    open={!skipped}
                    className="group overflow-hidden rounded-lg border border-border bg-surface"
                    style={{ borderLeftColor: cardAccent.accent, borderLeftWidth: 3 }}
                  >
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 border-b border-border-subtle bg-surface-warm px-4 py-2 font-mono text-xs [&::-webkit-details-marker]:hidden">
                      <span className="flex items-center gap-2">
                        <ChevronRight className="h-3.5 w-3.5 text-text-muted transition-transform group-open:rotate-90" />
                        <ProviderMark vendor={s.cli} size={18} />
                        <span style={{ color: cardAccent.accent }}>{s.cliLabel.toLowerCase()}</span>
                        <span className="text-text-muted">· {s.modelLabel}</span>
                      </span>
                      <span className="text-text-muted">
                        {skipped ? <span className="text-text-muted">skipped</span> : (
                          <>
                            {!r && "queued"}
                            {r?.streaming && <span className="pulse-soft text-accent">streaming</span>}
                            {r && !r.streaming && !cardErrored && <span className="text-ok">✓ done</span>}
                            {cardErrored && <span className="text-warn">⚠ no output</span>}
                          </>
                        )}
                      </span>
                    </summary>
                    <div className="px-5 py-4">
                      {r?.content ? (
                        <>
                          {showThinking && parts.thinking && <ThinkingDisclosure text={parts.thinking} open={!parts.answer} />}
                          {parts.answer ? <Markdown source={parts.answer} /> : (!parts.thinking && r.streaming ? <ThinkingDots /> : null)}
                          {r.streaming && parts.answer && <span className="cursor-blink text-accent">▌</span>}
                        </>
                      ) : skipped ? (
                        <p className="text-sm text-text-muted">Didn't respond in time. Left out of the verdict.</p>
                      ) : cardErrored ? (
                        cardError ? (
                          <pre className="whitespace-pre-wrap rounded-md bg-warn/10 px-2 py-1.5 font-mono text-[11px] leading-snug text-warn">{cardError}</pre>
                        ) : (
                          <p className="text-sm text-text-secondary">{s.cliLabel} produced no output (model rejected the prompt, hit a quota, or errored).</p>
                        )
                      ) : (
                        <ThinkingDots />
                      )}
                    </div>
                  </details>
                );
              })}
            </div>

            {(phase === "synthesizing" || phase === "done") && (() => {
              const vparts = splitThinking(verdict);
              const showThinking = getPref(PREF.showThinking, "1") === "1";
              return (
              <details open className="group mt-8 overflow-hidden rounded-lg border border-accent-border bg-accent-soft">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-6 py-4 font-mono text-xs uppercase tracking-[0.2em] text-accent [&::-webkit-details-marker]:hidden">
                  <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
                  <Crown className="h-3.5 w-3.5" />
                  <span>
                    verdict · synthesized by{" "}
                    {chairSlotObj ? `${chairSlotObj.cliLabel.toLowerCase()} · ${chairSlotObj.modelLabel}` : "-"}
                  </span>
                  {phase === "synthesizing" && <span className="pulse-soft">streaming</span>}
                </summary>
              <div className="px-6 pb-6">
                <div>
                  {verdict ? (
                    <>
                      {showThinking && vparts.thinking && <ThinkingDisclosure text={vparts.thinking} open={!vparts.answer} />}
                      {vparts.answer ? <Markdown source={vparts.answer} /> : (!vparts.thinking ? <ThinkingDots /> : null)}
                    </>
                  ) : (
                    <ThinkingDots />
                  )}
                  {phase === "synthesizing" && vparts.answer && <span className="cursor-blink text-accent">▌</span>}
                </div>
                {/* Verdict feedback — thumbs up/down trains which model + lens +
                    framework produce verdicts the user trusts. (v0.4.1 I5) */}
                {phase === "done" && verdict && verdictDecisionId && (
                  <div className="mt-4 flex items-center gap-2 border-t border-accent-border/40 pt-3 text-xs text-text-muted">
                    <span>Was this verdict useful?</span>
                    <button
                      title="Good verdict"
                      onClick={() => {
                        const next = verdictRating === "up" ? null : "up";
                        setVerdictRating(next);
                        invoke("decision_feedback", { vault: _vaultPath, domain: domain ?? null, id: verdictDecisionId, rating: next ?? "clear", note: null }).then(() => window.dispatchEvent(new CustomEvent("prevail:context-changed"))).catch((e) => console.error("decision_feedback", e));
                      }}
                      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 transition-colors ${verdictRating === "up" ? "border-accent bg-accent-soft text-accent" : "border-border hover:bg-surface-strong"}`}
                    >
                      <ThumbsUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      title="Not useful"
                      onClick={() => {
                        const next = verdictRating === "down" ? null : "down";
                        setVerdictRating(next);
                        invoke("decision_feedback", { vault: _vaultPath, domain: domain ?? null, id: verdictDecisionId, rating: next ?? "clear", note: null }).then(() => window.dispatchEvent(new CustomEvent("prevail:context-changed"))).catch((e) => console.error("decision_feedback", e));
                      }}
                      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 transition-colors ${verdictRating === "down" ? "border-red-400 bg-red-500/10 text-red-500" : "border-border hover:bg-surface-strong"}`}
                    >
                      <ThumbsDown className="h-3.5 w-3.5" />
                    </button>
                    {verdictRating && <span className="text-text-muted">· saved</span>}
                  </div>
                )}
              </div>
              </details>
              );
            })()}
          </div>
        )}
      </div>

      {/* Codex-style composer — textarea + panelist pills + chair pill */}
      <div className="shrink-0 px-6 pb-6 pt-2">
        <div className="rounded-2xl border border-border bg-surface p-3 shadow-sm">
          {/* Context pills — auto-primed + dragged-in domains */}
          {primedContext.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-1.5 px-2">
              {primedContext.map((c, i) => (
                <span
                  key={c.label}
                  className="inline-flex items-center gap-1 rounded-full border border-accent-border bg-accent-soft py-0.5 pl-2 pr-1 font-mono text-[11px] text-accent"
                  title={c.body.slice(0, 200)}
                >
                  <BookOpen className="h-3 w-3" />
                  {c.label}
                  <button
                    onClick={() => setPrimedContext((cur) => cur.filter((_, j) => j !== i))}
                    className="ml-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full text-text-muted hover:bg-surface-warm hover:text-err"
                    title="Remove from context"
                  >×</button>
                </span>
              ))}
            </div>
          )}
          {/* Attached skills */}
          {attachedSkills.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-1.5 px-2">
              {attachedSkills.map((name) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1 rounded-md border border-accent-border bg-accent-soft py-0.5 pl-1.5 pr-1 font-mono text-[11px] text-accent"
                >
                  <Sparkles className="h-3 w-3" />
                  /{name}
                  <button
                    onClick={() => removeAttachedSkill(name)}
                    className="ml-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full text-text-muted hover:bg-surface-warm hover:text-err"
                    title={`Remove /${name}`}
                  >×</button>
                </span>
              ))}
            </div>
          )}
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onDragOver={(e) => {
              const types = Array.from(e.dataTransfer.types);
              if (types.includes("application/x-prevail-domain") || types.includes("text/plain")) {
                // Suppress native text-insertion so the dropped domain becomes
                // a context chip instead of inline text in the prompt.
                const t = e.dataTransfer.getData("text/plain");
                if (t && !t.startsWith("prevail-domain:") && !types.includes("application/x-prevail-domain")) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
              }
            }}
            onDrop={(e) => {
              let name = e.dataTransfer.getData("application/x-prevail-domain");
              if (!name) {
                const t = e.dataTransfer.getData("text/plain");
                if (t && t.startsWith("prevail-domain:")) name = t.slice("prevail-domain:".length);
              }
              if (!name) return;
              // Handle here and stop bubbling so the panel drop zone doesn't
              // attach it a second time.
              e.preventDefault();
              e.stopPropagation();
              void attachCouncilDomain(name, e.shiftKey);
            }}
            onKeyDown={(e) => {
              const wantCmd = getPref(PREF.sendKey, "enter") === "cmd-enter";
              const cmd = e.metaKey || e.ctrlKey;
              const fires = e.key === "Enter" && !e.shiftKey && !e.altKey && (wantCmd ? cmd : !cmd);
              if (fires) {
                e.preventDefault();
                convene();
              }
            }}
            placeholder="ask the council · enter to convene · shift+enter for newline"
            rows={2}
            disabled={phase === "panelists" || phase === "synthesizing"}
            className="w-full resize-none bg-transparent px-2 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none disabled:opacity-50"
          />

          {/* Panelist pills row — each with a verification badge */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {panelistSlots.map((s) => {
              const st = verifyStatus[s.key] ?? "unknown";
              const tip = verifyError[s.key]
                ? `Failed: ${verifyError[s.key]}\n\nClick the dot to re-verify.`
                : st === "ok"
                ? "Verified: model is ready"
                : st === "verifying"
                ? "Verifying…"
                : "Click the dot to verify this model";
              return (
                <span
                  key={s.key}
                  title={s.blurb}
                  className={`inline-flex items-center gap-1 rounded-full border py-0.5 pl-0.5 pr-1.5 ${
                    st === "failed" ? "border-err bg-err/10" : "border-border bg-background"
                  }`}
                >
                  <ProviderMark vendor={s.cli} size={16} />
                  <span className="font-mono text-[11px] text-text-primary">{s.modelLabel}</span>
                  <button
                    onClick={() => verifySlot(s)}
                    title={tip}
                    className={`ml-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full text-[10px] ${
                      st === "ok"
                        ? "bg-ok text-background"
                        : st === "failed"
                        ? "bg-err text-background"
                        : st === "verifying"
                        ? "bg-warn text-background"
                        : "border border-border-strong text-text-muted hover:border-accent-border hover:text-accent"
                    }`}
                  >
                    {st === "ok" ? "✓" : st === "failed" ? "✗" : st === "verifying" ? "…" : "?"}
                  </button>
                  <button
                    onClick={() => toggleSlot(s.key)}
                    className="ml-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full text-text-muted hover:bg-surface-warm hover:text-err"
                    title="Remove from panel"
                  >
                    ×
                  </button>
                </span>
              );
            })}

            {/* + add panelist */}
            <div className="relative" ref={addMenuRef}>
              <button
                onClick={() => setAddMenuOpen((v) => !v)}
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-border bg-background px-2 py-0.5 font-mono text-[11px] text-text-muted hover:border-accent-border hover:text-accent"
              >
                <Plus className="h-3 w-3" /> add
              </button>
              {addMenuOpen && (
                <div className="absolute bottom-full left-0 z-40 mb-1 w-72 overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
                  <div className="border-b border-border-subtle px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-text-muted">
                    Add panelist
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {clis.filter((c) => !isBunkerOn() || isLocalCli(c.id)).map((c) => {
                      const cliModels = MODELS[c.id] ?? [];
                      if (cliModels.length === 0) return null;
                      return (
                        <div key={c.id} className={c.available ? "" : "opacity-40"}>
                          <div className="flex items-center gap-2 bg-surface-warm/60 px-3 py-1">
                            <ProviderMark vendor={c.id} size={14} />
                            <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
                              {c.label}
                            </span>
                            {!c.available && (
                              <span className="ml-auto font-mono text-[10px] text-text-muted">not installed</span>
                            )}
                          </div>
                          {cliModels.map((m) => {
                            const slotKey = `${c.id}::${m.id}`;
                            const onPanel = selectedSlots.has(slotKey);
                            return (
                              <button
                                key={m.id}
                                onClick={() => {
                                  if (!c.available) return;
                                  toggleSlot(slotKey);
                                }}
                                disabled={!c.available}
                                className={`flex w-full items-center justify-between px-4 py-1.5 text-left transition-colors ${
                                  onPanel ? "bg-accent-soft" : "hover:bg-surface-warm"
                                }`}
                              >
                                <div className="min-w-0">
                                  <div className={`font-mono text-xs ${onPanel ? "text-accent" : "text-text-primary"}`}>
                                    {m.label}
                                  </div>
                                  {m.blurb && <div className="text-[10px] text-text-muted">{m.blurb}</div>}
                                </div>
                                {onPanel && <Check className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={3} />}
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Single inline toolbar: toggles · spacer · chair · chat · send */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-border-subtle pt-2">
            <DomainStatusBar domain={domain} fwLens={fwLens} />
            <div className="flex-1" />

            {/* Chair pill */}
            <div className="relative" ref={chairMenuRef}>
              <button
                onClick={() => setChairMenuOpen((v) => !v)}
                className="flex items-center gap-1.5 rounded-full border border-border bg-background px-2 py-1"
                title="Chair (writes the verdict)"
              >
                <Crown className="h-3 w-3 text-accent" />
                {chairSlotObj && <ProviderMark vendor={chairSlotObj.cli} size={16} />}
                <span className="font-mono text-[11px] text-text-primary">
                  {chairSlotObj ? chairSlotObj.modelLabel : "no chair"}
                </span>
                <svg className="h-3 w-3 text-text-muted" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5}>
                  <path d="M3 4.5L6 7.5L9 4.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {chairMenuOpen && (
                <div className="absolute bottom-full right-0 z-40 mb-1 w-72 overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
                  <div className="border-b border-border-subtle px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-text-muted">
                    Chair
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {clis.filter((c) => !isBunkerOn() || isLocalCli(c.id)).map((c) => {
                      const cliModels = MODELS[c.id] ?? [];
                      if (cliModels.length === 0) return null;
                      return (
                        <div key={c.id} className={c.available ? "" : "opacity-40"}>
                          <div className="flex items-center gap-2 bg-surface-warm/60 px-3 py-1">
                            <ProviderMark vendor={c.id} size={14} />
                            <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
                              {c.label}
                            </span>
                          </div>
                          {cliModels.map((m) => {
                            const slotKey = `${c.id}::${m.id}`;
                            const isChair = chairSlot === slotKey;
                            return (
                              <button
                                key={m.id}
                                onClick={() => {
                                  if (!c.available) return;
                                  setChairSlot(slotKey);
                                  setChairMenuOpen(false);
                                }}
                                disabled={!c.available}
                                className={`flex w-full items-center justify-between px-4 py-1.5 text-left transition-colors ${
                                  isChair ? "bg-accent-soft" : "hover:bg-surface-warm"
                                }`}
                              >
                                <span className={`font-mono text-xs ${isChair ? "text-accent" : "text-text-primary"}`}>
                                  {m.label}
                                </span>
                                {isChair && <Check className="h-3.5 w-3.5 text-accent" strokeWidth={3} />}
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={onSwitchToChat}
              title="Back to single-model conversation"
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 font-mono text-xs text-text-secondary hover:border-accent-border hover:bg-accent-soft hover:text-accent"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Chat
            </button>
            {(phase === "panelists" || phase === "synthesizing") ? (
              <button
                onClick={async () => {
                  try {
                    await invoke("abort_sessions", { prefix: sessionRef.current });
                  } catch (e) { console.error("abort", e); }
                  // Mark EVERY selected slot as aborted — including
                  // ones that never reached the streaming state
                  // ("queued" / "thinking" cards). Bug fix: previously
                  // we only iterated existing reply keys, which left
                  // never-started panelists hanging in the UI.
                  setReplies((r) => {
                    const next = { ...r };
                    for (const s of panelistSlots) {
                      const existing = next[s.key];
                      if (!existing) {
                        next[s.key] = {
                          cli: s.cli,
                          content: "(aborted before starting)",
                          streaming: false,
                          startedAt: Date.now(),
                        };
                      } else if (existing.streaming) {
                        next[s.key] = {
                          ...existing,
                          streaming: false,
                          content: existing.content
                            ? existing.content + "\n\n(aborted)"
                            : "(aborted)",
                        };
                      }
                    }
                    return next;
                  });
                  setPhase("done");
                  setVerdict((v) => v ? v + "\n\n(aborted)" : "(aborted by user)");
                }}
                title="Stop the council mid-run"
                className="inline-flex items-center gap-1.5 rounded-full border border-err bg-err/10 px-4 py-1.5 text-sm font-semibold text-err hover:bg-err hover:text-background"
              >
                ■ Stop
              </button>
            ) : (
              <button
                onClick={convene}
                disabled={!prompt.trim() || panelistSlots.length === 0}
                title="Convene the council (enter)"
                className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-background shadow-sm transition-all hover:bg-accent-hover disabled:bg-surface-strong disabled:text-text-muted"
              >
                <Scale className="h-3.5 w-3.5" />
                Convene
              </button>
            )}
          </div>
        </div>
      </div>
      </div>
      {_vaultPath && (contextOpen ? (
        <DomainContextDrawer
          domain={domain ?? ""}
          vaultPath={_vaultPath}
          domainPath={domainPath ?? ""}
          onClose={() => setContextOpen(false)}
          onInjectContext={(body, label) => injectContext(body, label)}
          onInsertSkill={(name) => insertSkillSlash(name)}
          preferredSet={preferredSkillsSet}
          onTogglePreferred={togglePreferredSkill}
        />
      ) : (
        // Collapsed: a thin chevron rail to expand the context sidebar — no
        // labeled button, just the collapse/expand affordance.
        <button
          onClick={() => setContextOpen(true)}
          title="Show context"
          className="flex w-9 shrink-0 items-center justify-center border-l border-border-subtle bg-surface py-3 text-text-muted transition-colors hover:bg-surface-warm hover:text-accent"
        >
          <PanelRightOpen className="h-4 w-4" />
        </button>
      ))}
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────
// BENCHMARK PANEL — leaderboard + drill-down



// Small color-coded Context Score pill for the domain header. Click jumps
// to the Context tab. Tooltip shows freshness + audit recency.

// Full Context tab: big score ring, the six dimensions as ScoreBars, the
// what's-missing list grouped by severity, the LLM assessment + last
// audited, and a Re-scan button (forces a fresh audit).

// Visible CLI kinds for benchmark runs — must match the prevail CLI's
// internal `kind` identifiers. Antigravity = google's `agy` CLI.






function SettingsPanel({
  appearance,
  vaultPath,
  onChangeVault,
  clis,
  onRefreshClis,
  onBack,
  onStartChatWith,
  bunkerEnabled,
  onBunkerChange,
  onSetupDomains,
  onVaultMoved,
  jumpTo,
}: {
  appearance: ReturnType<typeof useAppearance>;
  vaultPath: string;
  onChangeVault: () => void;
  clis: CliInfo[];
  onRefreshClis: () => Promise<CliInfo[]>;
  onBack?: () => void;
  onStartChatWith?: (cliId: string, modelId?: string) => void;
  bunkerEnabled: boolean;
  onBunkerChange: (on: boolean) => void;
  onSetupDomains?: () => void;
  onVaultMoved?: (path: string) => void;
  jumpTo?: { section: string; n: number } | null;
}) {
  type Section = "general" | "models" | "benchmark" | "privacy" | "connectors" | "configuration" | "ideal-state" | "memory" | "intents" | "tasks" | "daemons" | "safety" | "council" | "gateway" | "mcp" | "remote" | "vault" | "demo" | "appearance" | "frameworks" | "skills" | "shortcuts" | "about";
  const [section, setSection] = useState<Section>(jumpTo?.section ? (jumpTo.section as Section) : "general");
  // Allow callers (e.g. the Demo ribbon's "Switch to Production" link) to jump
  // straight to a section. The nonce makes repeat jumps to the same section fire.
  useEffect(() => {
    if (jumpTo?.section) setSection(jumpTo.section as Section);
  }, [jumpTo?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  const [settingsDeepLink, setSettingsDeepLink] = useState<string | null>(null);
  // In-settings deep links (e.g. a model row's "runs" button jumping to the
  // Benchmark cockpit) dispatch this event rather than threading props.
  // Format: "section" or "section:detail" — detail is passed to the section.
  useEffect(() => {
    const onJump = (e: Event) => {
      const raw = (e as CustomEvent<string>).detail;
      if (!raw) return;
      const colonIdx = raw.indexOf(":");
      if (colonIdx === -1) {
        setSection(raw as Section);
        setSettingsDeepLink(null);
      } else {
        setSection(raw.slice(0, colonIdx) as Section);
        setSettingsDeepLink(raw.slice(colonIdx + 1));
      }
    };
    window.addEventListener("prevail:settings-section", onJump as EventListener);
    return () => window.removeEventListener("prevail:settings-section", onJump as EventListener);
  }, []);

  // Grouped settings nav — the flat 19-item list was hard to scan and mixed
  // unrelated concerns (e.g. General vs Defaults overlap). Organized into
  // labeled sections so related settings sit together and the redundancy reads
  // as intentional structure.
  type NavItem = { id: Section; label: string; icon: typeof Folder };
  const navGroups: Array<{ heading: string; items: NavItem[] }> = [
    { heading: "Models & AI", items: [
      { id: "models", label: "Models", icon: Layers },
      { id: "benchmark", label: "Benchmark", icon: Target },
      { id: "council", label: "Council", icon: Scale },
      { id: "frameworks", label: "Frameworks", icon: Scale },
      { id: "skills", label: "Skills", icon: Sparkles },
    ]},
    { heading: "Privacy & Safety", items: [
      { id: "privacy", label: "Privacy", icon: ShieldCheck },
      { id: "safety", label: "Safety", icon: Shield },
    ]},
    { heading: "Apps", items: [
      { id: "connectors", label: "Apps", icon: Plug },
      { id: "gateway", label: "Gateway", icon: MessagesSquare },
      { id: "mcp", label: "MCP", icon: Wrench },
    ]},
    { heading: "You & Vault", items: [
      { id: "configuration", label: "Configuration", icon: Brain },
      { id: "intents", label: "Intents", icon: Lightbulb },
      { id: "daemons", label: "Daemons", icon: Zap },
      { id: "vault", label: "Vault", icon: Folder },
      { id: "demo", label: "Demo Mode", icon: Sparkles },
    ]},
    { heading: "App", items: [
      { id: "general", label: "General", icon: SettingsIcon },
      { id: "about", label: "About", icon: Github },
    ]},
  ];

  // Live-bridge counter — used to light up the Gateway row in the nav
  // when one or more routers (currently just Telegram) is running.
  const [liveBridges, setLiveBridges] = useState(0);
  useEffect(() => {
    async function poll() {
      let n = 0;
      try {
        const tg = await invoke<{ running: boolean }>("telegram_bridge_status");
        if (tg.running) n++;
      } catch { /* ignore */ }
      setLiveBridges(n);
    }
    void poll();
    const id = window.setInterval(() => void poll(), 4000);
    return () => window.clearInterval(id);
  }, []);

  // MCP live indicator — read from localStorage; McpCard writes the same key.
  const [mcpLive, setMcpLive] = useState(() => lsGet(LS.mcpEnabled) === "1");
  useEffect(() => {
    const id = window.setInterval(() => setMcpLive(lsGet(LS.mcpEnabled) === "1"), 2000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="flex h-full">
      {/* Sidebar nav — Codex-style with Back to app at top */}
      <aside className="flex h-full min-h-0 w-56 shrink-0 flex-col overflow-y-auto border-r border-border-subtle bg-surface-warm px-2 py-3">
        {onBack && (
          <button
            onClick={onBack}
            className="mb-3 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-text-muted hover:bg-surface-warm hover:text-text-primary"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to app
          </button>
        )}
        <div className="mb-1 px-3 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">
          Settings
        </div>
        {navGroups.map((group) => (
          <div key={group.heading} className="mb-1.5">
            <div className="mb-0.5 mt-2 px-3 font-mono text-[9px] uppercase tracking-[0.18em] text-text-muted/70">
              {group.heading}
            </div>
            {group.items.map((it) => {
              const Icon = it.icon;
              const active = section === it.id;
              const showLiveGateway = it.id === "gateway" && liveBridges > 0;
              const showLiveMcp = it.id === "mcp" && mcpLive;
              return (
                <button
                  key={it.id}
                  onClick={() => setSection(it.id)}
                  className={`flex w-full items-center gap-3 rounded-md px-3 py-1.5 text-left text-sm transition-colors ${
                    active
                      ? "bg-accent-soft text-accent"
                      : "text-text-secondary hover:bg-surface-warm hover:text-text-primary"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span className="flex-1">{it.label}</span>
                  {showLiveGateway && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-1.5 py-0 font-mono text-[9px] uppercase tracking-wider text-accent"
                      title={`${liveBridges} bridge${liveBridges === 1 ? "" : "s"} live`}
                    >
                      <span className="pulse-soft inline-block h-1 w-1 rounded-full bg-accent" />
                      live{liveBridges > 1 ? ` ${liveBridges}` : ""}
                    </span>
                  )}
                  {showLiveMcp && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full bg-ai/15 px-1.5 py-0 font-mono text-[9px] uppercase tracking-wider text-ai"
                      title="MCP server enabled"
                    >
                      <span className="pulse-soft inline-block h-1 w-1 rounded-full bg-ai" />
                      on
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </aside>

      {/* Main pane */}
      <div className="min-w-0 flex-1 overflow-y-auto">
        {/* Full width — settings use the whole pane, left-aligned, to match
            the rest of the app. Long prose inside sections caps itself
            (subtitles use max-w-2xl) so readability stays intact. */}
        <div className="w-full px-8 py-10">
          {section === "general" && <GeneralSection appearance={appearance} />}
          {section === "privacy" && <PrivacyConnectivitySection enabled={bunkerEnabled} onChange={onBunkerChange} />}
          {section === "models" && <ModelsSection clis={clis} onStartChatWith={onStartChatWith} onActivated={onRefreshClis} />}
          {section === "benchmark" && (
            <>
              <SettingsHeader
                title="Benchmark"
                icon={Target}
                subtitle="Your personal eval suite. Run any model against your own questions across every domain, see who leads where, and manage the question set: write, AI-draft from your data, import, export."
              />
              <BenchScheduleCard vault={vaultPath} />
              <div className="-mx-4 min-h-[60vh]">
                <BenchmarkPanel vaultPath={vaultPath} />
              </div>
            </>
          )}
          {section === "configuration" && <ConfigurationSection vaultPath={vaultPath} />}
          {section === "ideal-state" && <IdealStateSection vaultPath={vaultPath} />}
          {section === "memory" && <MemoryContextSection vaultPath={vaultPath} />}
          {section === "intents" && <IntentsSection vaultPath={vaultPath} />}
          {section === "tasks" && <TasksCrossDomainSection vaultPath={vaultPath} />}
          {section === "daemons" && <DaemonsSection vaultPath={vaultPath} />}
          {section === "council" && <CouncilSettingsSection clis={clis} />}
          {section === "connectors" && (
            <>
              <ConnectorsSection vaultPath={vaultPath} focusAppId={settingsDeepLink ?? undefined} />
              <div className="mt-8 border-t border-border-subtle pt-8">
                <IngestionSection />
              </div>
            </>
          )}
          {section === "safety" && <SafetySection vaultPath={vaultPath} />}
          {section === "gateway" && <GatewaySection />}
          {section === "mcp" && <McpSection vaultPath={vaultPath} />}
          {section === "remote" && <RemoteSection />}
          {section === "vault" && <VaultSettings vaultPath={vaultPath} onChange={onChangeVault} onSetupDomains={onSetupDomains} onVaultMoved={onVaultMoved} />}
          {section === "demo" && <DemoModeSection vaultPath={vaultPath} onVaultMoved={onVaultMoved} onSetupDomains={onSetupDomains} />}
          {section === "appearance" && <AppearanceSection appearance={appearance} />}
          {section === "frameworks" && <FrameworksSection />}
          {section === "skills" && <SkillsSection vaultPath={vaultPath} />}
          {section === "shortcuts" && <ShortcutsSection />}
          {section === "about" && <AboutSection vaultPath={vaultPath} />}
        </div>
      </div>
    </div>
  );
}

// Unified "Models" section — the single home for everything model-related. It
// absorbed the old Agents + Providers pages AND the separate Defaults page:
// each provider expands to its models where you can TEST a model and SET IT AS
// THE DEFAULT, all in one place. No reason to set the default anywhere else.






































































