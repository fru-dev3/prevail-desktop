import React, { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke, listen, isBrowser, type UnlistenFn } from "./bridge";
import { open, save, save as saveFileDialog, confirm as tauriConfirm } from "@tauri-apps/plugin-dialog";
import { enable as autostartEnable, disable as autostartDisable, isEnabled as autostartIsEnabled } from "@tauri-apps/plugin-autostart";
import { check as checkUpdate } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { motion, useMotionValue, useSpring, useReducedMotion } from "framer-motion";
import { PrevailLogo } from "./PrevailLogo";
import { Markdown, StreamingPlain } from "./Markdown";
import { scoreColor, formatFreshness, titleCase, relTime } from "./format";
import { Toggle, Sparkline, ThinkingDisclosure } from "./ui";
import type { AppRunHistory, BackupResult, BenchBatch, BenchJob, BenchJobStatus, BenchQuestion, BenchmarkRun, Brand, BrandLogo, CatalogApp, ChatEvent, ChatMessage, CliInfo, Connector, ConnectorCatalog, ContextScore, DaemonStatus, DiagCheck, DirectProvider, Domain, DomainContextBundle, DomainManifest, DomainTab, DomainToggle, EngineApp, IngestionArtifact, IngestionMcpServer, IngestionTierStatus, LifeReadiness, MatrixRow, Mode, ModelPick, ModelVerifyStatus, Palette, PanelistReply, PanelistSlot, RunDetail, SkillEntry, TabId, TgBridgeStatus, ThreadMeta, ThreadTurn } from "./types";
import { appScheduleText, bytesHuman, domainBlurb, domainColor, isLocalCli, looksLikeJudgmentCall, preferredLocalCli, splitThinking, stripAnsi, vendorAccent } from "./helpers";
import { AUTONOMY_LABEL, AUTONOMY_TINT, DISCOVERED_MODELS, DOMAIN_LABEL, FRAMEWORKS, INTEGRATION_LABEL, LENSES, MODELS, MODEL_SEP, PALETTES, PATTERN_LABEL, PATTERN_TIER, SETTINGS_ROW, SOURCE_ABBR, STATUS_TINT, VENDOR_BRAND } from "./constants";
import { BUNKER_LS, LS, PREF, getDomainToggle, getPref, hydrateUiPrefs, isBunkerOn, lsGet, lsSet, setDomainToggle, setPref } from "./storage";
import { AppCard, AppKV, BridgeStatusChips, CycleChip, DemoRibbon, FloatingChip, ResizeHandle } from "./widgets";
import { ContextScorePanel, DomainAppsTab, IngestionTierCard, OnboardingModal, PaletteCard } from "./panels3";
import { DOMAIN_ICONS, domainIcon } from "./icons";
import { compareSemver, extractCliError, renderSkillTokens } from "./textutil";
import { distillCfgFromPrefs, skillgenCfgFromPrefs, taskgenCfgFromPrefs } from "./daemoncfg";
import { COUNCIL_CHAIR_KEY, COUNCIL_MEMBERS_KEY, councilModelsFor, councilSlotKey, readCouncilChair, readCouncilMembers } from "./council";
import { autoVerifyClis, cliVerifyLive, loadVerifyMap, saveVerifyMap, setCliVerify, useCliVerifyLive, verifyCliDefaultModel } from "./verify";
import { BENCH_CLI_OPTIONS, BENCH_FREQ_MS, BENCH_SCHED, benchBatches, benchNotify, cancelBenchBatch, executeBenchBatch, rerunLatestBatch, startBenchScheduler, useBenchBatches } from "./bench";
import { BACKUP_CFG, backupVaultNow, bumpBackupChangeCount, startBackupScheduler } from "./backup";
import { buildChatContext, buildCouncilQuickActions, buildIdealStatePreamble, buildQuickActions, buildSynthesisPrompt, loadPreferredSkills, maybeRedact, maybeStripSycophancy, migrateModelPrefs, modelLabel, modelsFor, parseRunLabel, savePreferredSkills } from "./helpers2";
import { IngestionBrowserRunner, InsightsPanel, PreambleColumn, UsageDashboard } from "./panels2";
import { AlignmentCard, AppHeaderBar, AppLockCard, AppLogo, BenchCrumbs, ConnectorIcon, ContextScoreBadge, DaemonCard, DirectProviderMark, DomainActionsMenu, DomainAppsStrip, DrawerImportsSection, Field, GatewayMark, GroupLabel, HeadlessLearnCard, IngestionAuditPanel, LockScreen, NewSkillForm, PatternChip, PreamblePicker, QuickSwitcher, ScoreBar, SettingRow, SettingsRowLite, SidebarGatewayLive, SidebarMcpLive, SkillsList, SubsectionHeader, SurfacePanel, TasksPanel, ThreadsRail, WebLogin, WhatsAppCard } from "./panels";

// Single source of truth for the version chip in title bar.
// Injected by Vite from package.json — never hand-stamp this again.
declare const __APP_VERSION__: string;
const APP_VERSION = __APP_VERSION__;

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

/** Best-effort live discovery for the given providers; fills DISCOVERED_MODELS
 *  and notifies listeners. Never throws. Returns the count discovered. */
async function refreshDiscoveredModels(providers: string[]): Promise<number> {
  let total = 0;
  await Promise.all(
    providers.map(async (id) => {
      try {
        const r = await invoke<{ models: ModelPick[] }>("engine_discover_models", { provider: id });
        if (r?.models?.length) { DISCOVERED_MODELS[id] = r.models; total += r.models.length; }
      } catch { /* best-effort; falls back to curated */ }
    }),
  );
  window.dispatchEvent(new Event("prevail:models-refreshed"));
  return total;
}

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
  Award,
  BookOpen,
  Brain,
  Briefcase,
  Check,
  ChevronDown,
  ChevronRight,
  Compass,
  Crown,
  Download,
  Upload,
  RotateCw,
  Eye,
  FileText,

  Folder,
  GraduationCap,
  Heart,
  Home,
  Github,
  Loader2,
  MessageSquare,
  Monitor,
  Moon,
  Network,
  Paperclip,
  PenLine,
  Pin,
  Plus,
  Receipt,
  RotateCcw,
  Scale,
  Send,
  Settings as SettingsIcon,
  Shield,
  Sparkles,
  Sun,
  Mail,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Target,
  SlidersHorizontal,
  ShieldOff,
  CloudOff,
  Wifi,
  WifiOff,
  Globe,
  Search,
  Server,
  TrendingUp,
  Users,
  Wallet,
  Wrench,
  X,
  AlertTriangle,
  Circle,
  Trash2,
  Activity,
  Coins,
  Cpu,
  Layers,
  Landmark,
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


// ─────────────────────────────────────────────────────────────────────
// Provider brand marks. Real SVG glyphs from simple-icons (MIT) for
// Anthropic/Claude and Ollama. OpenAI's mark isn't in simple-icons due
// to trademark policy, so we render a faithful version. Antigravity is
// Google's CLI, so we render the multicolor "G" wordmark.

import {
  siClaude as siClaudeRaw,
  siOllama as siOllamaRaw,
  siGmail, siGooglecalendar, siGoogledrive, siGooglesheets, siDropbox, siNotion,
  siDiscord, siGithub, siGitlab, siLinear, siStripe, siShopify, siCoinbase,
  siTelegram, siWhatsapp, siReddit, siYoutube, siSpotify, siZoom, siAirtable,
  siSignal, siMatrix, siMattermost,
  siTrello, siAsana, siTodoist, siHubspot, siQuickbooks, siCalendly, siObsidian,
  siWise, siRobinhood, siStrava, siFitbit,
  // Model-provider brand marks (Settings → Models, direct-provider roadmap).
  siAnthropic, siGooglegemini, siHuggingface, siX as siXRaw, siDeepseek, siQwen, siMinimax, siMeta, siMistralai,
} from "simple-icons";

const siClaude = siClaudeRaw as { path: string };
const siOllama = siOllamaRaw as { path: string };

// A simple-icons brand mark (real SVG path + brand hex).

// `hex` = icon-tile background (true brand color). `accent` = a
// display-safe variant used for text/borders that must stay legible on
// both light and dark surfaces (white/black brand marks would vanish).

// Brand accent for a vendor, safe for text/border use. Returns the hex
// plus a low-alpha tint suitable for a subtle bubble background.

function ProviderMark({ vendor, size = 28 }: { vendor: string; size?: number }) {
  const v = VENDOR_BRAND[vendor] ?? VENDOR_BRAND.other;
  const glyphSize = Math.round(size * 0.62);
  let inner: React.ReactNode;
  let bg = v.hex;
  switch (vendor) {
    case "claude":
      inner = (
        <svg viewBox="0 0 24 24" width={glyphSize} height={glyphSize} fill="white" aria-hidden="true">
          <path d={siClaude.path} />
        </svg>
      );
      break;
    case "codex":
      inner = (
        <svg viewBox="0 0 24 24" width={glyphSize} height={glyphSize} fill="white" aria-hidden="true">
          <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973l-.001.142v5.518a.79.79 0 0 0 .388.677l5.815 3.354-2.02 1.168a.075.075 0 0 1-.071 0l-4.83-2.788a4.504 4.504 0 0 1-1.647-6.098zm16.597 3.855L13.116 8.38 15.131 7.22a.071.071 0 0 1 .07 0l4.83 2.792a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.394-.674zm2.01-3.023l-.142-.085-4.774-2.781a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.659 4.139l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/>
        </svg>
      );
      break;
    case "antigravity":
      // White tile with the four-color Google G so the brand stays
      // true on any background.
      bg = "#ffffff";
      inner = (
        <svg viewBox="0 0 48 48" width={glyphSize} height={glyphSize} aria-hidden="true">
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8a12 12 0 1 1 0-24 11.9 11.9 0 0 1 8.5 3.3l5.7-5.7A20 20 0 1 0 24 44a20 20 0 0 0 19.6-23.5z"/>
          <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8A12 12 0 0 1 24 12a11.9 11.9 0 0 1 8.5 3.3l5.7-5.7A20 20 0 0 0 6.3 14.7z"/>
          <path fill="#4CAF50" d="M24 44a20 20 0 0 0 13.5-5.2l-6.2-5.3a11.9 11.9 0 0 1-7.3 2.5 12 12 0 0 1-11.3-8L6.1 33A20 20 0 0 0 24 44z"/>
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3a12.1 12.1 0 0 1-4.1 5.5l6.2 5.3c.4-.4 6.6-4.8 6.6-14.8 0-1.3-.1-2.4-.4-3.5z"/>
        </svg>
      );
      break;
    case "ollama":
      inner = (
        <svg viewBox="0 0 24 24" width={glyphSize} height={glyphSize} fill="white" aria-hidden="true">
          <path d={siOllama.path} />
        </svg>
      );
      break;
    case "lmstudio":
      // No official simple-icons glyph; use a clean monogram on the brand tile.
      inner = <span className="font-mono font-semibold text-white" style={{ fontSize: Math.round(size * 0.34) }}>LM</span>;
      break;
    case "mlx":
      inner = <span className="font-mono font-semibold text-white" style={{ fontSize: Math.round(size * 0.3) }}>MLX</span>;
      break;
    default:
      inner = <span className="font-mono text-white">·</span>;
  }
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-md ring-1 ring-black/5"
      style={{ background: bg, height: size, width: size }}
      title={v.name}
    >
      {inner}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Types matching the Rust commands in src-tauri/src/lib.rs

// Thread types — match Rust ThreadMeta / ThreadTurn / ThreadFull.


// ── Context Score (mirrors engine.rs ContextScore / ContextScore.json) ──

// ── Onboarding (mirrors engine.rs / OnboardingRecommendation.json) ──

// ── Domain manifest config (subset mirrors DomainManifest.json config) ──
// Only the fields the desktop reads/writes for per-domain prefs. Kept
// lenient so the engine can carry extra fields without breaking us.
// Per-domain privacy block (mirrors DomainManifest.json privacy).
// Per-domain sandbox block (mirrors DomainManifest.json sandbox).
// Per-domain routing block (mirrors DomainManifest.json routing).

// ── Backup (mirrors engine.rs / BackupResult.json) ──

// The ~6 onboarding questions. Free-form answers are bundled into a single
// JSON document ({ answers: { ... } }) sent to `engine_onboard_recommend`.


// The six dimensions, in display order, with friendly labels. Frozen to
// match the engine's ScoreBreakdown shape.

// Color thresholds: green >=75, amber 50-74, red <50. Returns a CSS color.






// ─────────────────────────────────────────────────────────────────────
// Frameworks + Lenses — kept in sync with the CLI's src/framework.ts
// and src/lens.ts. When the user picks one, the instruction gets
// prepended to every prompt as a bracketed preamble before the CLI
// is spawned.



// ─────────────────────────────────────────────────────────────────────
// Top-level tabs

// Top-level tabs. Council is NOT its own tab — it's a mode toggle
// inside Chat. Tools is NOT its own tab — it's a section inside
// Settings. Keeps the surface count low so each tab has a clear job.
// Which view the Chat surface shows for the active domain. Lifted to App so the
// top bar can own the Insights / Preferences toggles (and the domain header
// shrinks to just the title). "chat" = the conversation; the rest are domain
// sub-views rendered in place of the transcript.
const TABS: { id: TabId; label: string; icon: typeof MessageSquare }[] = [
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "council", label: "Council", icon: Scale },
  { id: "benchmark", label: "Benchmark", icon: Sparkles },
];

// ─────────────────────────────────────────────────────────────────────
// localStorage keys + helpers


// ── Bunker Mode (app-wide local-only trust mode) ──
// Providers that serve models from this machine only — mirror bunker.rs LOCAL_CLIS.
// Bunker Mode auto-switch target: the local provider to fall back to when a
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

function Brand({ className = "", fill = false }: { className?: string; fill?: boolean }) {
  if (fill) {
    // Clean wordmark spread edge-to-edge. We spell it out (no embedded mark)
    // so it reads instantly and the real wit — the "AI" hiding in prevAIl —
    // carries the brand. The chevron+star mark lives where it has room: the
    // app icon, the Council hero, the empty state.
    return (
      <span className={`flex w-full items-center justify-between ${className}`} aria-label="Prevail">
        <span>P</span>
        <span>R</span>
        <span>E</span>
        <span>V</span>
        <span className="text-ai">A</span>
        <span className="text-ai">I</span>
        <span>L</span>
      </span>
    );
  }
  return (
    <span className={className} style={{ letterSpacing: "inherit" }}>
      PREV<span className="text-ai">AI</span>L
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Theme = Mode (light / dark / system) + Palette (vault / midnight / ember / mono / cyberpunk / slate)
// Mode controls brightness; palette controls accent + surface styling.



function useAppearance() {
  const [mode, setMode] = useState<Mode>(() => {
    const saved = lsGet(LS.theme);
    if (saved === "light" || saved === "dark" || saved === "system") return saved;
    return "light";
  });
  const [palette, setPalette] = useState<Palette>(() => {
    const saved = lsGet(LS.palette) as Palette;
    return PALETTES.some((p) => p.id === saved) ? saved : "vault";
  });
  // Track system preference for "system" mode
  const [systemDark, setSystemDark] = useState<boolean>(() =>
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : false,
  );
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  // Cross-device hydrate: theme + palette are persisted on the desktop (see
  // ui_settings_get), so the WebUI — and a re-installed desktop — inherit the
  // same look instead of starting from an empty browser localStorage. Runs once
  // and overrides the local defaults if the backend has a saved value.
  const hydratedRef = useRef(false);
  useEffect(() => {
    (async () => {
      try {
        const raw = await invoke<string>("ui_settings_get");
        const s = JSON.parse(raw || "{}") as { theme?: string; palette?: string };
        if (s.theme === "light" || s.theme === "dark" || s.theme === "system") setMode(s.theme);
        if (s.palette && PALETTES.some((p) => p.id === s.palette)) setPalette(s.palette as Palette);
      } catch { /* offline / first run: keep localStorage values */ }
      hydratedRef.current = true;
    })();
  }, []);
  // Apply to <html>, cache locally, and write-through to the cross-device store.
  useEffect(() => {
    const effectiveDark = mode === "dark" || (mode === "system" && systemDark);
    document.documentElement.setAttribute("data-theme", effectiveDark ? "dark" : "light");
    document.documentElement.setAttribute("data-palette", palette);
    lsSet(LS.theme, mode);
    lsSet(LS.palette, palette);
    // Only persist after the initial hydrate so we never clobber saved settings
    // with the boot defaults before they've loaded.
    if (hydratedRef.current) {
      void invoke("ui_settings_set", { json: JSON.stringify({ theme: mode, palette }) }).catch(() => {});
    }
  }, [mode, palette, systemDark]);
  return { mode, setMode, palette, setPalette };
}

// ─────────────────────────────────────────────────────────────────────
// Active framework + lens (shared between Chat and Council)

function useFrameworkLens() {
  const [framework, setFramework] = useState<string>(() => lsGet(LS.framework, "none"));
  const [lens, setLens] = useState<string>(() => lsGet(LS.lens, "none"));
  useEffect(() => { lsSet(LS.framework, framework); }, [framework]);
  useEffect(() => { lsSet(LS.lens, lens); }, [lens]);

  function buildPrompt(raw: string): string {
    const fw = FRAMEWORKS.find((f) => f.id === framework);
    const ln = LENSES.find((l) => l.id === lens);
    const parts: string[] = [];
    if (fw?.instruction) parts.push(`[FRAMEWORK]\n${fw.instruction}`);
    if (ln?.instruction) parts.push(`[LENS]\n${ln.instruction}`);
    parts.push(raw);
    return parts.join("\n\n");
  }

  return { framework, setFramework, lens, setLens, buildPrompt };
}

// ─────────────────────────────────────────────────────────────────────
// Onboarding flow — shown when the vault has zero domains (or via the
// "Set up domains" button). Three steps:
//   1. answer ~6 questions  → engine_onboard_recommend (answers on stdin)
//   2. pick from a checkbox list of recommended domains
//   3. engine_onboard_apply (picks on stdin) → caller refreshes scan_vault

// ─────────────────────────────────────────────────────────────────────
// App root — vault picker, sidebar, tabs

// Deterministic per-domain accent color — turns the monochrome card grid
// into a colorful, scannable board. Muted, on-brand palette.
// Browser login screen for the WebUI. Authenticates against the bridge
// server's /api/login, stores the token, then lets the real app mount.
// Desktop passcode gate. For a plaintext vault with an app lock (Phase 0) it
// verifies against the Argon2id verifier. For an ENCRYPTED vault (Phase 1) it
// unlocks the keyring, which holds the DEK in the engine process so the vault
// becomes readable. Same screen, right mechanism.


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
function SidebarBenchmarkRuns({ collapsed }: { collapsed: boolean }) {
  const runningBatches = useBenchBatches().filter((b) => b.running);
  if (runningBatches.length === 0) return null;
  if (collapsed) {
    return (
      <div
        className="flex items-center justify-center gap-1 border-t border-border-subtle px-2 py-2"
        title={runningBatches.map((b) => `Benchmarking ${b.scopeLabel}`).join("\n")}
      >
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
        </span>
        {runningBatches.length > 1 && (
          <span className="font-mono text-[10px] text-accent">{runningBatches.length}</span>
        )}
      </div>
    );
  }
  return (
    <div className="border-t border-border-subtle">
      {runningBatches.map((b) => {
        const done = b.jobs.reduce(
          (a, j) => a + (j.status === "done" || j.status === "scoring" ? j.total : j.done),
          0,
        );
        const total = b.jobs.reduce((a, j) => a + j.total, 0);
        return (
          <div key={b.id} className="px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="relative flex h-1.5 w-1.5 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
              </span>
              <span
                className="flex-1 truncate font-mono text-[10px] uppercase tracking-wide text-accent"
                title={b.label}
              >
                {b.scopeLabel}
              </span>
              <span className="font-mono text-[10px] text-text-muted">{done}/{total}</span>
              <button
                onClick={() => void cancelBenchBatch(b.id)}
                title="Cancel this benchmark run"
                className="shrink-0 rounded px-1 font-mono text-[10px] text-text-muted hover:bg-surface-strong hover:text-danger"
              >
                ✗
              </button>
            </div>
            <div className="mt-1.5 h-0.5 w-full overflow-hidden rounded-full bg-surface-strong">
              <div
                className="h-full rounded-full bg-accent transition-all duration-500"
                style={{ width: total > 0 ? `${Math.round((done / total) * 100)}%` : "0%" }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Sidebar({
  collapsed,
  setCollapsed,
  vaultPath,
  domains,
  vaultError,
  selectedDomain,
  setSelectedDomain,
  activeAppId,
  openInFinder,
  tab,
  setTab,
  onDomainCreated,
  appearance,
  runningDomains,
  finishedDomains,
  domainStats,
  railWidth,
  onOpenOnboarding,
  onDomainsChanged,
  onOpenApp,
}: {
  collapsed: boolean;
  setCollapsed: (v: boolean | ((cur: boolean) => boolean)) => void;
  vaultPath: string;
  domains: Domain[];
  vaultError: string | null;
  selectedDomain: string | null;
  setSelectedDomain: (n: string) => void;
  activeAppId: string | null;
  openInFinder: (p: string | null) => void;
  tab: TabId;
  setTab: (t: TabId) => void;
  onDomainCreated: (d: Domain) => void;
  appearance: ReturnType<typeof useAppearance>;
  runningDomains: Set<string>;
  finishedDomains: Set<string>;
  domainStats: Record<string, number>;
  railWidth: number;
  onOpenOnboarding: () => void;
  onDomainsChanged: () => void;
  onOpenApp: (app: EngineApp) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  // Pinned domains live in localStorage as a comma-separated slug list.
  const PIN_KEY = "prevail.desktop.pinnedDomains";
  const [pinned, setPinned] = useState<Set<string>>(() => {
    try {
      const raw = lsGet(PIN_KEY);
      return new Set(raw ? raw.split(",").filter(Boolean) : []);
    } catch { return new Set(); }
  });
  // Group collapse — Pinned vs All. Persisted so collapsing survives
  // app restarts.
  const [pinnedOpen, setPinnedOpen] = useState<boolean>(() => lsGet("prevail.sidebar.pinnedOpen") !== "0");
  const [allOpen, setAllOpen] = useState<boolean>(() => lsGet("prevail.sidebar.allOpen") !== "0");
  useEffect(() => { lsSet("prevail.sidebar.pinnedOpen", pinnedOpen ? "1" : "0"); }, [pinnedOpen]);
  useEffect(() => { lsSet("prevail.sidebar.allOpen", allOpen ? "1" : "0"); }, [allOpen]);
  const togglePin = (name: string) => {
    setPinned((cur) => {
      const next = new Set(cur);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      lsSet(PIN_KEY, Array.from(next).join(","));
      return next;
    });
  };
  const railFilter = ""; // domain filter input removed from the sidebar
  // App-wide aggregate score (mean of every domain's context score) — the
  // single "how ready is my whole life-OS" number, pinned bottom-left.
  const [lifeScore, setLifeScore] = useState<{ value: number; count: number } | null>(null);
  useEffect(() => {
    let on = true;
    invoke<LifeReadiness>("engine_score_all", { vault: vaultPath })
      .then((lr) => {
        if (on && lr && lr.life_readiness !== null) {
          setLifeScore({ value: lr.life_readiness, count: lr.domains.length });
        }
      })
      .catch(() => {});
    return () => { on = false; };
  }, [vaultPath, domains.length]);
  const sortedDomains = useMemo(() => {
    const q = railFilter.trim().toLowerCase();
    const isPinned = (d: Domain) => pinned.has(d.name);
    const matches = (d: Domain) =>
      !q ||
      d.name.toLowerCase().includes(q) ||
      titleCase(d.name).toLowerCase().includes(q);
    const filtered = domains.filter(matches);
    const pin = filtered.filter(isPinned);
    const rest = filtered.filter((d) => !isPinned(d));
    return [...pin, ...rest];
  }, [domains, pinned, railFilter]);
  const [addError, setAddError] = useState<string | null>(null);

  async function createDomain() {
    setAddError(null);
    try {
      const d = await invoke<Domain>("create_domain", { vault: vaultPath, name: newName });
      onDomainCreated(d);
      setNewName("");
      setAdding(false);
    } catch (e) {
      setAddError(String(e));
    }
  }

  // Domains top-level collapse.
  const [domainsOpen, setDomainsOpen] = useState<boolean>(() => lsGet("prevail.sidebar.domainsOpen") !== "0");
  useEffect(() => { lsSet("prevail.sidebar.domainsOpen", domainsOpen ? "1" : "0"); }, [domainsOpen]);

  // Archived domains — fetched from the engine. Shown in a collapsible
  // group at the bottom of the rail, each with a Restore action.
  const [archived, setArchived] = useState<string[]>([]);
  const [archivedOpen, setArchivedOpen] = useState<boolean>(() => lsGet("prevail.sidebar.archivedOpen") === "1");
  useEffect(() => { lsSet("prevail.sidebar.archivedOpen", archivedOpen ? "1" : "0"); }, [archivedOpen]);
  const [restoring, setRestoring] = useState<string | null>(null);
  const refreshArchived = useCallback(async () => {
    if (!vaultPath) return;
    try {
      const list = await invoke<string[]>("engine_list_archived", { vault: vaultPath });
      setArchived(list);
    } catch {
      // Engine may not support archiving yet — keep the group hidden.
      setArchived([]);
    }
  }, [vaultPath]);
  // Refresh when the active domain set changes (e.g. after archive/restore).
  useEffect(() => { void refreshArchived(); }, [refreshArchived, domains.length]);

  // Apps section — peer to Domains in the sidebar.
  const APP_PIN_KEY = "prevail.sidebar.pinnedApps";
  const [sidebarApps, setSidebarApps] = useState<EngineApp[]>([]);
  const [appsOpen, setAppsOpen] = useState<boolean>(() => lsGet("prevail.sidebar.appsOpen") !== "0");
  // Favorites expand by default; the full list stays collapsed so a long
  // catalog never floods the rail — mirrors Domains' Pinned/All split.
  const [appsFavOpen, setAppsFavOpen] = useState<boolean>(() => lsGet("prevail.sidebar.appsFavOpen") !== "0");
  const [appsAllOpen, setAppsAllOpen] = useState<boolean>(() => lsGet("prevail.sidebar.appsAllOpen") === "1");
  const [pinnedApps, setPinnedApps] = useState<Set<string>>(() => {
    try { const r = lsGet(APP_PIN_KEY); return new Set(r ? r.split(",").filter(Boolean) : []); } catch { return new Set(); }
  });
  useEffect(() => { lsSet("prevail.sidebar.appsOpen", appsOpen ? "1" : "0"); }, [appsOpen]);
  useEffect(() => { lsSet("prevail.sidebar.appsFavOpen", appsFavOpen ? "1" : "0"); }, [appsFavOpen]);
  useEffect(() => { lsSet("prevail.sidebar.appsAllOpen", appsAllOpen ? "1" : "0"); }, [appsAllOpen]);
  useEffect(() => {
    let alive = true;
    const pull = () => { invoke<EngineApp[]>("engine_apps_list").then((a) => { if (alive) setSidebarApps(a ?? []); }).catch(() => {}); };
    pull();
    // Re-pull when an app is added/removed elsewhere (e.g. the Apps catalog).
    const onChanged = () => pull();
    window.addEventListener("prevail:apps-changed", onChanged);
    return () => { alive = false; window.removeEventListener("prevail:apps-changed", onChanged); };
  }, [vaultPath]);
  function toggleAppPin(id: string) {
    setPinnedApps((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      lsSet(APP_PIN_KEY, Array.from(next).join(","));
      return next;
    });
  }
  const pinnedSidebarApps = useMemo(
    () => sidebarApps.filter((a) => pinnedApps.has(a.id)).sort((a, b) => a.title.localeCompare(b.title)),
    [sidebarApps, pinnedApps],
  );
  const restSidebarApps = useMemo(
    () => sidebarApps.filter((a) => !pinnedApps.has(a.id)).sort((a, b) => a.title.localeCompare(b.title)),
    [sidebarApps, pinnedApps],
  );
  // One app row, reused by the Favorites and All groups. Highlights when it's
  // the app currently open in the canvas so "which app am I in" is obvious.
  const renderAppRow = (app: EngineApp) => {
    const tint = STATUS_TINT[app.status] ?? "#9aa0a6";
    const isPinned = pinnedApps.has(app.id);
    const active = activeAppId === app.id;
    return (
      <li key={app.id} className="group flex items-center gap-1 pl-6">
        <button
          onClick={() => onOpenApp(app)}
          className={`flex flex-1 cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
            active
              ? "bg-surface-strong font-medium text-text-primary"
              : "text-text-secondary hover:bg-surface-warm hover:text-text-primary"
          }`}
          title={`Open ${app.title}${app.domains.length ? " · refreshes " + app.domains.map(titleCase).join(", ") : ""}`}
        >
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={active ? { backgroundColor: tint, boxShadow: `0 0 0 3px color-mix(in srgb, ${tint} 28%, transparent)` } : { backgroundColor: tint }}
          />
          <span className="flex-1 truncate text-sm">{app.title}</span>
        </button>
        <button
          onClick={() => toggleAppPin(app.id)}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded text-text-muted hover:bg-surface-warm hover:text-accent ${isPinned || active ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
          title={isPinned ? "Unpin" : "Pin to favorites"}
        >
          <Pin className={`h-3 w-3 ${isPinned ? "fill-accent text-accent" : ""}`} />
        </button>
        {app.path && (
          <button
            onClick={() => openInFinder(app.path ?? null)}
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded text-text-muted hover:bg-surface-warm hover:text-accent ${active ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
            title={`Open ${app.title} folder in Finder`}
          >
            <Folder className="h-3.5 w-3.5" />
          </button>
        )}
      </li>
    );
  };

  async function restoreDomain(name: string) {
    setRestoring(name);
    try {
      await invoke("engine_vault_restore", { vault: vaultPath, domain: name });
      await refreshArchived();
      onDomainsChanged();
    } catch (e) {
      console.error("restore domain", e);
    } finally {
      setRestoring(null);
    }
  }

  return (
    <aside
      className="flex shrink-0 flex-col border-r border-border-subtle bg-surface-strong"
      style={{ width: collapsed ? 56 : railWidth }}
    >
      {/* The Prevail mark on its own row, full width, with the sidebar toggle on
          the far right. The macOS traffic lights are handled by the full-width
          title bar above this whole layout, so the sidebar starts clean here. */}
      <div
        data-tauri-drag-region
        className={`flex shrink-0 items-center gap-2 px-3 py-2.5 ${
          collapsed ? "border-b border-border-subtle" : "border-b border-black/20 bg-[#141416]"
        }`}
      >
        {collapsed ? (
          <div className="mx-auto flex flex-col items-center gap-2">
            <PrevailLogo size={30} src="/logo-512.png" animated={false} />
            <button
              onClick={() => setCollapsed(false)}
              title="Expand sidebar"
              className="flex h-7 w-7 items-center justify-center rounded-md bg-text-primary text-background shadow-sm transition-opacity hover:opacity-80"
            >
              <PanelLeftOpen className="h-[18px] w-[18px]" strokeWidth={1.75} />
            </button>
          </div>
        ) : (
          <>
            <Brand fill className="min-w-0 flex-1 font-display text-2xl font-bold text-white [text-shadow:0_2px_6px_rgba(0,0,0,0.5)]" />
            <button
              onClick={() => setCollapsed(true)}
              title="Collapse sidebar"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/12 text-white transition-colors hover:bg-white/25"
            >
              <PanelLeftClose className="h-[18px] w-[18px]" strokeWidth={1.75} />
            </button>
          </>
        )}
      </div>

      {/* Domain list (icon rail when collapsed, full list when expanded) */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {/* General — the home for chats not tied to any domain. Selecting it
            unbinds the chat from domain context; its threads live in the vault
            root _threads/. New threads are created via the threads rail's +. */}
        <div className={collapsed ? "flex justify-center p-2" : "px-2 pt-2"}>
          <button
            onClick={() => {
              setSelectedDomain("");
              if (tab === "settings") setTab("chat");
            }}
            title="General: chats not tied to any domain"
            className={
              collapsed
                ? `flex h-10 w-10 items-center justify-center rounded-md transition-colors ${
                    selectedDomain === "" && tab !== "settings"
                      ? "bg-accent-soft text-accent"
                      : "text-text-muted hover:bg-surface-warm hover:text-text-primary"
                  }`
                : `flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
                    selectedDomain === "" && tab !== "settings"
                      ? "bg-accent-soft text-accent"
                      : "text-text-secondary hover:bg-surface-warm hover:text-text-primary"
                  }`
            }
          >
            <MessagesSquare className="h-4 w-4" />
            {!collapsed && "General"}
          </button>
        </div>
        {!collapsed && (
          <button
            onClick={() => setDomainsOpen((v) => !v)}
            className="group/h mt-2 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted hover:text-text-secondary transition-colors"
          >
            <ChevronRight className={`h-3 w-3 shrink-0 transition-transform ${domainsOpen ? "rotate-90" : ""}`} strokeWidth={2.5} />
            <Layers className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
            <span>Domains</span>
            <span className="ml-auto font-mono text-[10px] tabular-nums text-text-muted/70">{domains.length}</span>
          </button>
        )}
        {vaultError && !collapsed && domainsOpen && (
          <div className="mx-2 my-2 rounded border border-warn/40 bg-warn/10 p-2 text-xs text-warn">{vaultError}</div>
        )}
        {domains.length === 0 && !vaultError && !collapsed && domainsOpen && (
          <div className="px-3 py-3">
            <div className="mb-2 text-xs text-text-muted">
              no domains yet. let Prevail recommend a starter set, or create one manually below.
            </div>
            <button
              onClick={onOpenOnboarding}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-background transition-opacity hover:opacity-90"
            >
              <Sparkles className="h-4 w-4" />
              Set up domains
            </button>
          </div>
        )}
        {/* "Set up domains" moved to Settings → Vault to declutter the sidebar. */}
        <ul className={`space-y-0.5 ${collapsed ? "px-1.5 py-2" : "px-2"}`}>
          {sortedDomains.map((d, i) => {
            const active = d.name === selectedDomain && tab !== "settings";
            const Icon = domainIcon(d.name);
            const isPinned = pinned.has(d.name);
            const isFirstPinned = !collapsed && isPinned && (i === 0 || !pinned.has(sortedDomains[i - 1].name));
            const isFirstAll = !collapsed && !isPinned && (i === 0 || pinned.has(sortedDomains[i - 1].name));
            // Hide entries when their group is collapsed.
            if (!collapsed && !domainsOpen) return null;
            if (!collapsed && isPinned && !pinnedOpen && !isFirstPinned) return null;
            if (!collapsed && !isPinned && !allOpen && !isFirstAll) return null;
            const renderGroupHeader = (label: "Pinned" | "All", open: boolean, set: (v: boolean) => void, count: number) => (
              <li key={`${label}-header`} className="mt-1 first:mt-0">
                <button
                  onClick={() => set(!open)}
                  title={`${open ? "Collapse" : "Expand"} ${label}`}
                  className="group/h flex w-full items-center gap-1.5 rounded-md py-1.5 pl-4 pr-2 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted transition-colors hover:text-text-secondary"
                >
                  <ChevronRight className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} strokeWidth={2.5} />
                  <span>{label}</span>
                  <span className="ml-auto font-mono text-[10px] tabular-nums text-text-muted/70">{count}</span>
                </button>
              </li>
            );
            // Render a thin "Pinned / All" divider when transitioning.
            const showDivider = false;
            void showDivider;
            if (collapsed) {
              return (
                <li key={d.name}>
                  <button
                    onClick={() => {
                      setSelectedDomain(d.name);
                      if (tab === "settings") setTab("chat");
                    }}
                    title={titleCase(d.name)}
                    className={`flex h-10 w-10 items-center justify-center rounded-md transition-colors ${
                      active
                        ? "bg-accent-soft text-accent"
                        : "text-text-muted hover:bg-surface-warm hover:text-text-primary"
                    }`}
                  >
                    {Icon ? <Icon className="h-4 w-4" /> : (
                      <span className="font-mono text-xs font-semibold">
                        {titleCase(d.name).charAt(0)}
                      </span>
                    )}
                  </button>
                </li>
              );
            }
            return (
              <Fragment key={d.name}>
                {isFirstPinned && renderGroupHeader("Pinned", pinnedOpen, setPinnedOpen, pinned.size)}
                {isFirstAll && renderGroupHeader("All", allOpen, setAllOpen, sortedDomains.length - pinned.size)}
                {((isPinned && pinnedOpen) || (!isPinned && allOpen)) && (
              <li
                className="group flex items-center gap-1 pl-6"
              >
                <button
                  onMouseDown={(e) => {
                    // Manual drag — WebKit's HTML5 DnD in WKWebView
                    // doesn't reliably fire dragstart. Track mouse
                    // movement; on mouseup, hit-test the chat composer
                    // / messages area and call its global attach hook.
                    if (e.button !== 0) return;
                    const startX = e.clientX;
                    const startY = e.clientY;
                    let dragging = false;
                    let pill: HTMLDivElement | null = null;
                    const onMove = (ev: MouseEvent) => {
                      const dx = ev.clientX - startX;
                      const dy = ev.clientY - startY;
                      if (!dragging && Math.hypot(dx, dy) < 6) return;
                      if (!dragging) {
                        dragging = true;
                        pill = document.createElement("div");
                        pill.textContent = `◆ ${titleCase(d.name)}`;
                        pill.style.cssText =
                          "position:fixed;z-index:9999;pointer-events:none;" +
                          "padding:6px 10px;border-radius:9999px;" +
                          "background:var(--color-accent,#0d7a6e);color:#fff;" +
                          "font-family:ui-monospace,monospace;font-size:11px;" +
                          "box-shadow:0 6px 20px rgba(0,0,0,0.2);" +
                          "transform:translate(-50%,-50%);";
                        document.body.appendChild(pill);
                        document.body.style.userSelect = "none";
                      }
                      if (pill) {
                        pill.style.left = ev.clientX + "px";
                        pill.style.top = ev.clientY + "px";
                      }
                    };
                    const onUp = (ev: MouseEvent) => {
                      window.removeEventListener("mousemove", onMove);
                      window.removeEventListener("mouseup", onUp);
                      document.body.style.userSelect = "";
                      if (pill) { pill.remove(); pill = null; }
                      if (!dragging) return; // treat as a click — let onClick fire
                      // Don't let onClick fire after a drag ended
                      ev.preventDefault();
                      ev.stopPropagation();
                      const hook = (window as unknown as { __prevailAttach?: (n: string, mode?: "light" | "full" | "folder") => void }).__prevailAttach;
                      if (hook) hook(d.name, ev.altKey ? "folder" : ev.shiftKey ? "full" : "light");
                      else console.warn("[prevail/drag] no attach hook registered: drop fell outside chat panel");
                    };
                    window.addEventListener("mousemove", onMove);
                    window.addEventListener("mouseup", onUp);
                  }}
                  onClick={() => {
                    setSelectedDomain(d.name);
                    if (tab === "settings") setTab("chat");
                  }}
                  title="Click to enter · drag to chat as context (plain: state · ⇧ full · ⌥ entire folder)"
                  className={`flex flex-1 cursor-grab items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors active:cursor-grabbing ${
                    active
                      ? "bg-surface-strong text-text-primary font-medium"
                      : "text-text-secondary hover:bg-surface-warm hover:text-text-primary"
                  }`}
                >
                  {Icon ? (
                    <Icon className={`h-4 w-4 ${active ? "text-accent" : "text-text-muted"}`} />
                  ) : (
                    <span className={active ? "text-accent" : "text-text-muted"}>◆</span>
                  )}
                  <span className="flex-1 truncate">{titleCase(d.name)}</span>
                  {(domainStats[d.name] ?? 0) > 0 && (
                    <span
                      className="shrink-0 rounded-full bg-surface-warm px-1.5 py-0 font-mono text-[9px] text-text-muted"
                      title={`${domainStats[d.name]} imports`}
                    >
                      {domainStats[d.name]}
                    </span>
                  )}
                  {runningDomains.has(d.name) ? (
                    <span className="pulse-soft inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-warn" title="A reply is streaming in this domain" />
                  ) : finishedDomains.has(d.name) ? (
                    <span
                      className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{
                        background: "var(--color-ok, #2e9e5b)",
                        boxShadow: "0 0 0 3px color-mix(in srgb, var(--color-ok, #2e9e5b) 28%, transparent)",
                      }}
                      title="Just finished: open to view"
                    />
                  ) : null}
                </button>
                <button
                  onClick={() => togglePin(d.name)}
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded text-text-muted hover:bg-surface-warm hover:text-accent ${
                    active ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                  }`}
                  title={isPinned ? "Unpin" : "Pin to top"}
                >
                  <Pin className={`h-3 w-3 ${isPinned ? "fill-accent text-accent" : ""}`} />
                </button>
                <button
                  onClick={() => openInFinder(d.path)}
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded text-text-muted hover:bg-surface-warm hover:text-accent ${
                    active ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                  }`}
                  title={`Open ${titleCase(d.name)} in Finder`}
                >
                  <Folder className="h-3.5 w-3.5" />
                </button>
              </li>
                )}
              </Fragment>
            );
          })}
        </ul>

        {/* Add domain */}
        {!collapsed && domainsOpen && (
          <div className="mt-2 px-2">
            {!adding && (
              <button
                onClick={() => setAdding(true)}
                className="flex w-full items-center gap-2 rounded-md border border-dashed border-border px-2.5 py-1.5 text-left text-xs text-text-muted hover:border-accent-border hover:bg-surface-warm hover:text-accent"
              >
                <Plus className="h-3.5 w-3.5" />
                new domain
              </button>
            )}
            {adding && (
              <div className="rounded-md border border-border bg-background p-2">
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") createDomain();
                    if (e.key === "Escape") { setAdding(false); setNewName(""); setAddError(null); }
                  }}
                  placeholder="e.g. travel"
                  className="w-full bg-transparent px-1 py-0.5 font-mono text-xs focus:outline-none"
                />
                {addError && <div className="mt-1 text-[10px] text-err">{addError}</div>}
                <div className="mt-1.5 flex gap-1">
                  <button
                    onClick={createDomain}
                    disabled={!newName.trim()}
                    className="rounded bg-accent px-2 py-0.5 font-mono text-[10px] text-background hover:bg-accent-hover disabled:bg-surface-strong disabled:text-text-muted"
                  >
                    create
                  </button>
                  <button
                    onClick={() => { setAdding(false); setNewName(""); setAddError(null); }}
                    className="rounded border border-border px-2 py-0.5 font-mono text-[10px] text-text-muted hover:bg-surface-warm"
                  >
                    cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        {collapsed && (
          <div className="mt-2 flex justify-center">
            <button
              onClick={() => setCollapsed(false)}
              title="New domain (expand sidebar first)"
              className="flex h-10 w-10 items-center justify-center rounded-md border border-dashed border-border text-text-muted hover:border-accent-border hover:bg-surface-warm hover:text-accent"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Apps — peer to Domains. Always shown so it stays first-class even
            with nothing connected yet. Favorites expand by default; the full
            list stays collapsed so a long catalog never floods the rail. */}
        {!collapsed && (
          <div className="mt-3 px-2">
            <button
              onClick={() => setAppsOpen((v) => !v)}
              className="group/h flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted transition-colors hover:text-text-secondary"
            >
              <ChevronRight className={`h-3 w-3 shrink-0 transition-transform ${appsOpen ? "rotate-90" : ""}`} strokeWidth={2.5} />
              <Plug className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              <span>Apps</span>
              <span className="ml-auto font-mono text-[10px] tabular-nums text-text-muted/70">{sidebarApps.length}</span>
            </button>
            {appsOpen && (sidebarApps.length > 0 ? (
              <ul className="mt-0.5 space-y-0.5">
                {/* Favorites — pinned apps, expanded by default. */}
                {pinnedSidebarApps.length > 0 && (
                  <>
                    <li className="mt-1 first:mt-0">
                      <button
                        onClick={() => setAppsFavOpen((v) => !v)}
                        title={`${appsFavOpen ? "Collapse" : "Expand"} Favorites`}
                        className="group/h flex w-full items-center gap-1.5 rounded-md py-1.5 pl-4 pr-2 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted transition-colors hover:text-text-secondary"
                      >
                        <ChevronRight className={`h-3 w-3 shrink-0 transition-transform ${appsFavOpen ? "rotate-90" : ""}`} strokeWidth={2.5} />
                        <span>Favorites</span>
                        <span className="ml-auto font-mono text-[10px] tabular-nums text-text-muted/70">{pinnedSidebarApps.length}</span>
                      </button>
                    </li>
                    {appsFavOpen && pinnedSidebarApps.map(renderAppRow)}
                  </>
                )}
                {/* All — every connected app, collapsed by default. */}
                {restSidebarApps.length > 0 && (
                  <>
                    <li className="mt-1 first:mt-0">
                      <button
                        onClick={() => setAppsAllOpen((v) => !v)}
                        title={`${appsAllOpen ? "Collapse" : "Expand"} All`}
                        className="group/h flex w-full items-center gap-1.5 rounded-md py-1.5 pl-4 pr-2 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted transition-colors hover:text-text-secondary"
                      >
                        <ChevronRight className={`h-3 w-3 shrink-0 transition-transform ${appsAllOpen ? "rotate-90" : ""}`} strokeWidth={2.5} />
                        <span>{pinnedSidebarApps.length > 0 ? "All" : "Connected"}</span>
                        <span className="ml-auto font-mono text-[10px] tabular-nums text-text-muted/70">{restSidebarApps.length}</span>
                      </button>
                    </li>
                    {appsAllOpen && restSidebarApps.map(renderAppRow)}
                  </>
                )}
                {/* Add another app. */}
                <li className="mt-0.5">
                  <button
                    onClick={() => window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "connectors" }))}
                    className="flex w-full items-center gap-2 rounded-md py-1.5 pl-6 pr-2 text-left text-xs text-text-muted transition-colors hover:bg-surface-warm hover:text-accent"
                    title="Browse and connect apps"
                  >
                    <Plus className="h-3.5 w-3.5 shrink-0" />
                    add an app
                  </button>
                </li>
              </ul>
            ) : (
              <button
                onClick={() => window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "connectors" }))}
                className="mt-0.5 flex w-full items-center gap-2 rounded-md py-1.5 pl-6 pr-2 text-left text-xs text-text-muted transition-colors hover:bg-surface-warm hover:text-accent"
                title="Browse and connect apps"
              >
                <Plus className="h-3.5 w-3.5 shrink-0" />
                add an app
              </button>
            ))}
          </div>
        )}

        {/* Archived domains — collapsible. Hidden from the active list;
            restore brings them back into the vault scan. */}
        {!collapsed && domainsOpen && archived.length > 0 && (
          <div className="mt-3 px-2">
            <button
              onClick={() => setArchivedOpen((v) => !v)}
              className="flex w-full items-center gap-1.5 rounded px-1 py-1 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:text-text-secondary"
            >
              {archivedOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              <Archive className="h-3 w-3" />
              Archived
              <span className="ml-auto rounded-full bg-surface-strong px-1.5 text-[9px] text-text-muted">{archived.length}</span>
            </button>
            {archivedOpen && (
              <ul className="mt-1 space-y-0.5">
                {archived.map((name) => (
                  <li
                    key={name}
                    className="group flex items-center gap-2 rounded-md px-2 py-1 text-text-muted"
                  >
                    <Archive className="h-3.5 w-3.5 shrink-0 opacity-60" />
                    <span className="min-w-0 flex-1 truncate text-xs">{titleCase(name)}</span>
                    <button
                      onClick={() => restoreDomain(name)}
                      disabled={restoring === name}
                      title={`Restore ${titleCase(name)}`}
                      className="flex shrink-0 items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted opacity-0 hover:border-accent-border hover:text-accent group-hover:opacity-100 disabled:opacity-100"
                    >
                      {restoring === name ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                      restore
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* App-wide readiness — the aggregate of every domain's score. */}
      {lifeScore && (
        <button
          onClick={() => setTab("settings")}
          title={`Life readiness: mean context score across ${lifeScore.count} domain${lifeScore.count === 1 ? "" : "s"}. Click for settings.`}
          className={`flex items-center border-t border-border-subtle transition-colors hover:bg-surface-warm ${
            collapsed ? "justify-center px-2 py-2" : "gap-2.5 px-3 py-2"
          }`}
        >
          <span className="relative inline-flex h-7 w-7 shrink-0 items-center justify-center">
            <svg viewBox="0 0 36 36" className="h-7 w-7 -rotate-90">
              <circle cx="18" cy="18" r="15" fill="none" stroke="var(--color-border, #2a2a2a)" strokeWidth="3" />
              <circle
                cx="18" cy="18" r="15" fill="none"
                stroke={scoreColor(lifeScore.value)} strokeWidth="3" strokeLinecap="round"
                strokeDasharray={`${(lifeScore.value / 100) * 94.2} 94.2`}
              />
            </svg>
            <span className="absolute font-mono text-[9px] font-semibold" style={{ color: scoreColor(lifeScore.value) }}>
              {lifeScore.value}
            </span>
          </span>
          {!collapsed && (
            <span className="flex min-w-0 flex-col items-start leading-tight">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-muted">Life readiness</span>
              <span className="text-xs text-text-secondary">{lifeScore.count} domain{lifeScore.count === 1 ? "" : "s"} scored</span>
            </span>
          )}
        </button>
      )}

      {/* External connectivity indicators */}
      <SidebarGatewayLive collapsed={collapsed} />
      <SidebarMcpLive collapsed={collapsed} setTab={setTab} />
      <SidebarBenchmarkRuns collapsed={collapsed} />

      {/* Settings + theme — pinned to bottom (Upgrade lives in Settings) */}
      <div className={`border-t border-border-subtle bg-surface-warm/30 ${collapsed ? "flex flex-col items-center gap-1 p-2" : "flex items-center gap-1 px-2 py-1.5"}`}>
        <button
          onClick={() => setTab("settings")}
          title="Settings"
          className={
            collapsed
              ? `flex h-8 w-8 items-center justify-center rounded transition-colors ${
                  tab === "settings"
                    ? "bg-accent-soft text-accent"
                    : "text-text-muted hover:text-text-primary"
                }`
              : `flex flex-1 items-center gap-2 rounded px-2 py-1.5 text-left transition-colors ${
                  tab === "settings"
                    ? "text-accent"
                    : "text-text-muted hover:text-text-secondary"
                }`
          }
        >
          <SettingsIcon className="h-3.5 w-3.5 shrink-0" />
          {!collapsed && <span className="font-mono text-[11px] tracking-wide uppercase">Settings</span>}
        </button>
        <button
          onClick={() => {
            const cycle: Mode[] = ["light", "dark", "system"];
            const i = cycle.indexOf(appearance.mode);
            appearance.setMode(cycle[(i + 1) % cycle.length]);
          }}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-text-muted hover:text-text-secondary transition-colors"
          title={`Theme: ${appearance.mode}: click to cycle`}
        >
          {appearance.mode === "dark" ? <Moon className="h-4 w-4" /> : appearance.mode === "system" ? <Monitor className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
        </button>
      </div>
      {!collapsed && (
        <div className="shrink-0 border-t border-border-subtle p-2.5">
          <div className="rounded-lg border border-border-subtle/70 bg-surface-warm/40 p-2.5">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-accent ring-1 ring-accent-border/40">
                <span className="text-[7px] leading-none">◆</span>Alpha
              </span>
              <span className="font-mono text-[10px] text-text-muted">experimental build</span>
            </div>
            <p className="mt-1.5 text-[10px] leading-snug text-text-muted">
              Provided as-is, no warranty: use at your own risk.
            </p>
            <a
              href="https://github.com/fru-dev3/prevail-desktop/issues/new"
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-border-subtle bg-surface px-2 py-1.5 font-mono text-[10px] font-medium text-text-secondary transition-colors hover:border-accent-border hover:bg-accent-soft hover:text-accent"
            >
              <MessageSquare className="h-3 w-3" /> Share feedback
            </a>
          </div>
        </div>
      )}
    </aside>
  );
}


// One floating life-domain chip: parallaxes with the cursor (via shared
// springs) and gently bobs. Icons only — never emojis.

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
            Welcome to <Brand />.
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

function DomainStatusBar({
  domain,
  fwLens,
}: {
  domain: string | null;
  fwLens: ReturnType<typeof useFrameworkLens>;
}) {
  // Hooks must be top-level — initialize state from localStorage once
  // per domain, then keep React state as the source of truth so toggles
  // re-render reliably.
  const [council, setCouncil]     = useState(false);
  const [web, setWeb]             = useState(true);
  const [save, setSave]           = useState(true);
  const [serendipity, setSeren]   = useState(false);
  const [auto, setAuto]           = useState(false);
  const [autoMode, setAutoMode]   = useState(() => getPref(`prevail.domain.${domain}.autoMode`, "smart"));
  useEffect(() => {
    // Loads for General too (domain null → the __general__ bucket).
    setCouncil(getDomainToggle(domain, "council", false));
    setWeb(getDomainToggle(domain, "web", true));
    setSave(getDomainToggle(domain, "save", true));
    setSeren(getDomainToggle(domain, "serendipity", false));
    setAuto(getDomainToggle(domain, "auto", false));
    setAutoMode(getPref(`prevail.domain.${domain}.autoMode`, "smart"));
  }, [domain]);
  // The per-domain modes (web/save/serendipity/auto) live in a popover so the
  // composer row stays focused on the per-prompt Framework + Lens controls.
  const [modesOpen, setModesOpen] = useState(false);
  const modesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!modesOpen) return;
    const onDoc = (e: MouseEvent) => { if (modesRef.current && !modesRef.current.contains(e.target as Node)) setModesOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [modesOpen]);
  // Bunker Mode forbids any request leaving the device, so Web access can never
  // be on while it's active. We show it off and locked regardless of the stored
  // preference (which is preserved for when Bunker Mode is turned back off). The
  // send path enforces the same coercion independently (see `web:` in prefs).
  const bunker = isBunkerOn();
  const webShown = bunker ? false : web;
  const activeModes = [webShown, save, serendipity, auto].filter(Boolean).length;

  const flip = (
    t: DomainToggle,
    cur: boolean,
    set: (v: boolean) => void,
  ) => {
    const next = !cur;
    set(next);
    setDomainToggle(domain, t, next);
  };
  // One row of the Modes popover: a glyph, the name + on/off badge, and a
  // one-line description, so the control explains itself.
  const ModeRow = ({
    glyph, label, on, desc, onClick,
  }: { glyph: string; label: string; on: boolean; desc: string; onClick: () => void }) => (
    <button
      onClick={onClick}
      className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-warm"
    >
      <span className={`mt-0.5 font-mono text-sm ${on ? "text-accent" : "text-text-muted"}`}>{glyph}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-sm font-semibold text-text-primary">{label}</span>
          <span className={`ml-auto shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-wider ${on ? "bg-accent text-background" : "bg-surface-warm text-text-muted"}`}>{on ? "On" : "Off"}</span>
        </span>
        <span className="mt-0.5 block text-[11px] leading-snug text-text-secondary">{desc}</span>
      </span>
    </button>
  );
  // The composer's "Council" pill is the action button — this strip is
  // for persistent per-domain settings only. Silence unused-var warnings.
  void council; void setCouncil;
  // Returns the pills as a fragment so they participate in the parent
  // composer toolbar's flex-wrap layout (no wrapper div). Framework
  // and Lens are global (always shown). Web / Save / Serendipity /
  // Auto are per-domain so they only render when a domain is selected.
  return (
    <>
      {/* Per-prompt reasoning controls — change often, so they sit inline.
          Each opens a labelled list so you pick directly. */}
      <PreamblePicker glyph="◆" label="Framework" options={FRAMEWORKS} selectedId={fwLens.framework} onSelect={fwLens.setFramework} />
      <PreamblePicker glyph="◇" label="Lens" options={LENSES} selectedId={fwLens.lens} onSelect={fwLens.setLens} />
      <div ref={modesRef} className="relative inline-flex items-center">
          <span className="mx-1 select-none text-text-muted/40">·</span>
          {/* Modes — set once, rarely changed, so they're tucked in a popover
              with an active-count badge instead of crowding the row. Available
              everywhere, including General (stored in its own bucket). */}
          <button
            onClick={() => setModesOpen((v) => !v)}
            title="Modes: web access, save history, serendipity, auto-council"
            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${
              modesOpen
                ? "border-accent-border bg-accent-soft text-accent"
                : "border-border bg-surface text-text-muted hover:bg-surface-warm hover:text-text-secondary"
            }`}
          >
            <SlidersHorizontal className="h-3 w-3" /> Modes
            {activeModes > 0 && (
              <span className="rounded-full bg-accent px-1.5 py-0 font-mono text-[9px] font-bold text-background">{activeModes}</span>
            )}
          </button>
          {modesOpen && (
            <div className="absolute bottom-full left-0 z-50 mb-2 w-80 rounded-xl border border-border bg-surface p-1.5 shadow-xl">
              <div className="px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted">Modes</div>
              <ModeRow glyph="○" label={bunker ? "Web access · locked" : "Web access"} on={webShown}
                onClick={() => { if (bunker) return; flip("web", web, setWeb); }}
                desc={bunker
                  ? "Locked off by Bunker Mode: no request may leave this device. Turn off Bunker Mode to allow web access."
                  : "Let the model fetch URLs and web-search while replying. Off keeps the reply offline."} />
              <ModeRow glyph="▣" label="Save history" on={save} onClick={() => flip("save", save, setSave)}
                desc="Log every reply to history so you can re-read it later. Off makes the turn ephemeral." />
              <ModeRow glyph="◉" label="Serendipity" on={serendipity} onClick={() => flip("serendipity", serendipity, setSeren)}
                desc="Invite lateral, off-topic angles. Off stays strictly on-topic." />
              <ModeRow glyph="◐" label="Auto-council" on={auto} onClick={() => flip("auto", auto, setAuto)}
                desc="Spin off the full council automatically. In Smart mode it convenes only for judgment calls (should-I / tradeoff / high-stakes questions); simple questions get one model. (Off in Bunker Mode: panelists are cloud models.)" />
              {auto && (
                <div className="flex items-center justify-between gap-2 px-3 py-2">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">Trigger</span>
                  <select
                    value={autoMode}
                    onChange={(e) => { setAutoMode(e.target.value); setPref(`prevail.domain.${domain}.autoMode`, e.target.value); }}
                    className="rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] text-text-secondary"
                  >
                    <option value="smart">Smart: only judgment calls</option>
                    <option value="always">Always: every send</option>
                  </select>
                </div>
              )}
            </div>
          )}
        </div>
    </>
  );
}

// Kept for potential reuse but currently unused — the DomainStatusBar
// owns the framework/lens controls now.
// @ts-expect-error noUnusedLocals
function FwLensRow({
  fwLens,
  inline = false,
}: {
  fwLens: ReturnType<typeof useFrameworkLens>;
  inline?: boolean;
}) {
  const fw = FRAMEWORKS.find((f) => f.id === fwLens.framework);
  const ln = LENSES.find((l) => l.id === fwLens.lens);
  if (inline) {
    return (
      <div className="flex items-center gap-1.5 text-xs">
        <CycleChip
          label="◆"
          value={fw?.label ?? "OFF"}
          active={fwLens.framework !== "none"}
          title={`Framework: ${fw?.blurb ?? "(off)"}`}
          onClick={() => {
            const idx = FRAMEWORKS.findIndex((f) => f.id === fwLens.framework);
            fwLens.setFramework(FRAMEWORKS[(idx + 1) % FRAMEWORKS.length].id);
          }}
        />
        <CycleChip
          label="◇"
          value={ln?.label ?? "OFF"}
          active={fwLens.lens !== "none"}
          title={`Lens: ${ln?.blurb ?? "(off)"}`}
          onClick={() => {
            const idx = LENSES.findIndex((l) => l.id === fwLens.lens);
            fwLens.setLens(LENSES[(idx + 1) % LENSES.length].id);
          }}
        />
      </div>
    );
  }
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
      <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">defaults</span>

      <CycleChip
        label="◆ Framework"
        value={fw?.label ?? "OFF"}
        active={fwLens.framework !== "none"}
        title={fw?.blurb ?? ""}
        onClick={() => {
          const idx = FRAMEWORKS.findIndex((f) => f.id === fwLens.framework);
          fwLens.setFramework(FRAMEWORKS[(idx + 1) % FRAMEWORKS.length].id);
        }}
      />
      <CycleChip
        label="◇ Lens"
        value={ln?.label ?? "OFF"}
        active={fwLens.lens !== "none"}
        title={ln?.blurb ?? ""}
        onClick={() => {
          const idx = LENSES.findIndex((l) => l.id === fwLens.lens);
          fwLens.setLens(LENSES[(idx + 1) % LENSES.length].id);
        }}
      />
      <span className="ml-auto text-[10px] text-text-muted">
        click chips to cycle · these prepend to every prompt
      </span>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────
// CHAT PANEL


// Mirrors fd-apps-prevail-cli/docs/schemas/ChatEvent.json — a single
// NDJSON event on the `prevail chat --json` stream. Consumers MUST
// tolerate unknown `type` values for forward compatibility, so `type`
// stays a bare string and every payload field is optional.

// Pull <think>…</think> / <thinking>…</thinking> reasoning blocks out of a
// model's output so they can render in a collapsible disclosure instead of
// polluting the answer. Tolerates an unclosed trailing block during streaming.

// Collapsible "Thinking" disclosure. Native <details> — no per-card React
// state. Gated by the Show-model-thinking preference at the call site.

// Council is for "why" / "should I" / steelman / decision questions —
// the kinds of asks where multiple model perspectives + a chair help.
// These hints surface when the council is idle so the user knows what
// it's good at.

// I4: high-stakes cards (Decision, Risks) are flagged `council: true` so a click
// routes to the multi-model Council instead of a single-model chat — a decision
// or a risk audit benefits from independent panelists + a synthesized verdict.

// Full domain home view — shown when a domain is selected but the
// chat hasn't started yet. Surfaces state / decisions / journal /
// session logs / skills as tabs so the user can read the domain
// before asking. Clicking a tab item primes it into the next prompt.
// Proactive surfacing for a domain — questions worth asking + suggested next
// actions, generated from the vault (cached). Click one to seed the composer.

// Tiny inline trend line: a model's judge scores over time, on a fixed 0-10
// scale so two models' lines are visually comparable.

// Settings > Benchmark: scheduled re-runs of the latest batch, for tracking
// model drift over time without manual runs.
function BenchScheduleCard({ vault }: { vault: string }) {
  const [enabled, setEnabled] = useState(() => lsGet(BENCH_SCHED.enabled, "0") === "1");
  const [freq, setFreq] = useState(() => lsGet(BENCH_SCHED.freq, "weekly") || "weekly");
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    window.addEventListener("prevail:bench-sched", f);
    return () => window.removeEventListener("prevail:bench-sched", f);
  }, []);
  const last = Number(lsGet(BENCH_SCHED.lastRun, "0")) || 0;
  const freqMs = BENCH_FREQ_MS[freq] ?? BENCH_FREQ_MS.weekly;
  const next = last ? last + freqMs : Date.now();
  return (
    <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3">
      <RotateCw className="h-4 w-4 shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        <div className="font-display text-sm font-semibold tracking-tight">Scheduled runs</div>
        <div className="text-xs text-text-secondary">
          Re-runs your most recent batch (same models, same scope) so drift shows up in the leaderboard and History without manual runs. Runs while the app is open.
          {enabled && last > 0 && ` Last ran ${formatFreshness(Math.max(0, (Date.now() - last) / 1000))} ago.`}
          {enabled && ` Next ${next <= Date.now() ? "within 30 minutes" : `in ~${formatFreshness(Math.max(0, (next - Date.now()) / 1000))}`}.`}
        </div>
      </div>
      <select
        value={freq}
        onChange={(e) => { setFreq(e.target.value); lsSet(BENCH_SCHED.freq, e.target.value); }}
        disabled={!enabled}
        className="rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] text-text-secondary disabled:opacity-40"
      >
        <option value="daily">daily</option>
        <option value="weekly">weekly</option>
        <option value="monthly">monthly</option>
      </select>
      <button
        onClick={() => { const v = !enabled; setEnabled(v); lsSet(BENCH_SCHED.enabled, v ? "1" : "0"); }}
        className={`rounded-md border px-3 py-1 font-mono text-[11px] uppercase tracking-wider ${
          enabled ? "border-accent-border bg-accent-soft text-accent" : "border-border text-text-muted hover:border-accent-border hover:text-accent"
        }`}
      >
        {enabled ? "On" : "Off"}
      </button>
      <button
        onClick={async () => { if (await rerunLatestBatch(vault)) { lsSet(BENCH_SCHED.lastRun, String(Date.now())); window.dispatchEvent(new Event("prevail:bench-sched")); } }}
        title="Re-run the latest batch right now"
        className="rounded-md border border-border px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent"
      >
        Run now
      </button>
    </div>
  );
}

// Collapsed-by-default section row for the Insights page: the summary line
// carries the count (and optional meta) so a collapsed page still reads as a
// dashboard; expanding indents the body.

// How an app talks to its third party — human label for the Settings facet.
// What the app is allowed to DO on your behalf.
// Human-readable cadence from the refresh block (every / on / at).

// Small labelled section card used across the app facets. Keeps each block
// visually distinct without the old wall-of-monospace look.
// One key/value row inside an AppCard.

// Slim, always-visible identity bar for an open app. Status, name + account,
// integration, and the domains it feeds (each a link into that domain's chat).
// The rich detail lives in the Runs / Settings / Domains facets below.

// The app's Runs / Settings / Domains facet bodies. Rendered in the canvas
// scroll area when the matching top-bar chip is active. Owns the domain-binding
// editor (the cross-link), the skills list, and the Test / Sync actions.
// One recorded sync run, mirroring the engine's sync-state.json `runs` ring.

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

function DomainHome({
  domain,
  vaultPath,
  isApp,
  onInjectContext,
  onPickPrompt,
  onInsertSkill,
  preferredSet,
  onTogglePreferred,
}: {
  domain: string;
  vaultPath: string;
  // When an app is open we reuse DomainHome for the conversation body but hide
  // the "apps refreshing this domain" strip — that's a domain view, and an app
  // shouldn't list its sibling apps.
  isApp?: boolean;
  onInjectContext: (body: string, label: string) => void;
  onPickPrompt: (text: string) => void;
  onInsertSkill: (name: string) => void;
  preferredSet: Set<string>;
  onTogglePreferred: (name: string) => void;
}) {
  type Tab = "chat" | "state" | "decisions" | "journal" | "logs" | "skills";
  // Chat is the default — state is already auto-loaded as context, so
  // we don't dump the user into the state doc on entry.
  const [tab, setTab] = useState<Tab>("chat");
  const [ctx, setCtx] = useState<DomainContextBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [taskNonce, setTaskNonce] = useState(0); // bump to reload the tasks panel
  // Starter prompts from the domain's PROMPTS.md (written by pack import) — the
  // one-click conversation starters that make an imported pack chat-ready.
  const [starterPrompts, setStarterPrompts] = useState<string[]>([]);
  useEffect(() => {
    let mounted = true;
    setLoading(true);
    invoke<DomainContextBundle>("domain_context", { vault: vaultPath, domain })
      .then((c) => { if (mounted) setCtx(c); })
      .catch(() => { if (mounted) setCtx(null); })
      .finally(() => { if (mounted) setLoading(false); });
    invoke<string[]>("read_domain_prompts", { vault: vaultPath, domain })
      .then((ps) => { if (mounted) setStarterPrompts(ps); })
      .catch(() => { if (mounted) setStarterPrompts([]); });
    return () => { mounted = false; };
  }, [vaultPath, domain]);

  const counts = {
    state: ctx?.state ? 1 : 0,
    decisions: ctx?.decisions ? 1 : 0,
    journal: ctx?.journal ? 1 : 0,
    logs: ctx?.recent_logs.length ?? 0,
    skills: ctx?.skills.length ?? 0,
  };
  const Icon = domainIcon(domain);

  // Suppress unused warning — kept for future read-only views.
  void onInjectContext;
  void Icon;
  // Domain title lives in the ChatPanel header above; here we go
  // straight to the tab strip. Avoids the duplicate "Estate · Estate"
  // problem the user flagged.
  // ChatPanel owns the persistent tab strip now; DomainHome just
  // renders the body for whichever tab the user has selected.
  void tab; void setTab; void counts;
  return (
    <div className="flex h-full w-full flex-col px-6 py-6">
      <div className="flex-1 overflow-y-auto">
        {!isApp && <DomainAppsStrip domain={domain} />}
        {loading && <div className="text-sm text-text-muted">loading domain context…</div>}
        {!loading && ctx && (
          <div>
            {tab === "chat" && (
              <div className="w-full">
                {starterPrompts.length > 0 && (
                  <div className="mb-4 rounded-xl border border-accent-border bg-accent-soft p-4">
                    <div className="mb-2 flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-accent">
                      <Sparkles className="h-3.5 w-3.5" /> Start a conversation
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {starterPrompts.map((p, i) => (
                        <button
                          key={i}
                          onClick={() => onPickPrompt(p)}
                          className="group flex items-center gap-2 rounded-lg border border-accent-border/60 bg-background px-3 py-2 text-left text-sm text-text-secondary hover:border-accent hover:text-text-primary"
                        >
                          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-accent opacity-60 group-hover:opacity-100" />
                          <span>{p}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <SurfacePanel vaultPath={vaultPath} domain={domain} onPick={onPickPrompt}
                  onAddTask={async (t) => { try { await invoke("tasks_add", { vault: vaultPath, domain, text: t, source: "surface" }); setTaskNonce((n) => n + 1); } catch (e) { console.error("tasks_add", e); } }} />
                <TasksPanel vaultPath={vaultPath} domain={domain} nonce={taskNonce} />
                <ul className="flex flex-col gap-2">
                {buildQuickActions(domain).map((q) => (
                  <li key={q.label}>
                    <button
                      onClick={() => q.council
                        ? window.dispatchEvent(new CustomEvent("prevail:council-seed", { detail: { domain, prompt: q.prompt } }))
                        : onPickPrompt(q.prompt)}
                      className="block w-full rounded-xl border border-border bg-surface px-4 py-3 text-left shadow-sm transition-all hover:-translate-y-px hover:border-accent-border hover:shadow-md"
                    >
                      <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-accent">
                        <span><span className="mr-1">{q.glyph}</span>{q.label}</span>
                        {q.council && <span className="rounded-full border border-accent-border bg-accent-soft px-1.5 py-0 text-[9px] normal-case tracking-normal">→ Council</span>}
                      </div>
                      <div className="mt-1 text-sm leading-relaxed text-text-secondary">
                        {q.prompt}
                      </div>
                    </button>
                  </li>
                ))}
                </ul>
              </div>
            )}
            {tab === "state" && (
              ctx.state ? (
                <Markdown source={ctx.state} />
              ) : (
                <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-sm text-text-muted">
                  no <code className="text-accent">state.md</code> in this domain.
                </div>
              )
            )}
            {tab === "decisions" && (
              ctx.decisions ? (
                <Markdown source={ctx.decisions} />
              ) : (
                <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-sm text-text-muted">
                  no <code className="text-accent">decisions.md</code> yet.
                </div>
              )
            )}
            {tab === "journal" && (
              ctx.journal ? (
                <Markdown source={ctx.journal} />
              ) : (
                <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-sm text-text-muted">
                  no journal entries yet: they accumulate as you save sessions.
                </div>
              )
            )}
            {tab === "logs" && (
              ctx.recent_logs.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-sm text-text-muted">
                  no past sessions. Start chatting: each "New chat" saves a session to _log/.
                </div>
              ) : (
                <ul className="space-y-2">
                  {ctx.recent_logs.map((l) => (
                    <li key={l.path}>
                      <button
                        onClick={async () => {
                          try {
                            const body = await invoke<string>("read_file", { path: l.path });
                            onInjectContext(body, l.name);
                            setTab("chat");
                          } catch (e) { console.error(e); }
                        }}
                        className="block w-full rounded-lg border border-border bg-surface p-3 text-left hover:border-accent-border hover:bg-surface-warm"
                      >
                        <div className="font-mono text-sm text-text-primary">{l.name}</div>
                        {l.preview && <div className="mt-1 line-clamp-2 text-xs text-text-muted">{l.preview}</div>}
                      </button>
                    </li>
                  ))}
                </ul>
              )
            )}
            {tab === "skills" && (
              ctx.skills.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-sm text-text-muted">
                  no skills in <code className="text-accent">{titleCase(domain)}/skills/</code>.
                </div>
              ) : (
                <SkillsList
                  skills={ctx.skills}
                  onInsert={(name) => { onInsertSkill(name); setTab("chat"); }}
                  preferredSet={preferredSet}
                  onTogglePreferred={onTogglePreferred}
                />
              )
            )}
          </div>
        )}
      </div>

      {/* The "Quick prompts" block below was a duplicate; tab-driven
          UI above now hosts them under the Chat tab. Keep an empty
          render for backward compat. */}
      <div className="hidden">
        <div className="grid w-full grid-cols-1 gap-2">
          {buildQuickActions(domain).map((q) => (
            <button
              key={q.label}
              onClick={() => onPickPrompt(q.prompt)}
              className="rounded-lg border border-border bg-surface px-4 py-3 text-left transition-colors hover:border-accent-border hover:bg-surface-warm"
            >
              <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-accent">
                <span>{q.glyph}</span> {q.label}
              </div>
              <div className="mt-1 line-clamp-2 text-sm text-text-secondary">
                {q.prompt}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Skills list — stacked floating cards centered in column. Click a
// row to expand and read the SKILL.md inline; secondary actions
// insert the /skillname or open the folder in Finder.
// Compact agent picker for the no-domain landing. Each available CLI
// is a brand glyph that animates its label out on hover; the active
// Shared emphasis for section headers ("CLI", "Model", "Framework", "Lens",
// "Skills", "Behavior", …). Bigger, bolder, high-contrast so each section
// reads as a clear divider instead of a faint murmur. Used everywhere a
// settings/prefs section is titled, for one consistent treatment.
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
const MESSAGE_WINDOW = 80;
function MessageList({ messages, resetKey, onCopy, onRetry, onEdit }: {
  messages: ChatMessage[];
  resetKey: number;
  onCopy: (text: string) => void;
  onRetry: (i: number) => void;
  onEdit: (text: string, i: number) => void;
}) {
  const [limit, setLimit] = useState(MESSAGE_WINDOW);
  // Reset the window when the thread changes (switched/cleared) so a new thread
  // always opens at the latest messages, never inheriting a huge expanded window.
  useEffect(() => { setLimit(MESSAGE_WINDOW); }, [resetKey]);
  const start = Math.max(0, messages.length - limit);
  const shown = messages.slice(start);
  return (
    <>
      {start > 0 && (
        <div className="mb-4 flex justify-center">
          <button
            onClick={() => setLimit((l) => l + MESSAGE_WINDOW)}
            className="rounded-full border border-border bg-surface px-4 py-1.5 font-mono text-[11px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent"
          >
            Show earlier messages ({start} hidden)
          </button>
        </div>
      )}
      {shown.map((m, idx) => {
        const i = start + idx;
        return (
          <ChatBubble
            key={i}
            msg={m}
            onCopy={onCopy}
            onRetry={m.role === "assistant" ? () => onRetry(i) : undefined}
            onEdit={m.role === "user" ? (text) => onEdit(text, i) : undefined}
          />
        );
      })}
    </>
  );
}

function ChatBubble({
  msg,
  onCopy,
  onRetry,
  onEdit,
}: {
  msg: ChatMessage;
  onCopy?: (text: string) => void;
  onRetry?: () => void;
  onEdit?: (text: string) => void;
}) {
  // Small inline action button used on bubble hover. Stays muted by
  // default so the chat stays calm; lights up on hover.
  const ActionButton = ({
    label,
    title,
    onClick,
    icon,
  }: {
    label?: string;
    title: string;
    onClick: () => void;
    icon: React.ReactNode;
  }) => (
    <button
      onClick={onClick}
      title={title}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-muted transition-colors hover:bg-surface-warm hover:text-accent"
    >
      {icon}
      {label && <span>{label}</span>}
    </button>
  );

  if (msg.role === "user") {
    // Right-aligned card with accent tint + tail. Hover reveals
    // Copy + Edit actions in a thin tray below the bubble.
    return (
      <div className="group mb-6 flex flex-col items-end">
        <div className="max-w-[78%] rounded-2xl rounded-br-md border border-accent-border/50 bg-accent-soft px-4 py-3 text-[15px] leading-relaxed text-text-primary shadow-sm">
          <div className="whitespace-pre-wrap">{renderSkillTokens(msg.content)}</div>
        </div>
        <div className="mt-1 flex h-5 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <ActionButton
            title="Copy message"
            label="Copy"
            onClick={() => onCopy?.(msg.content)}
            icon={<svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={1.5}><rect x="4" y="4" width="9" height="10" rx="1.5" /><path d="M3 11V3.5A1.5 1.5 0 0 1 4.5 2H10" /></svg>}
          />
          {onEdit && (
            <ActionButton
              title="Edit and resend"
              label="Edit"
              onClick={() => onEdit(msg.content)}
              icon={<svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={1.5}><path d="M11.5 2.5l2 2-7 7-2.5.5.5-2.5 7-7z" /></svg>}
            />
          )}
        </div>
      </div>
    );
  }
  // Assistant: left-aligned avatar + body. Hover reveals Copy + Retry.
  const vendor = msg.cli ?? "claude";
  const vendorName =
    vendor === "claude" ? "Claude"
    : vendor === "codex" ? "Codex"
    : vendor === "antigravity" ? "Antigravity"
    : vendor === "ollama" ? "Ollama"
    : vendor === "lmstudio" ? "LM Studio"
    : vendor === "mlx" ? "oMLX"
    : vendor;
  const empty = !msg.content && !msg.streaming;
  // Per-provider brand color for the name + bubble accent so each
  // model's turns are visually distinguishable at a glance.
  const { accent, tint } = vendorAccent(vendor);
  // The real failure reason from the CLI's stderr, if any.
  const cliError = empty ? extractCliError(msg.stderr) : null;
  // Brand styling only on normal replies — error bubbles keep the warn
  // palette so failures still read as failures.
  const bubbleStyle: React.CSSProperties = empty
    ? {}
    : { borderLeftColor: accent, borderLeftWidth: 3, background: tint };
  return (
    <div className="group mb-8 flex items-start gap-3">
      <ProviderMark vendor={vendor} size={32} />
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-text-secondary">
          <span className="font-display font-semibold tracking-tight" style={{ color: accent }}>{vendorName}</span>
          {/* I9: which model + how it was shaped (framework/lens) — so each turn
              is self-describing, not a mystery. */}
          {msg.role === "assistant" && msg.model && (
            <span className="font-mono text-[10px] lowercase text-text-muted" title={`Model: ${msg.model}`}>{modelLabel(msg.cli, msg.model)}</span>
          )}
          {msg.role === "assistant" && msg.framework && (
            <span className="rounded bg-surface-warm px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted" title="Reasoning framework in effect">{msg.framework}</span>
          )}
          {msg.role === "assistant" && msg.lens && (
            <span className="rounded bg-surface-warm px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted" title="Lens in effect">{msg.lens}</span>
          )}
          {msg.streaming && (
            <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider" style={{ color: accent, background: tint }}>
              <span className="pulse-soft inline-block h-1.5 w-1.5 rounded-full" style={{ background: accent }} />
              {msg.content ? "writing" : <ThinkingWord />}
            </span>
          )}
        </div>
        <div
          className={`rounded-2xl rounded-tl-md border px-4 py-3 text-[15px] leading-relaxed shadow-sm ${
            empty
              ? "border-warn/40 bg-warn/5"
              : "border-border-subtle bg-surface"
          }`}
          style={bubbleStyle}
        >
          {msg.content ? (
            msg.role === "assistant" ? (() => {
              const showThinking = getPref(PREF.showThinking, "1") === "1";
              const { thinking, answer } = splitThinking(msg.content);
              return (
                <>
                  {showThinking && thinking && <ThinkingDisclosure text={thinking} open={!answer} />}
                  {answer ? (msg.streaming ? <StreamingPlain source={answer} /> : <Markdown source={answer} />) : (!thinking && msg.streaming ? <ThinkingDots /> : null)}
                </>
              );
            })() : (
              <Markdown source={msg.content} />
            )
          ) : msg.streaming ? (
            <ThinkingDots />
          ) : (
            // Empty-reply fallback — explain + offer Retry instead of
            // dead "(empty reply)" text.
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <div className="font-mono text-[11px] uppercase tracking-wider text-warn">
                  No output
                </div>
                {cliError ? (
                  <>
                    <p className="mt-1 text-sm text-text-secondary">
                      {vendorName} returned an error instead of a reply:
                    </p>
                    <pre className="mt-1.5 whitespace-pre-wrap rounded-md bg-warn/10 px-2 py-1.5 font-mono text-[11px] leading-snug text-warn">
                      {cliError}
                    </pre>
                  </>
                ) : (
                  <p className="mt-1 text-sm text-text-secondary">
                    {vendorName} finished without producing any text. This usually means
                    the model rejected the prompt, hit a quota, or returned an error.
                  </p>
                )}
                {onRetry && (
                  <button
                    onClick={onRetry}
                    className="mt-2 inline-flex items-center gap-1 rounded-md border border-accent-border bg-accent-soft px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-accent hover:bg-accent hover:text-background"
                  >
                    Retry
                  </button>
                )}
              </div>
            </div>
          )}
          {msg.streaming && msg.content && <span className="cursor-blink text-accent">▌</span>}
        </div>
        {msg.content && (
          <div className="mt-1 flex h-5 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <ActionButton
              title="Copy reply"
              label="Copy"
              onClick={() => onCopy?.(msg.content)}
              icon={<svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={1.5}><rect x="4" y="4" width="9" height="10" rx="1.5" /><path d="M3 11V3.5A1.5 1.5 0 0 1 4.5 2H10" /></svg>}
            />
            {onRetry && (
              <ActionButton
                title="Regenerate from the previous prompt"
                label="Retry"
                onClick={onRetry}
                icon={<svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={1.5}><path d="M14 8a6 6 0 1 1-1.76-4.24" /><path d="M14 2v4h-4" /></svg>}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Animated three-dot indicator shown while a CLI is spinning up and
// hasn't streamed its first token yet. Replaces the dead "…" feel
// with something that obviously "ticks".
// I9: the status word used to be a random whimsical verb ("Puzzling",
// "Ruminating") that rotated every 2.4s — which read as if it meant something
// about the model's state when it didn't. Replaced with an HONEST progression
// keyed to elapsed wait time, so it actually conveys "this is taking a while".
function useThinkingWord() {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setSecs((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  if (secs < 4) return "Thinking";
  if (secs < 12) return "Still thinking";
  if (secs < 30) return "Working on it";
  return "Taking a while";
}
function ThinkingWord() {
  return <>{useThinkingWord()}</>;
}
function ThinkingDots() {
  const word = useThinkingWord();
  return (
    <span className="inline-flex items-center gap-1 font-mono">
      <span className="thinking-dot inline-block h-1.5 w-1.5 rounded-full bg-accent" style={{ animationDelay: "0ms" }} />
      <span className="thinking-dot inline-block h-1.5 w-1.5 rounded-full bg-accent" style={{ animationDelay: "150ms" }} />
      <span className="thinking-dot inline-block h-1.5 w-1.5 rounded-full bg-accent" style={{ animationDelay: "300ms" }} />
      <span className="ml-1.5 text-xs text-text-muted">{word}…</span>
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────
// COUNCIL PANEL


// One panelist slot = a (CLI, model) pair. Multiple slots can share the
// same CLI but different models (e.g. Opus 4.7 + Sonnet 4.6 side by
// side). Slot key encodes both so the reply map keeps them separate.

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
              <Brand /> Council
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


function BenchmarkPanel({
  vaultPath,
  initialDomain,
}: {
  vaultPath: string;
  initialDomain?: string | null;
}) {
  // A "runs" deep link from the Models page lands here with a model key to
  // expand on the leaderboard. Consumed once.
  const [initialModel] = useState<string | null>(() => {
    const v = lsGet("prevail.bench.expandModel");
    if (v) lsSet("prevail.bench.expandModel", "");
    return v || null;
  });
  // ONE flat navigation level: every destination is a top-level tab. No
  // "Results" grouping with a second pill bar underneath — that double
  // hierarchy was genuinely confusing.
  const [view, setView] = useState<"run" | "board" | "history" | "matrix" | "questions">(
    initialModel ? "board" : initialDomain ? "run" : "board",
  );
  // Domain filter shared by Leaderboard + History, shown in the same bar.
  const [domainFilter, setDomainFilter] = useState<string>(initialDomain ? initialDomain.toLowerCase() : "all");
  // Set when a batch just finished: the Leaderboard shows a "batch finished"
  // banner linking to it in History (answer first, filing one click away).
  const [finishedBatch, setFinishedBatch] = useState<string | null>(null);

  // Data
  const [runs, setRuns] = useState<BenchmarkRun[]>([]);
  const [matrix, setMatrix] = useState<MatrixRow[]>([]);
  const [questions, setQuestions] = useState<BenchQuestion[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const [vaultDomains, setVaultDomains] = useState<string[]>([]);
  const refresh = useCallback(() => {
    invoke<BenchmarkRun[]>("benchmark_runs", { vault: vaultPath }).then(setRuns).catch((e) => setErr(String(e)));
    invoke<MatrixRow[]>("benchmark_matrix", { vault: vaultPath }).then(setMatrix).catch(() => {});
    invoke<BenchQuestion[]>("benchmark_questions", { vault: vaultPath }).then(setQuestions).catch(() => {});
    invoke<Domain[]>("scan_vault", { path: vaultPath })
      .then((ds) => setVaultDomains(ds.map((d) => d.name)))
      .catch(() => {});
  }, [vaultPath]);
  useEffect(() => { refresh(); }, [refresh]);

  // Domains available to scope/filter by: the vault's REAL domains first,
  // then any extra domains that exist only in question files or old runs
  // (so nothing is hidden, but the list always matches the actual vault).
  const questionCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const q of questions) m[q.domain] = (m[q.domain] ?? 0) + 1;
    return m;
  }, [questions]);
  const allDomains = useMemo(() => {
    const vault = [...vaultDomains].sort();
    const extra = new Set<string>();
    for (const q of questions) extra.add(q.domain);
    for (const m of matrix) for (const d of Object.keys(m.per_domain)) extra.add(d);
    for (const v of vault) extra.delete(v);
    return [...vault, ...Array.from(extra).sort()];
  }, [vaultDomains, questions, matrix]);

  // ── Run config ──────────────────────────────────────────────────
  const [mode, setMode] = useState<"single" | "council">("single");
  const [selModels, setSelModels] = useState<Set<string>>(() => new Set([`claude${MODEL_SEP}opus`]));
  const [scope, setScope] = useState<Set<string>>(
    () => new Set(initialDomain ? [initialDomain.toLowerCase()] : []),
  );
  // Live run state comes from the module-scope registry, so it survives any
  // navigation and remount. This panel surfaces the batch matching its home
  // domain when scoped, otherwise the most relevant one.
  const allBatches = useBenchBatches().filter((b) => b.vault === vaultPath);
  const homeDomain = initialDomain ? initialDomain.toLowerCase() : null;
  const matchesHome = (b: BenchBatch) =>
    !homeDomain || b.scopeKey === "" || b.scopeKey.split(",").includes(homeDomain);
  const visibleBatches = allBatches.filter(matchesHome);
  const current =
    [...visibleBatches].reverse().find((b) => b.running) ??
    [...visibleBatches].reverse().find((b) => !b.consumed) ??
    null;
  const jobs = current?.jobs ?? [];
  const running = current?.running ?? false;
  const log = current?.log ?? "";
  const activeBatch = current
    ? { label: current.label, scope: current.scopeLabel, domains: current.scopeDomains }
    : null;
  const logRef = useRef<HTMLPreElement>(null);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [log]);

  // When a batch this panel surfaces finishes, land on the refreshed
  // leaderboard with the "batch finished" banner — once.
  useEffect(() => {
    const fin = visibleBatches.find((b) => !b.running && !b.consumed);
    if (!fin) return;
    fin.consumed = true;
    refresh();
    if (!fin.cancelled) {
      setFinishedBatch(fin.label);
      setView("board");
    }
    benchBatches.delete(fin.id);
    benchNotify();
  }, [visibleBatches, refresh]);

  const toggleModel = (cli: string, model: string) => {
    const k = `${cli}${MODEL_SEP}${model}`;
    setSelModels((cur) => {
      const next = new Set(cur);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });
  };
  const toggleScope = (d: string) =>
    setScope((cur) => {
      const next = new Set(cur);
      next.has(d) ? next.delete(d) : next.add(d);
      return next;
    });

  async function runBenchmark() {
    const scopeStr = Array.from(scope).join(",");
    const scoped = scope.size === 0
      ? questions
      : questions.filter((q) => scope.has(q.domain.toLowerCase()));
    const qids = scoped.map((q) => q.id).sort();
    const blankJob = { status: "queued" as BenchJobStatus, done: 0, total: qids.length, qids, qdone: {} };
    const plannedJobs: BenchJob[] =
      mode === "council"
        ? [{ key: "council", cli: "", model: "", label: "Council", ...blankJob }]
        : Array.from(selModels).map((k) => {
            const [cli, model] = k.split(MODEL_SEP);
            const ml = MODELS[cli]?.find((m) => m.id === model)?.label ?? model;
            return { key: k, cli, model, label: `${titleCase(cli)} · ${ml}`, ...blankJob, qdone: {} };
          });
    const runnable = isBunkerOn() ? plannedJobs.filter((j) => j.cli && isLocalCli(j.cli)) : plannedJobs;
    if (isBunkerOn() && mode === "council") { setErr("Blocked by Bunker Mode: the Council convenes cloud models."); return; }
    if (isBunkerOn() && runnable.length < plannedJobs.length) {
      setErr(runnable.length === 0
        ? "Blocked by Bunker Mode: pick a local model (Ollama, LM Studio, oMLX)."
        : "Cloud models were skipped (Blocked by Bunker Mode).");
      if (runnable.length === 0) return;
    }
    if (runnable.length === 0) { setErr("Pick at least one model to run."); return; }
    void executeBenchBatch(vaultPath, runnable, mode === "council", scopeStr);
  }

  // Rebuild a runnable job from a stored run. Runs since the rerun fix carry
  // meta.json (exact cli/model/council); older runs fall back to parsing the
  // label.
  function jobFromRun(r: BenchmarkRun, key: string): { job: BenchJob; council: boolean } | null {
    const stripped = r.label.replace(/^\d{4}-\d{2}-\d{2}[_ ]/, "").trim();
    let council = /^council\b/i.test(stripped);
    let cli = "";
    let modelId = "";
    if (r.council) {
      council = true;
    } else if (r.cli) {
      cli = r.cli;
      modelId = r.model ?? "";
    } else if (!council) {
      const known = ["claude", "codex", "antigravity", "ollama", "openrouter", "lmstudio"];
      for (const k of known) {
        if (stripped === k) { cli = k; break; }
        if (stripped.toLowerCase().startsWith(k + "-")) { cli = k; modelId = stripped.slice(k.length + 1); break; }
      }
      if (!cli) return null;
    }
    const label = council ? "Council" : `${titleCase(cli)} · ${modelLabel(cli, modelId) || modelId || "default"}`;
    const domSet = new Set(r.domains.map((d) => d.toLowerCase()));
    const qids = questions.filter((q) => domSet.size === 0 || domSet.has(q.domain.toLowerCase())).map((q) => q.id).sort();
    return {
      job: { key, cli, model: modelId, label, status: "queued", done: 0, total: qids.length || r.questions, qids, qdone: {} },
      council,
    };
  }

  // Rerun a past run as-is: the same model (or council) against the same
  // domain scope, as a fresh dated run.
  async function rerunRun(r: BenchmarkRun) {
    const built = jobFromRun(r, `rerun-${Date.now()}`);
    if (!built) { setErr(`Can't rerun: unrecognized run label "${r.label}"`); return; }
    setView("run");
    void executeBenchBatch(vaultPath, [built.job], built.council, r.domains.join(","));
  }

  // Rerun a whole BATCH: every model that ran together, together again.
  async function rerunBatch(batchRuns: BenchmarkRun[]) {
    const builds = batchRuns
      .map((r, i) => ({ r, built: jobFromRun(r, `rerun-${Date.now()}-${i}`) }))
      .filter((x): x is { r: BenchmarkRun; built: NonNullable<ReturnType<typeof jobFromRun>> } => x.built !== null);
    if (builds.length === 0) { setErr("Can't rerun this batch: no recognizable runs."); return; }
    // Dedup models (a batch should not double-run the same model).
    const seen = new Set<string>();
    const jobs = builds.filter(({ built }) => {
      const k = `${built.job.cli}::${built.job.model}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const council = jobs.some(({ built }) => built.council);
    setView("run");
    void executeBenchBatch(vaultPath, jobs.map(({ built }) => built.job), council, batchRuns[0]?.domains.join(",") ?? "");
  }

  return (
    <div className="flex h-full flex-col">
      {/* Sub-nav — a segmented control, deliberately a different shape from
          the underline top tab bar so the two rows don't read as twins. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 pb-3 pt-1">
        {/* THE navigation — every destination, one level, one bar. */}
        <div className="inline-flex items-center gap-0.5 rounded-xl border border-border-subtle bg-surface-warm/60 p-1">
          {([
            ["run", "Run", Sparkles],
            ["board", "Leaderboard", Crown],
            ["history", "History", Activity],
            ["matrix", "Model × domain", Layers],
            ["questions", "Questions", FileText],
          ] as const).map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setView(id)}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
                view === id
                  ? "bg-surface text-accent shadow-sm ring-1 ring-black/5"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              <Icon className="h-3 w-3" />
              {label}
            </button>
          ))}
        </div>
        {/* Contextual, same bar: run mode while configuring; domain filter on
            the score views. */}
        {view === "run" && (
          <div className="inline-flex items-center gap-0.5 rounded-xl border border-border-subtle bg-surface-warm/60 p-1">
            {([
              ["single", "Models", Layers],
              ["council", "Council", Scale],
            ] as const).map(([id, label, Icon]) => (
              <button
                key={id}
                onClick={() => setMode(id)}
                disabled={id === "council" && isBunkerOn()}
                title={
                  id === "single"
                    ? "Compare models head-to-head"
                    : isBunkerOn()
                      ? "Blocked by Bunker Mode: the Council convenes cloud models"
                      : "Run the multi-model Council"
                }
                className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
                  mode === id
                    ? "bg-surface text-accent shadow-sm ring-1 ring-black/5"
                    : "text-text-muted hover:text-text-secondary"
                }`}
              >
                <Icon className="h-3 w-3" />
                {label}
              </button>
            ))}
          </div>
        )}
        {(view === "board" || view === "history") && allDomains.length > 0 && (
          <select
            value={domainFilter}
            onChange={(e) => setDomainFilter(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] text-text-secondary"
          >
            <option value="all">all domains</option>
            {allDomains.map((d) => <option key={d} value={d}>{titleCase(d)}</option>)}
          </select>
        )}
        {initialDomain && (
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-surface px-3 py-1 font-mono text-[11px] text-text-muted">
            <Target className="h-3 w-3 text-accent" />
            scoped to <span className="font-semibold text-accent">{titleCase(initialDomain)}</span>
          </span>
        )}
      </div>

      {err && <div className="mx-4 mt-3 rounded border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">{err}</div>}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {view === "run" && (
          <BenchRunConfig
            mode={mode} setMode={setMode}
            selModels={selModels} toggleModel={toggleModel}
            allDomains={allDomains} scope={scope} toggleScope={toggleScope}
            questionCounts={questionCounts}
            questionCount={
              scope.size === 0
                ? questions.length
                : questions.filter((q) => scope.has(q.domain.toLowerCase())).length
            }
            running={running} jobs={jobs} log={log} logRef={logRef}
            activeBatch={activeBatch}
            onRun={runBenchmark}
            onViewResults={() => setView("board")}
            onReset={() => { if (current && !current.running) { benchBatches.delete(current.id); benchNotify(); } }}
            onCancel={current?.running ? () => void cancelBenchBatch(current.id) : undefined}
            onCrumbHome={() => setView("board")}
          />
        )}
        {(view === "board" || view === "history" || view === "matrix") && (
          <BenchResults
            view={view}
            domainFilter={view === "matrix" ? "all" : domainFilter}
            runs={runs} matrix={matrix} allDomains={allDomains} vaultPath={vaultPath}
            initialModel={initialModel} onChanged={refresh}
            onRerun={(r) => void rerunRun(r)}
            onRerunBatch={(rs) => void rerunBatch(rs)}
            finishedBatch={finishedBatch}
            onViewBatch={() => { setView("history"); setFinishedBatch(null); }}
            onDismissBanner={() => setFinishedBatch(null)}
            onCrumbHome={() => setView("run")}
            onClearDomain={() => setDomainFilter("all")}
          />
        )}
        {view === "questions" && (
          <BenchQuestions
            vaultPath={vaultPath} questions={questions} allDomains={allDomains}
            initialDomain={initialDomain}
            onChanged={refresh}
          />
        )}
      </div>
    </div>
  );
}

// The ONE breadcrumb used by every benchmark view: same place, same format,
// every level of the tree clickable on every page. `meta` is the right-hand
// counts slot so each page's numbers also live in a consistent spot.

function BenchRunConfig({
  mode, setMode, selModels, toggleModel, allDomains, scope, toggleScope,
  questionCounts, questionCount, running, jobs, log, logRef, activeBatch, onRun, onViewResults, onReset, onCancel, onCrumbHome,
}: {
  mode: "single" | "council";
  setMode: (m: "single" | "council") => void;
  selModels: Set<string>;
  toggleModel: (cli: string, model: string) => void;
  allDomains: string[];
  scope: Set<string>;
  toggleScope: (d: string) => void;
  questionCounts: Record<string, number>;
  questionCount: number;
  running: boolean;
  jobs: BenchJob[];
  log: string;
  logRef: React.RefObject<HTMLPreElement | null>;
  activeBatch?: { label: string; scope: string; domains: string[] } | null;
  onRun: () => void;
  onViewResults: () => void;
  onCancel?: () => void;
  onReset: () => void;
  onCrumbHome?: () => void;
}) {
  const selCount = mode === "council" ? 1 : selModels.size;
  void setMode; // mode toggle now lives in the header bar; prop kept for the call site
  // Collapsible provider groups — ALL collapsed by default so the page never
  // opens as a wall of models. Each provider row still shows its selected
  // count, so what's on the panel stays visible while collapsed.
  const [collapsedProviders, setCollapsedProviders] = useState<Set<string>>(() =>
    new Set(BENCH_CLI_OPTIONS.map((c) => c.id)),
  );
  const toggleProvider = (id: string) =>
    setCollapsedProviders((cur) => {
      const next = new Set(cur);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // Which job card is expanded to its question-by-question detail.
  const [expandedJob, setExpandedJob] = useState<string | null>(null);

  // While a benchmark is in flight (or just finished with errors), the page
  // IS the progress: the config disappears and each model gets a live
  // question-by-question progress bar. No clutter, no guessing.
  if (running || jobs.length > 0) {
    const allDone = !running;
    const doneCount = jobs.filter((j) => j.status === "done").length;
    const errCount = jobs.filter((j) => j.status === "error").length;
    return (
      <div className="w-full space-y-4 px-8 py-5">
        <BenchCrumbs
          items={[
            { label: "Benchmark", onClick: onCrumbHome },
            { label: "Run", onClick: allDone ? onReset : undefined },
            { label: activeBatch?.label ?? (running ? "Running…" : "Finished") },
          ]}
          meta={`${jobs.length} model${jobs.length === 1 ? "" : "s"} · ${jobs[0]?.total ?? 0} questions each`}
        />
        <div className="text-center">
          <div className="font-display text-xl font-semibold tracking-tight">
            {running ? "Benchmarking…" : jobs.some((j) => j.status === "cancelled") ? "Run cancelled" : errCount > 0 ? "Finished with errors" : "Benchmark complete"}
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-1">
            {(activeBatch?.domains?.length ? activeBatch.domains : ["All domains"]).slice(0, 10).map((d) => (
              <span key={d} className="rounded-full border border-accent-border bg-accent-soft px-2 py-0.5 font-mono text-[10px] text-accent">{d}</span>
            ))}
            {(activeBatch?.domains?.length ?? 0) > 10 && (
              <span className="font-mono text-[10px] text-text-muted">+{(activeBatch?.domains?.length ?? 0) - 10} more</span>
            )}
          </div>
          <div className="mt-1.5 font-mono text-[11px] text-text-muted">
            {jobs.length} model{jobs.length === 1 ? "" : "s"} · {jobs[0]?.total ?? 0} question{(jobs[0]?.total ?? 0) === 1 ? "" : "s"} each · running in parallel · auto-scored
          </div>
          {/* Overall batch progress — every question across every model. */}
          {(() => {
            const overallTotal = jobs.reduce((a, j) => a + j.total, 0);
            const overallDone = jobs.reduce((a, j) => a + (j.status === "done" || j.status === "scoring" ? j.total : j.done), 0);
            const pct = overallTotal > 0 ? Math.round((overallDone / overallTotal) * 100) : 0;
            return (
              <div className="mx-auto mt-4 max-w-xl">
                <div className="mb-1 flex items-baseline justify-between font-mono text-[11px]">
                  <span className="text-text-muted">overall</span>
                  <span className="tabular-nums text-text-primary">{overallDone}/{overallTotal} · <span className="font-semibold text-accent">{pct}%</span></span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-surface-warm">
                  <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })()}
          {running && onCancel && (
            <button
              onClick={onCancel}
              className="mx-auto mt-3 inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1 font-mono text-[11px] text-text-secondary hover:border-danger hover:text-danger"
            >
              ✗ Cancel run
            </button>
          )}
        </div>
        <div className="space-y-2">
          {jobs.map((j) => {
            const pct = j.total > 0 ? Math.round((j.done / j.total) * 100) : 0;
            const expanded = expandedJob === j.key;
            return (
              <div key={j.key} className="overflow-hidden rounded-xl border border-border bg-surface">
                <button
                  onClick={() => setExpandedJob(expanded ? null : j.key)}
                  className="w-full px-4 py-3 text-left hover:bg-surface-warm/60"
                  title="Click for question-by-question detail"
                >
                  <div className="flex items-center gap-3">
                    <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-text-muted transition-transform ${expanded ? "rotate-90" : ""}`} />
                    {j.cli ? <ProviderMark vendor={j.cli} size={20} /> : <Scale className="h-5 w-5 text-accent" />}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">{j.label}</span>
                    {j.status === "running" && j.qcur && (
                      <span className="hidden min-w-0 max-w-[220px] truncate font-mono text-[10px] text-text-muted md:inline">{j.qcur}…</span>
                    )}
                    <span className="font-mono text-[11px] tabular-nums text-text-muted">
                      {j.status === "queued" ? "queued" : `${j.done}/${j.total}`}
                    </span>
                    <span className={`w-16 text-right font-mono text-[10px] uppercase tracking-wider ${
                      j.status === "error" ? "text-danger" : j.status === "cancelled" ? "text-text-muted" : j.status === "done" ? "text-ok" : "text-accent"
                    }`}>
                      {j.status === "error" ? "error" : j.status === "cancelled" ? "cancelled" : j.status === "done" ? "done" : j.status === "scoring" ? "scoring" : j.status === "running" ? `${pct}%` : "queued"}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-warm">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        j.status === "error" ? "bg-danger/60" : j.status === "cancelled" ? "bg-surface-strong" : j.status === "scoring" || j.status === "done" ? "bg-ok" : "bg-accent"
                      } ${j.status === "scoring" ? "animate-pulse" : ""}`}
                      style={{ width: `${j.status === "done" || j.status === "scoring" ? 100 : pct}%` }}
                    />
                  </div>
                  {j.note && <div className="mt-1.5 font-mono text-[10px] text-danger">{j.note}</div>}
                </button>
                {expanded && j.qids.length > 0 && (
                  <div className="max-h-64 overflow-y-auto border-t border-border-subtle bg-background/40 px-4 py-2">
                    {j.qids.map((q) => {
                      const info = j.qdone[q];
                      const isCur = !info && j.qcur === q;
                      const failed = info?.startsWith("✗");
                      return (
                        <div key={q} className="flex items-center gap-2.5 py-1">
                          <span className="w-4 shrink-0 text-center">
                            {info ? (
                              failed
                                ? <AlertTriangle className="h-3 w-3 text-danger" />
                                : <Check className="h-3 w-3 text-ok" strokeWidth={3} />
                            ) : isCur ? (
                              <Loader2 className="h-3 w-3 animate-spin text-accent" />
                            ) : (
                              <Circle className="h-2.5 w-2.5 text-text-muted/40" />
                            )}
                          </span>
                          <span className={`min-w-0 flex-1 truncate font-mono text-[11px] ${info ? "text-text-primary" : isCur ? "text-accent" : "text-text-muted/60"}`}>
                            {q}
                          </span>
                          {info && !failed && <span className="max-w-[200px] truncate font-mono text-[9px] text-text-muted">{info}</span>}
                          {failed && <span className="max-w-[260px] truncate font-mono text-[9px] text-danger" title={info}>{info}</span>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {allDone && (
          <div className="flex items-center justify-center gap-2 pt-1">
            <button onClick={onViewResults} className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-background hover:bg-accent-hover">
              <TrendingUp className="h-4 w-4" /> View results
            </button>
            <button onClick={onReset} className="rounded-lg border border-border px-4 py-2 text-sm text-text-secondary hover:bg-surface-warm">
              New run
            </button>
          </div>
        )}
        {allDone && doneCount > 0 && errCount > 0 && (
          <p className="text-center font-mono text-[10px] text-text-muted">Failed jobs can be rerun individually from a new run.</p>
        )}
        {log && (
          <details className="rounded-lg border border-border-subtle bg-surface px-3 py-2">
            <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-wider text-text-muted">engine log</summary>
            <pre ref={logRef} className="mt-2 max-h-48 overflow-y-auto font-mono text-[10px] leading-relaxed text-text-muted">{log}</pre>
          </details>
        )}
      </div>
    );
  }

  return (
    <div className="w-full space-y-7 px-8 py-5">
      <BenchCrumbs
        items={[{ label: "Benchmark", onClick: onCrumbHome }, { label: "Run" }]}
        meta={`${questionCount} question${questionCount === 1 ? "" : "s"}${scope.size > 0 ? " · scoped" : ""}`}
      />
      {/* Mode lives in the header bar now (one consistent control row). */}

      {/* Models (multi-select) — hidden in council mode. Compact grid so the
          whole panel of a provider scans in two or three rows instead of a
          full-width row per model. */}
      {mode === "single" && (
        <section>
          <SubsectionHeader icon={Layers} hint={`${selModels.size} selected · runs head-to-head`}>
            Models
          </SubsectionHeader>
          {isBunkerOn() && (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-border bg-surface-warm/60 px-3 py-2">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-accent" />
              <span className="font-mono text-[11px] text-text-secondary">Bunker Mode is on: only local models (Ollama, LM Studio, oMLX) can run.</span>
            </div>
          )}
          <div className="space-y-3">
            {BENCH_CLI_OPTIONS.map((c) => {
              const models = MODELS[c.id] ?? [];
              const selectedHere = models.filter((m) => selModels.has(`${c.id}${MODEL_SEP}${m.id}`)).length;
              const collapsed = collapsedProviders.has(c.id);
              const bunkerBlocked = isBunkerOn() && !isLocalCli(c.id);
              return (
                <div key={c.id}>
                  <button
                    onClick={() => toggleProvider(c.id)}
                    className="mb-1.5 flex w-full items-center gap-2 rounded-md py-0.5 text-left transition-colors hover:text-accent"
                  >
                    {collapsed ? <ChevronRight className="h-3.5 w-3.5 text-text-muted" /> : <ChevronDown className="h-3.5 w-3.5 text-text-muted" />}
                    <ProviderMark vendor={c.id} size={16} />
                    <span className="font-display text-[13px] font-semibold tracking-tight">{c.label}</span>
                    {selectedHere > 0 && (
                      <span className="rounded-full bg-accent px-1.5 py-px font-mono text-[9px] font-semibold text-background">{selectedHere}</span>
                    )}
                    <span className="ml-auto font-mono text-[10px] text-text-muted">{models.length}</span>
                  </button>
                  {!collapsed && (
                    <div className="ml-[7px] grid grid-cols-1 gap-1.5 border-l border-border-subtle/70 pl-4">
                      {models.map((m) => {
                        const on = selModels.has(`${c.id}${MODEL_SEP}${m.id}`);
                        return (
                          <button
                            key={m.id}
                            onClick={() => toggleModel(c.id, m.id)}
                            disabled={bunkerBlocked}
                            title={bunkerBlocked ? "Blocked by Bunker Mode" : m.blurb}
                            className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${on ? "border-accent bg-accent-soft" : "border-border-subtle bg-surface hover:border-accent-border"}`}
                          >
                            <span className={`min-w-0 flex-1 truncate font-mono text-xs ${on ? "font-semibold text-accent" : "text-text-primary"}`}>{m.label}</span>
                            <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${on ? "bg-accent text-background" : "border border-border"}`}>
                              {on && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                            </span>
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
      )}

      {/* Domain scope — domains that HAVE questions lead (sorted by how many);
          the empty ones sit behind a disclosure so 20+ domains don't become a
          wall of noise. */}
      <section>
        <SubsectionHeader icon={Target} hint={scope.size === 0 ? "all domains" : `${scope.size} selected`}>
          Domain scope
        </SubsectionHeader>
        {allDomains.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-surface px-4 py-3 text-xs text-text-muted">
            No questions yet: add some in the <span className="text-accent">Questions</span> tab first.
          </div>
        ) : (() => {
          const withQ = allDomains.filter((d) => (questionCounts[d] ?? 0) > 0).sort((a, b) => (questionCounts[b] ?? 0) - (questionCounts[a] ?? 0));
          const withoutQ = allDomains.filter((d) => (questionCounts[d] ?? 0) === 0);
          const pill = (d: string) => {
            const on = scope.has(d);
            const Icon = domainIcon(d);
            const count = questionCounts[d] ?? 0;
            return (
              <button
                key={d}
                onClick={() => toggleScope(d)}
                title={count === 0 ? "No questions yet: add or AI-suggest some in Questions" : `${count} question${count === 1 ? "" : "s"}`}
                className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 font-mono text-[11px] ${
                  on
                    ? "border-accent-border bg-accent-soft text-accent"
                    : count === 0
                      ? "border-border-subtle bg-background text-text-muted/60 hover:bg-surface-warm"
                      : "border-border bg-background text-text-secondary hover:bg-surface-warm"
                }`}
              >
                {Icon && <Icon className="h-3 w-3" />}
                {titleCase(d)}
                {count > 0 && (
                  <span className={`ml-0.5 rounded-full px-1 text-[9px] ${on ? "bg-accent/15 text-accent" : "bg-surface-warm text-text-muted"}`}>{count}</span>
                )}
              </button>
            );
          };
          const selectedLabel = scope.size === 0
            ? "All domains"
            : (withQ.filter((d) => scope.has(d)).map(titleCase).join(", ") || `${scope.size} selected`);
          return (
            // One collapsible list (collapsed by default) so the scope reads as a
            // single quiet line — the full domain set only appears on expand, so
            // the page isn't a wall of chips.
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md py-0.5 font-mono text-[11px] text-text-secondary transition-colors hover:text-accent">
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-muted transition-transform group-open:rotate-90" />
                <span className="truncate">{selectedLabel}</span>
              </summary>
              <div className="ml-[7px] mt-2 space-y-2 border-l border-border-subtle/70 pl-4">
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => scope.forEach((d) => toggleScope(d))}
                    className={`rounded-md border px-2.5 py-1 font-mono text-[11px] ${scope.size === 0 ? "border-accent-border bg-accent-soft text-accent" : "border-border bg-background text-text-muted hover:bg-surface-warm"}`}
                  >
                    All
                  </button>
                  {withQ.map(pill)}
                </div>
                {withoutQ.length > 0 && (
                  <details className="group/sub">
                    <summary className="cursor-pointer list-none font-mono text-[10px] uppercase tracking-wider text-text-muted hover:text-text-secondary">
                      <ChevronRight className="mr-1 inline h-3 w-3 transition-transform group-open/sub:rotate-90" />
                      {withoutQ.length} domain{withoutQ.length === 1 ? "" : "s"} without questions
                    </summary>
                    <div className="mt-2 flex flex-wrap gap-1.5">{withoutQ.map(pill)}</div>
                  </details>
                )}
              </div>
            </details>
          );
        })()}
      </section>

      {/* Run */}
      <section className="flex items-center gap-3">
        <button
          onClick={onRun}
          disabled={running || questionCount === 0 || selCount === 0}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-background hover:bg-accent-hover disabled:opacity-40"
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {running ? "Running…" : mode === "council" ? "Run council benchmark" : `Run ${selCount} model${selCount === 1 ? "" : "s"}`}
        </button>
        <span className="text-xs text-text-muted">
          {questionCount} question{questionCount === 1 ? "" : "s"}
          {scope.size > 0 ? ` · scoped` : ""} · different CLIs run in parallel · auto-scored
        </span>
      </section>

    </div>
  );
}

function BenchResults({
  view, domainFilter, runs, matrix, allDomains, vaultPath, initialModel, onChanged, onRerun, onRerunBatch,
  finishedBatch, onViewBatch, onDismissBanner, onCrumbHome, onClearDomain,
}: {
  view: "board" | "history" | "matrix";
  domainFilter: string;
  runs: BenchmarkRun[];
  matrix: MatrixRow[];
  allDomains: string[];
  vaultPath: string;
  initialModel?: string | null;
  onChanged: () => void;
  onRerun: (run: BenchmarkRun) => void;
  onRerunBatch: (runs: BenchmarkRun[]) => void;
  finishedBatch?: string | null;
  onViewBatch?: () => void;
  onDismissBanner?: () => void;
  onCrumbHome?: () => void;
  onClearDomain?: () => void;
}) {
  const resultsView = view;
  const [selected, setSelected] = useState<RunDetail | null>(null);
  // The run + breadcrumb context behind the open detail page, so the user can
  // see where they are (view › batch › run) and walk back up the tree.
  const [selectedRun, setSelectedRun] = useState<BenchmarkRun | null>(null);
  const [selectedFrom, setSelectedFrom] = useState<{ view: string; batch?: string } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [expandedQ, setExpandedQ] = useState<string | null>(null);
  const [scoringRun, setScoringRun] = useState<string | null>(null);

  async function loadRun(runDir: string, from?: { view: string; batch?: string }) {
    setLoadingDetail(true);
    setExpandedQ(null);
    setSelectedRun(runs.find((r) => r.run_dir === runDir) ?? null);
    setSelectedFrom(from ?? { view: resultsView === "history" ? "History" : resultsView === "matrix" ? "Model × domain" : "Leaderboard" });
    try {
      setSelected(await invoke<RunDetail>("benchmark_run_detail", { runDir }));
    } catch { /* ignore */ } finally {
      setLoadingDetail(false);
    }
  }

  // Score one unscored run on demand, then refresh the lists.
  async function scoreNow(run: BenchmarkRun) {
    const runName = run.run_dir.split("/").pop() ?? "";
    if (!runName) return;
    const session = `bench-score-one-${Date.now()}`;
    setScoringRun(run.run_dir);
    try {
      const done = new Promise<void>((resolve) => {
        let un: UnlistenFn | null = null;
        listen<{ session: string; phase: string }>("benchmark:done", (e) => {
          if (e.payload.session === session && e.payload.phase === "score") { un?.(); resolve(); }
        }).then((u) => { un = u; });
      });
      await invoke("benchmark_score", { args: { session_id: session, vault: vaultPath, run: runName } });
      await done;
      onChanged();
    } catch { /* surfaced via refresh */ } finally {
      setScoringRun(null);
    }
  }

  // Runs visible under the current domain filter (a run is "in" a domain
  // when any of its questions came from it).
  const visibleRuns = useMemo(() => {
    if (domainFilter === "all") return runs;
    return runs.filter((r) => r.domains.includes(domainFilter));
  }, [runs, domainFilter]);

  // Run history grouped by BATCH — the models you launched together are one
  // unit, named by time + scope + panel size so several batches a day stay
  // distinct. Runs from before batch-stamping are clustered into
  // pseudo-batches by launch time (folders created within minutes of each
  // other were one launch), so old history reads as real sessions too.
  const runsByBatch = useMemo(() => {
    type Group = { key: string; label: string; date: string; runs: BenchmarkRun[]; isBatch: boolean };
    const groups = new Map<string, Group>();
    const legacy: BenchmarkRun[] = [];
    for (const r of visibleRuns) {
      if (!r.batch_id) { legacy.push(r); continue; }
      const g = groups.get(r.batch_id) ?? {
        key: r.batch_id,
        label: r.batch_label || r.batch_id,
        date: r.date || "",
        runs: [],
        isBatch: true,
      };
      g.runs.push(r);
      groups.set(r.batch_id, g);
    }
    // Cluster legacy runs: sorted by creation time, a gap over 10 minutes
    // starts a new pseudo-batch.
    const GAP = 10 * 60 * 1000;
    const sortedLegacy = [...legacy].sort((a, b) => a.created_ms - b.created_ms);
    let cluster: BenchmarkRun[] = [];
    const flush = () => {
      if (cluster.length === 0) return;
      const first = cluster[0];
      const t = first.created_ms ? new Date(first.created_ms) : null;
      const hhmm = t ? `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}` : "";
      const key = `legacy-${first.run_dir}`;
      groups.set(key, {
        key,
        label: `${hhmm ? hhmm + " · " : ""}${cluster.length} model${cluster.length === 1 ? "" : "s"}`,
        date: first.date || "",
        runs: cluster,
        isBatch: false,
      });
      cluster = [];
    };
    for (const r of sortedLegacy) {
      if (cluster.length > 0 && r.created_ms - cluster[cluster.length - 1].created_ms > GAP) flush();
      cluster.push(r);
    }
    flush();
    return Array.from(groups.values()).sort((a, b) =>
      b.date.localeCompare(a.date) || (b.runs[0]?.created_ms ?? 0) - (a.runs[0]?.created_ms ?? 0),
    );
  }, [visibleRuns]);

  // By-model aggregation: every run of the same model folded into one row —
  // best/latest scores, run count, and the domains it has been tested on.
  const modelAgg = useMemo(() => {
    const byModel = new Map<string, { parsed: ReturnType<typeof parseRunLabel>; runs: BenchmarkRun[] }>();
    for (const r of visibleRuns) {
      const parsed = parseRunLabel(r.label);
      const key = `${parsed.vendor}::${parsed.model || r.label}`;
      const e = byModel.get(key) ?? { parsed, runs: [] };
      e.runs.push(r);
      byModel.set(key, e);
    }
    const rows = Array.from(byModel.values()).map(({ parsed, runs: rr }) => {
      const judgeFor = (r: BenchmarkRun) => {
        if (domainFilter === "all") return r.judge_avg;
        return matrix.find((m) => m.run_dir === r.run_dir)?.per_domain[domainFilter]?.judge_avg ?? null;
      };
      const kwFor = (r: BenchmarkRun) => {
        if (domainFilter === "all") return r.keyword_avg;
        return matrix.find((m) => m.run_dir === r.run_dir)?.per_domain[domainFilter]?.keyword_avg ?? null;
      };
      const scoredRuns = rr.filter((r) => judgeFor(r) !== null);
      const best = scoredRuns.reduce<number | null>((acc, r) => {
        const v = judgeFor(r);
        return v === null ? acc : acc === null ? v : Math.max(acc, v);
      }, null);
      const latest = [...rr].sort((a, b) => b.date.localeCompare(a.date))[0];
      const domains = Array.from(new Set(rr.flatMap((r) => r.domains))).sort();
      // Chronological judge scores — the drift line. Delta = latest vs the
      // run before it.
      const history = [...scoredRuns]
        .sort((a, b) => a.created_ms - b.created_ms)
        .map((r) => judgeFor(r))
        .filter((v): v is number => v !== null);
      const delta = history.length >= 2 ? history[history.length - 1] - history[history.length - 2] : null;
      return {
        key: `${parsed.vendor}::${parsed.model}`,
        parsed,
        runs: [...rr].sort((a, b) => b.date.localeCompare(a.date)),
        best,
        latestJudge: latest ? judgeFor(latest) : null,
        latestKw: latest ? kwFor(latest) : null,
        latestDate: latest?.date ?? "",
        domains,
        history,
        delta,
      };
    });
    return rows.sort((a, b) => (b.best ?? -1) - (a.best ?? -1));
  }, [visibleRuns, matrix, domainFilter]);
  const [expandedModel, setExpandedModel] = useState<string | null>(initialModel ?? null);


  if (selected) {
    const p = parseRunLabel(selected.score.label);
    const crumbBatch = selectedRun?.batch_label ?? selectedFrom?.batch ?? (selectedRun?.date || null);
    // A section header inside an expanded question: big, bold, unmissable.
    const SectionHead = ({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "ok" | "accent" }) => (
      <h4 className={`mb-1.5 flex items-center gap-2 font-display text-[15px] font-bold tracking-tight ${
        tone === "ok" ? "text-ok" : tone === "accent" ? "text-accent" : "text-text-primary"
      }`}>
        {children}
      </h4>
    );
    return (
      <div className="w-full px-8 py-5">
        <BenchCrumbs
          items={[
            { label: "Benchmark" },
            { label: selectedFrom?.view ?? "Leaderboard", onClick: () => setSelected(null) },
            ...(crumbBatch ? [{ label: crumbBatch, onClick: () => setSelected(null) }] : []),
            { label: p.model },
          ]}
          meta={`${selected.score.questionScores.length} questions`}
        />
        {/* Dense header — model, when, where it ran, and the verdict, one row. */}
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3">
          <ProviderMark vendor={p.vendor} size={28} />
          <h2 className="font-display text-xl font-bold tracking-tight">{p.model}</h2>
          {selectedRun?.date && <span className="rounded bg-surface-warm px-2 py-0.5 font-mono text-[10px] text-text-muted">{selectedRun.date}</span>}
          <span className="flex items-center gap-1">
            {(selectedRun?.domains ?? []).slice(0, 6).map((d) => (
              <span key={d} className="rounded bg-surface-warm px-1.5 py-0.5 font-mono text-[10px] text-text-muted">{d}</span>
            ))}
            {(selectedRun?.domains.length ?? 0) > 6 && <span className="font-mono text-[10px] text-text-muted">+{(selectedRun?.domains.length ?? 0) - 6}</span>}
          </span>
          <div className="ml-auto flex items-center gap-5 font-mono text-sm">
            <span><span className="font-display text-2xl font-bold text-accent">{selected.score.judge_avg?.toFixed(1) ?? "-"}</span><span className="text-[11px] text-text-muted"> /10</span></span>
            <span className="text-text-secondary">{selected.score.keyword_avg !== null ? Math.round(selected.score.keyword_avg) + "% kw" : ""}</span>
            <span className="text-text-muted">{selected.score.questionScores.length} q</span>
            {selectedRun && (
              <button
                onClick={() => onRerun(selectedRun)}
                title="Rerun: same model, same domains, as a fresh run"
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent"
              >
                <RotateCw className="h-3 w-3" /> rerun
              </button>
            )}
          </div>
        </div>
        <div className="mt-4 space-y-2">
          {selected.score.questionScores.map((q) => {
            const expanded = expandedQ === q.id;
            const record = selected.records.find((r) => r.id === q.id);
            return (
              <div key={q.id} className="overflow-hidden rounded-lg border border-border bg-surface">
                <button onClick={() => setExpandedQ(expanded ? null : q.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-warm">
                  <span className="text-text-muted">{expanded ? "▾" : "▸"}</span>
                  <span className="w-44 shrink-0 truncate font-mono text-sm text-text-primary" title={q.id}>{q.id}</span>
                  <span className="rounded bg-surface-warm px-1.5 py-0 font-mono text-[10px] text-text-muted">{q.domain}</span>
                  <div className="min-w-0 flex-1"><ScoreBar value={q.judge_score} max={10} /></div>
                  <span className="flex shrink-0 items-center gap-3 font-mono text-xs">
                    <span className="text-text-muted">{q.keyword_score !== null ? Math.round(q.keyword_score) + "%" : "-"}</span>
                    <span className="w-10 text-right text-accent">{q.judge_score ?? "-"}/10</span>
                  </span>
                </button>
                {expanded && (
                  <div className="space-y-5 border-t border-border-subtle px-6 py-5 text-sm">
                    <div>
                      <SectionHead><FileText className="h-4 w-4" /> Question</SectionHead>
                      <div className="max-w-[90ch] whitespace-pre-wrap leading-relaxed text-text-primary">{record?.prompt ?? "(n/a)"}</div>
                    </div>
                    {record?.expected_decision && (
                      <div className="rounded-lg border border-ok/25 bg-ok/5 px-4 py-3">
                        <SectionHead tone="ok"><Check className="h-4 w-4" strokeWidth={3} /> Expected decision</SectionHead>
                        <div className="max-w-[90ch] whitespace-pre-wrap leading-relaxed text-text-primary">{record.expected_decision}</div>
                      </div>
                    )}
                    <div>
                      <SectionHead><MessagesSquare className="h-4 w-4" /> Model's answer</SectionHead>
                      <div className="max-w-[90ch] whitespace-pre-wrap leading-relaxed text-text-primary">{record?.reply ?? "(no reply)"}</div>
                    </div>
                    {q.judge_rationale && (
                      <div className="rounded-lg border border-accent-border bg-accent-soft/40 px-4 py-3">
                        <SectionHead tone="accent"><Scale className="h-4 w-4" /> Judge verdict · {q.judge_score}/10</SectionHead>
                        <div className="max-w-[90ch] whitespace-pre-wrap leading-relaxed text-text-secondary">{q.judge_rationale}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full px-8 py-5">
      <BenchCrumbs
        items={[
          { label: "Benchmark", onClick: onCrumbHome },
          {
            label: resultsView === "history" ? "History" : resultsView === "matrix" ? "Model × domain" : "Leaderboard",
            // Clickable only when a domain filter pushes it off the tail — then
            // it walks back to the same view across all domains.
            onClick: domainFilter !== "all" ? onClearDomain : undefined,
          },
          ...(domainFilter !== "all" ? [{ label: titleCase(domainFilter) }] : []),
        ]}
        meta={
          resultsView === "history"
            ? `${runsByBatch.length} batch${runsByBatch.length === 1 ? "" : "es"} · ${visibleRuns.length} model run${visibleRuns.length === 1 ? "" : "s"}`
            : `${modelAgg.length} model${modelAgg.length === 1 ? "" : "s"} · ${visibleRuns.length} run${visibleRuns.length === 1 ? "" : "s"}`
        }
      />

      {visibleRuns.length === 0 && (
        <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-sm text-text-muted">
          {domainFilter === "all"
            ? <>No runs yet. Head to <span className="text-accent">Run</span> to kick one off.</>
            : <>No runs cover <span className="text-accent">{titleCase(domainFilter)}</span> yet. Run a benchmark scoped to it, or switch the filter to all domains.</>}
        </div>
      )}

      {loadingDetail && <div className="mb-2 text-xs text-text-muted">loading…</div>}

      {/* LEADERBOARD — the page leads with the ANSWER: which model wins.
          Podium for the top three, then full standings, one row per model. */}
      {resultsView === "board" && visibleRuns.length > 0 && (
        <>
          {finishedBatch && (
            <div className="mb-4 flex items-center gap-3 rounded-xl border border-accent-border bg-accent-soft/50 px-4 py-2.5">
              <Check className="h-4 w-4 shrink-0 text-accent" strokeWidth={3} />
              <span className="min-w-0 flex-1 truncate text-sm text-text-primary">
                Batch <span className="font-semibold">{finishedBatch}</span> finished and is on the board.
              </span>
              <button onClick={onViewBatch} className="shrink-0 rounded-md border border-accent-border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-accent hover:bg-accent hover:text-background">
                View batch
              </button>
              <button onClick={onDismissBanner} title="Dismiss" className="shrink-0 rounded-md p-1 text-text-muted hover:text-text-primary">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <div className="flex flex-col gap-2">
            {modelAgg.map((m, i) => {
              const leader = i === 0 && modelAgg.length > 1;
              const podium = i < 3 && modelAgg.length > 1;
              return (
              <div
                key={m.key}
                className={`overflow-hidden rounded-xl border transition-colors ${
                  leader
                    ? "border-accent bg-gradient-to-r from-accent-soft/70 to-surface"
                    : podium
                      ? "border-accent-border/50 bg-surface"
                      : "border-border-subtle bg-surface"
                }`}
              >
                <button
                  onClick={() => setExpandedModel(expandedModel === m.key ? null : m.key)}
                  className={`flex w-full items-center gap-3 text-left hover:bg-surface-warm/60 ${leader ? "px-4 py-3" : "px-4 py-2"}`}
                >
                  {/* Rank */}
                  <span className={`flex shrink-0 items-center justify-center rounded-full font-mono font-bold ${
                    leader
                      ? "h-8 w-8 bg-accent text-background"
                      : podium
                        ? "h-6 w-6 border border-accent-border bg-accent-soft text-[11px] text-accent"
                        : "h-6 w-6 text-[11px] text-text-muted"
                  }`}>
                    {leader ? <Crown className="h-4 w-4" /> : i + 1}
                  </span>
                  <ProviderMark vendor={m.parsed.vendor} size={leader ? 28 : 22} />
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate font-display tracking-tight ${leader ? "text-base font-bold" : "text-sm font-semibold"}`}>
                      {m.parsed.model}
                    </span>
                    <span className="block font-mono text-[10px] text-text-muted">
                      {m.runs.length} run{m.runs.length === 1 ? "" : "s"} · {m.domains.length} domain{m.domains.length === 1 ? "" : "s"} · last {m.latestDate || "-"}
                    </span>
                  </span>
                  {/* Drift: score history + latest delta */}
                  {m.history.length >= 2 && (
                    <span className="hidden items-center gap-1.5 md:flex" title={`Judge scores over time: ${m.history.map((v) => v.toFixed(1)).join(" → ")}`}>
                      <Sparkline values={m.history} />
                      {m.delta !== null && Math.abs(m.delta) >= 0.05 && (
                        <span className={`font-mono text-[10px] font-semibold ${m.delta > 0 ? "text-ok" : "text-warn"}`}>
                          {m.delta > 0 ? "▲" : "▼"}{Math.abs(m.delta).toFixed(1)}
                        </span>
                      )}
                    </span>
                  )}
                  <div className="hidden w-32 lg:block"><ScoreBar value={m.best} max={10} color={scoreColor((m.best ?? 0) * 10)} /></div>
                  <span className={`shrink-0 text-right font-mono font-bold text-accent ${leader ? "w-16 text-2xl" : "w-12 text-sm"}`}>
                    {m.best?.toFixed(1) ?? "-"}
                  </span>
                </button>
                {expandedModel === m.key && (
                  <div className="border-t border-border-subtle bg-surface px-4 py-2">
                    {m.runs.map((r) => (
                      <div key={r.run_dir} className="flex w-full items-center gap-3 rounded px-2 py-1.5 hover:bg-surface-warm">
                        <button
                          onClick={() => r.scored && loadRun(r.run_dir)}
                          disabled={!r.scored}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default"
                        >
                          <span className="w-20 shrink-0 font-mono text-[10px] text-text-muted">{r.date || "undated"}</span>
                          <span className="flex min-w-0 flex-1 items-center gap-1">
                            {r.domains.slice(0, 6).map((d) => (
                              <span key={d} className="rounded bg-surface-warm px-1.5 py-0 font-mono text-[9px] text-text-muted">{d}</span>
                            ))}
                            {r.domains.length > 6 && <span className="font-mono text-[9px] text-text-muted">+{r.domains.length - 6}</span>}
                          </span>
                          <span className="font-mono text-[10px] text-text-muted">{r.questions} q</span>
                          {r.scored ? (
                            <span className="w-12 text-right font-mono text-xs font-semibold text-accent">{r.judge_avg?.toFixed(1) ?? "-"}</span>
                          ) : (
                            <span className="font-mono text-[10px] text-warn">unscored</span>
                          )}
                        </button>
                        <button
                          onClick={() => onRerun(r)}
                          title="Rerun: same model, same domains, as a fresh run"
                          className="shrink-0 rounded-md border border-border p-1 text-text-muted hover:border-accent-border hover:text-accent"
                        >
                          <RotateCw className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              );
            })}
          </div>
        </>
      )}

      {/* HISTORY — one card per BATCH (the models launched together),
          collapsed by default. The summary alone says when, what scope, how
          many models, and the session's best score. */}
      {resultsView === "history" && visibleRuns.length > 0 && (
        <div className="space-y-2">
          {runsByBatch.map((group) => {
            const best = group.runs.reduce<number | null>((acc, r) => (r.judge_avg === null ? acc : acc === null ? r.judge_avg : Math.max(acc, r.judge_avg)), null);
            const unscored = group.runs.filter((r) => !r.scored).length;
            return (
            <details key={group.key} className="group/date overflow-hidden rounded-2xl border border-border bg-surface">
              <summary className="flex cursor-pointer list-none items-center gap-2.5 px-4 py-2.5 hover:bg-surface-warm">
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-muted transition-transform group-open/date:rotate-90" />
                {group.isBatch && <span className="font-mono text-[12px] font-semibold text-text-primary">{group.date}</span>}
                <span className={`min-w-0 truncate font-mono text-[12px] ${group.isBatch ? "text-text-secondary" : "font-semibold text-text-primary"}`}>{group.label}</span>
                <span className="font-mono text-[10px] text-text-muted">{group.runs.length} model{group.runs.length === 1 ? "" : "s"}</span>
                {unscored > 0 && <span className="rounded bg-warn/10 px-1.5 py-0 font-mono text-[9px] text-warn">{unscored} unscored</span>}
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.preventDefault(); onRerunBatch(group.runs); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onRerunBatch(group.runs); } }}
                  title="Rerun this whole batch: every model in it, same domains, fresh runs"
                  className="ml-auto inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md border border-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent"
                >
                  <RotateCw className="h-3 w-3" /> rerun batch
                </span>
                <span className="font-mono text-[10px] text-text-muted">best</span>
                <span className="font-mono text-sm font-semibold text-accent">{best?.toFixed(1) ?? "-"}</span>
              </summary>
              <div className="space-y-1.5 border-t border-border-subtle px-3 py-2.5">
                {group.runs.map((r) => {
                  const parsed = parseRunLabel(r.label);
                  return (
                    <div
                      key={r.run_dir}
                      className="flex w-full items-center gap-3 rounded-lg border border-border-subtle bg-surface px-3 py-2 hover:bg-surface-warm"
                    >
                      <button
                        onClick={() => r.scored && loadRun(r.run_dir, { view: "History", batch: group.label })}
                        disabled={!r.scored}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default"
                      >
                        <ProviderMark vendor={parsed.vendor} size={22} />
                        <span className="min-w-0 truncate font-mono text-xs text-text-primary">{parsed.model || r.label}</span>
                        <span className="hidden items-center gap-1 md:flex">
                          {r.domains.slice(0, 5).map((d) => (
                            <span key={d} className="rounded bg-surface-warm px-1.5 py-0 font-mono text-[9px] text-text-muted">{d}</span>
                          ))}
                          {r.domains.length > 5 && <span className="font-mono text-[9px] text-text-muted">+{r.domains.length - 5}</span>}
                        </span>
                      </button>
                      <span className="font-mono text-[10px] text-text-muted">{r.questions} q</span>
                      {r.scored ? (
                        <>
                          <span className="w-12 text-right font-mono text-sm font-semibold text-accent">{r.judge_avg?.toFixed(1) ?? "-"}</span>
                          <span className="w-10 text-right font-mono text-[11px] text-text-muted">{r.keyword_avg !== null ? Math.round(r.keyword_avg) + "%" : "-"}</span>
                        </>
                      ) : (
                        <button
                          onClick={() => scoreNow(r)}
                          disabled={scoringRun !== null}
                          className="inline-flex items-center gap-1 rounded-md border border-warn/50 bg-warn/10 px-2 py-0.5 font-mono text-[10px] text-warn hover:bg-warn/20 disabled:opacity-50"
                        >
                          {scoringRun === r.run_dir ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                          {scoringRun === r.run_dir ? "scoring…" : "unscored · score now"}
                        </button>
                      )}
                      <button
                        onClick={() => onRerun(r)}
                        title="Rerun: same model, same domains, as a fresh run"
                        className="shrink-0 rounded-md border border-border p-1 text-text-muted hover:border-accent-border hover:text-accent"
                      >
                        <RotateCw className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </details>
            );
          })}
        </div>
      )}

      {resultsView === "matrix" && visibleRuns.length > 0 && (
        <BenchMatrix matrix={matrix} allDomains={allDomains} onPick={loadRun} />
      )}
    </div>
  );
}

// Model × domain pivot — rows are runs (models), columns are domains, cells
// are judge averages. Best cell per column is highlighted so "which model
// wins which domain" reads at a glance.
function BenchMatrix({
  matrix, allDomains, onPick,
}: {
  matrix: MatrixRow[];
  allDomains: string[];
  onPick: (runDir: string) => void;
}) {
  const bestPerDomain = useMemo(() => {
    const best: Record<string, number> = {};
    for (const d of allDomains) {
      let b = -1;
      for (const m of matrix) {
        const v = m.per_domain[d]?.judge_avg;
        if (v != null && v > b) b = v;
      }
      best[d] = b;
    }
    return best;
  }, [matrix, allDomains]);

  const rows = useMemo(
    () => [...matrix].sort((a, b) => (b.judge_avg ?? -1) - (a.judge_avg ?? -1)),
    [matrix],
  );

  if (allDomains.length === 0) return <div className="text-sm text-text-muted">No domain data yet.</div>;

  return (
    <div className="overflow-x-auto rounded-2xl border border-border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-surface">
            <th className="sticky left-0 bg-surface px-3 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-text-muted">Model</th>
            {allDomains.map((d) => (
              <th key={d} className="px-3 py-2 text-center font-mono text-[10px] uppercase tracking-wider text-text-muted">{titleCase(d)}</th>
            ))}
            <th className="px-3 py-2 text-center font-mono text-[10px] uppercase tracking-wider text-accent">Overall</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => {
            const parsed = parseRunLabel(m.label);
            return (
              <tr key={m.run_dir} className="border-b border-border-subtle last:border-0 hover:bg-surface-warm">
                <td className="sticky left-0 bg-background px-3 py-2">
                  <button onClick={() => onPick(m.run_dir)} className="inline-flex items-center gap-1.5 hover:text-accent">
                    <ProviderMark vendor={parsed.vendor} size={16} />
                    <span className="font-mono text-xs text-text-primary">{parsed.model || m.label}</span>
                  </button>
                </td>
                {allDomains.map((d) => {
                  const cell = m.per_domain[d];
                  const v = cell?.judge_avg ?? null;
                  const isBest = v != null && v === bestPerDomain[d] && v >= 0;
                  return (
                    <td key={d} className="px-3 py-2 text-center font-mono text-xs">
                      {v == null ? (
                        <span className="text-text-muted/40">-</span>
                      ) : (
                        <span
                          className={isBest ? "rounded px-1.5 py-0.5 font-semibold" : ""}
                          style={isBest ? { background: "var(--color-ok, #2e9e5b)", color: "#fff" } : { color: scoreColor(v * 10) }}
                        >
                          {v.toFixed(1)}
                        </span>
                      )}
                    </td>
                  );
                })}
                <td className="px-3 py-2 text-center font-mono text-xs font-semibold text-accent">{m.judge_avg?.toFixed(1) ?? "-"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BenchQuestions({
  vaultPath, questions, allDomains, initialDomain, onChanged,
}: {
  vaultPath: string;
  questions: BenchQuestion[];
  allDomains: string[];
  initialDomain?: string | null;
  onChanged: () => void;
}) {
  // Domain-scoped panel: show that domain's questions, not the whole suite.
  const [filter, setFilter] = useState<string>(initialDomain ? initialDomain.toLowerCase() : "all");
  const [editing, setEditing] = useState<BenchQuestion | "new" | null>(null);
  const blank: BenchQuestion = { id: "", domain: "", prompt: "", context: "", notes: "", council: false, expected_decision: "", expected_verdict_keywords: [], path: "" };
  const [draft, setDraft] = useState<BenchQuestion>(blank);
  const [saving, setSaving] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestDomain, setSuggestDomain] = useState<string>(initialDomain?.toLowerCase() ?? "");
  const [suggestCount, setSuggestCount] = useState(3);
  const [suggestModel, setSuggestModel] = useState(() => {
    if (!isBunkerOn()) return `claude${MODEL_SEP}opus`;
    // Bunker Mode: default to the first local provider's first model.
    const [cli, models] = Object.entries(MODELS).find(([c, ms]) => isLocalCli(c) && ms.length > 0) ?? [];
    return cli && models ? `${cli}${MODEL_SEP}${models[0].id}` : `claude${MODEL_SEP}opus`;
  });

  const inFilter = filter === "all" ? questions : questions.filter((q) => q.domain === filter);
  const shown = inFilter.filter((q) => !q.archived);
  const archivedShown = inFilter.filter((q) => q.archived);
  async function setArchived(q: BenchQuestion, archived: boolean) {
    try {
      await invoke("benchmark_set_question_archived", { path: q.path, archived });
      onChanged();
    } catch (e) { setInfo(`Archive failed: ${e}`); }
  }

  // Export the whole suite as one portable prevail.bench/v1 JSON file.
  async function exportQuestions() {
    try {
      const dest = await saveFileDialog({
        defaultPath: "prevail-bench-questions.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!dest) return;
      await invoke("benchmark_export_questions", { vault: vaultPath, dest });
      setInfo(`Exported ${questions.length} question${questions.length === 1 ? "" : "s"} to ${dest.split("/").pop()}`);
    } catch (e) {
      setInfo(`Export failed: ${e}`);
    }
  }

  // Import a prevail.bench/v1 file; existing ids are skipped, never overwritten.
  async function importQuestions() {
    try {
      const picked = await open({ filters: [{ name: "JSON", extensions: ["json"] }], multiple: false });
      const path = typeof picked === "string" ? picked : null;
      if (!path) return;
      const json = await invoke<string>("read_file", { path });
      const report = await invoke<{ created: string[]; skipped: string[] }>("benchmark_import_questions", { vault: vaultPath, json });
      setInfo(`Imported ${report.created.length} question${report.created.length === 1 ? "" : "s"}${report.skipped.length ? `, skipped ${report.skipped.length} (already exist or malformed)` : ""}`);
      onChanged();
    } catch (e) {
      setInfo(`Import failed: ${e}`);
    }
  }

  // AI-draft questions from each domain's own context, via the engine's
  // `bench suggest`. Drafts land in the list for review/editing.
  async function suggestWithAi() {
    const domain = suggestDomain.trim().toLowerCase();
    if (!domain) return;
    const [cli, model] = suggestModel.split(MODEL_SEP);
    const session = `bench-suggest-${Date.now()}`;
    setSuggesting(true);
    setInfo(null);
    let output = "";
    let chunkUn: UnlistenFn | null = null;
    try {
      listen<{ session: string; data: string }>("benchmark:chunk", (e) => {
        if (e.payload.session === session) output = (output + e.payload.data).slice(-2000);
      }).then((u) => { chunkUn = u; });
      const done = new Promise<number | null>((resolve) => {
        let un: UnlistenFn | null = null;
        listen<{ session: string; code: number | null; phase: string }>("benchmark:done", (e) => {
          if (e.payload.session === session && e.payload.phase === "suggest") { un?.(); resolve(e.payload.code); }
        }).then((u) => { un = u; });
      });
      await invoke("benchmark_suggest", {
        args: { session_id: session, vault: vaultPath, domain, count: suggestCount, cli, model: model || null },
      });
      const code = await done;
      if (code === 0 || code === null) {
        setInfo(
          domain === "all"
            ? `Drafted ${suggestCount} question${suggestCount === 1 ? "" : "s"} per domain, across all domains. Review the ground truth before trusting scores.`
            : `Drafted ${suggestCount} question${suggestCount === 1 ? "" : "s"} for ${titleCase(domain)}. Review the ground truth before trusting scores.`,
        );
        setSuggestOpen(false);
        onChanged();
      } else {
        const tail = output.trim().split("\n").filter(Boolean).slice(-2).join(" / ");
        setInfo(`Suggest failed (exit ${code})${tail ? `: ${tail}` : ""}`);
      }
    } catch (e) {
      setInfo(`Suggest failed: ${e}`);
    } finally {
      void (async () => { (chunkUn as UnlistenFn | null)?.(); })();
      setSuggesting(false);
    }
  }

  const openEditor = (q: BenchQuestion | "new") => {
    setEditing(q);
    setDraft(q === "new" ? blank : { ...q });
  };

  async function save() {
    if (!draft.domain.trim() || !draft.prompt.trim()) return;
    setSaving(true);
    try {
      await invoke("benchmark_save_question", {
        vault: vaultPath,
        q: {
          id: draft.id || null,
          domain: draft.domain.trim().toLowerCase(),
          prompt: draft.prompt,
          context: draft.context,
          notes: draft.notes,
          council: draft.council,
          expected_decision: draft.expected_decision,
          expected_verdict_keywords: draft.expected_verdict_keywords,
        },
      });
      setEditing(null);
      onChanged();
    } finally {
      setSaving(false);
    }
  }
  async function remove(q: BenchQuestion) {
    const ok = await tauriConfirm(`Delete benchmark question "${q.id}"?`, { title: "Delete question", kind: "warning" });
    if (!ok) return;
    await invoke("benchmark_delete_question", { path: q.path });
    if (editing !== "new" && editing && editing.id === q.id) setEditing(null);
    onChanged();
  }

  if (editing) {
    return (
      <div className="w-full px-8 py-5">
        <BenchCrumbs
          items={[
            { label: "Benchmark" },
            { label: "Questions", onClick: () => setEditing(null) },
            { label: editing === "new" ? "New question" : draft.id },
          ]}
        />
        <div className="max-w-3xl space-y-4">
        <h2 className="font-display text-xl font-bold tracking-tight">{editing === "new" ? "New question" : draft.id}</h2>
        <Field label="Domain">
          <input value={draft.domain} onChange={(e) => setDraft({ ...draft, domain: e.target.value })} list="bench-domains" placeholder="wealth" className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
          <datalist id="bench-domains">{allDomains.map((d) => <option key={d} value={d} />)}</datalist>
        </Field>
        <Field label="Prompt: the question as you'd ask it">
          <textarea value={draft.prompt} onChange={(e) => setDraft({ ...draft, prompt: e.target.value })} rows={3} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
        </Field>
        <Field label="Context: facts the model needs (numbers, dates)">
          <textarea value={draft.context} onChange={(e) => setDraft({ ...draft, context: e.target.value })} rows={3} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
        </Field>
        <Field label="Expected decision: your real ground-truth answer">
          <input value={draft.expected_decision} onChange={(e) => setDraft({ ...draft, expected_decision: e.target.value })} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
        </Field>
        <Field label="Expected keywords: comma-separated, for the mechanical floor">
          <input
            value={draft.expected_verdict_keywords.join(", ")}
            onChange={(e) => setDraft({ ...draft, expected_verdict_keywords: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
            placeholder="liquidity, 6 month floor, diversify"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Notes: what you actually decided, and why">
          <textarea value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} rows={2} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
        </Field>
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          <input type="checkbox" checked={draft.council} onChange={(e) => setDraft({ ...draft, council: e.target.checked })} />
          Run via council (multi-model panel) by default
        </label>
        <div className="flex items-center gap-2 pt-2">
          <button onClick={save} disabled={saving || !draft.domain.trim() || !draft.prompt.trim()} className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-background hover:bg-accent-hover disabled:opacity-40">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save
          </button>
          {editing !== "new" && (
            <button onClick={() => remove(draft)} className="inline-flex items-center gap-1.5 rounded-lg border border-danger/40 px-3 py-2 text-sm text-danger hover:bg-danger/10">
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          )}
        </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full px-8 py-5">
      <BenchCrumbs
        items={[
          { label: "Benchmark" },
          { label: "Questions" },
          ...(filter !== "all" ? [{ label: titleCase(filter) }] : []),
        ]}
        meta={`${shown.length} of ${questions.length} question${questions.length === 1 ? "" : "s"}`}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] text-text-secondary">
          <option value="all">all domains</option>
          {allDomains.map((d) => <option key={d} value={d}>{titleCase(d)}</option>)}
        </select>
        <div className="flex-1" />
        <button onClick={importQuestions} title="Import a prevail.bench/v1 JSON file (existing ids are skipped)" className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 font-mono text-[11px] text-text-secondary hover:border-accent-border hover:text-accent">
          <Download className="h-3 w-3" /> Import
        </button>
        <button onClick={exportQuestions} disabled={questions.length === 0} title="Export every question as one portable JSON file" className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 font-mono text-[11px] text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-40">
          <Upload className="h-3 w-3" /> Export
        </button>
        <button onClick={() => { setSuggestOpen((v) => !v); if (!suggestDomain && filter !== "all") setSuggestDomain(filter); }} title="AI-draft questions from a domain's recorded context" className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[11px] ${suggestOpen ? "border-accent-border bg-accent-soft text-accent" : "border-border text-text-secondary hover:border-accent-border hover:text-accent"}`}>
          <Sparkles className="h-3 w-3" /> Suggest with AI
        </button>
        <button onClick={() => openEditor("new")} className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 font-mono text-[11px] text-background hover:bg-accent-hover">
          <Plus className="h-3 w-3" /> New question
        </button>
      </div>
      {suggestOpen && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">Draft from context:</span>
          <select value={suggestDomain} onChange={(e) => setSuggestDomain(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] text-text-secondary">
            <option value="">pick a domain…</option>
            <option value="all">All domains</option>
            {allDomains.map((d) => <option key={d} value={d}>{titleCase(d)}</option>)}
          </select>
          <select value={suggestCount} onChange={(e) => setSuggestCount(Number(e.target.value))} className="rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] text-text-secondary">
            {[1, 2, 3, 5, 8].map((n) => <option key={n} value={n}>{n} question{n === 1 ? "" : "s"}{suggestDomain === "all" ? " per domain" : ""}</option>)}
          </select>
          <select value={suggestModel} onChange={(e) => setSuggestModel(e.target.value)} title="Model that drafts the questions" className="rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] text-text-secondary">
            {Object.entries(MODELS)
              .filter(([cli]) => !isBunkerOn() || isLocalCli(cli))
              .flatMap(([cli, models]) =>
                models.map((m) => (
                  <option key={`${cli}${MODEL_SEP}${m.id}`} value={`${cli}${MODEL_SEP}${m.id}`}>{titleCase(cli)} · {m.label}</option>
                )),
              )}
          </select>
          <button onClick={suggestWithAi} disabled={suggesting || !suggestDomain} className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 font-mono text-[11px] text-background hover:bg-accent-hover disabled:opacity-40">
            {suggesting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            {suggesting ? "Drafting…" : "Draft"}
          </button>
          <span className="text-[10px] text-text-muted">Reads each domain's state, goals, and decisions (fresh domains use goals/config). Drafts are marked for your review.</span>
        </div>
      )}
      {info && (
        <div className="mb-4 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-xs text-text-secondary">{info}</div>
      )}
      {shown.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-sm text-text-muted">
          No questions{filter !== "all" ? ` in ${titleCase(filter)}` : ""} yet. Hit <span className="text-accent">New question</span>, <span className="text-accent">Suggest with AI</span>, or <span className="text-accent">Import</span> to add some.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border">
          {shown.map((q) => (
            <div key={q.id} className="flex w-full items-start gap-3 border-b border-border-subtle px-4 py-3 text-left last:border-0 hover:bg-surface-warm">
              <button onClick={() => openEditor(q)} className="flex min-w-0 flex-1 items-start gap-3 text-left">
                <span className="mt-0.5 rounded bg-surface-warm px-1.5 py-0.5 font-mono text-[10px] text-text-muted">{q.domain}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-text-primary">{q.prompt || <span className="text-text-muted">(empty prompt)</span>}</div>
                  {q.expected_decision && <div className="mt-0.5 truncate text-[11px] text-ok">→ {q.expected_decision}</div>}
                  <div className="mt-0.5 font-mono text-[9px] text-text-muted">
                    {q.source === "ai" ? "AI-suggested" : "written by you"}{q.created ? ` · added ${q.created}` : ""}{q.edited ? ` · edited ${q.edited} (prior version kept)` : ""}
                  </div>
                </div>
                {q.council && <Scale className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted" />}
              </button>
              <button
                onClick={() => void setArchived(q, true)}
                title="Archive: kept for past runs, excluded from new ones"
                className="mt-0.5 shrink-0 rounded-md border border-border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent"
              >
                <Archive className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      {archivedShown.length > 0 && (
        <details className="mt-3 rounded-xl border border-border-subtle bg-surface px-3 py-2">
          <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
            Archived · {archivedShown.length}: kept so past benchmark runs stay interpretable
          </summary>
          <div className="mt-2 flex flex-col">
            {archivedShown.map((q) => (
              <div key={q.id} className="flex items-start gap-3 border-b border-border-subtle px-1 py-2 last:border-0">
                <span className="mt-0.5 rounded bg-surface-warm px-1.5 py-0.5 font-mono text-[10px] text-text-muted">{q.domain}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-text-muted">{q.prompt}</div>
                  <div className="mt-0.5 font-mono text-[9px] text-text-muted">
                    {q.source === "ai" ? "AI-suggested" : "written by you"}{q.created ? ` · added ${q.created}` : ""}
                  </div>
                </div>
                <button
                  onClick={() => void setArchived(q, false)}
                  className="shrink-0 rounded-md border border-border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent"
                >
                  Restore
                </button>
                <button
                  onClick={async () => { try { await invoke("benchmark_delete_question", { path: q.path }); onChanged(); } catch (e) { setInfo(`Delete failed: ${e}`); } }}
                  title="Delete permanently (past runs lose this question's text)"
                  className="shrink-0 rounded-md border border-border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted hover:border-warn hover:text-warn"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────
// SETTINGS PANEL — vault, theme, defaults, about

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
function ModelsSection({
  clis,
  onStartChatWith,
  onActivated,
}: {
  clis: CliInfo[];
  onStartChatWith?: (cliId: string, modelId?: string) => void;
  onActivated?: () => Promise<CliInfo[]>;
}) {
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (id: string) => setOpenGroups((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const firstAvailable = useMemo(() => clis.find((c) => c.available)?.id ?? "", [clis]);
  const [defaultChatCli, setDefaultChatCli] = useState(() => lsGet(LS.defaultChatCli) || firstAvailable);
  useEffect(() => { if (defaultChatCli) lsSet(LS.defaultChatCli, defaultChatCli); }, [defaultChatCli]);
  useEffect(() => {
    if (!defaultChatCli && firstAvailable) setDefaultChatCli(firstAvailable);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstAvailable]);
  // Live model discovery: pull each provider's current models so newly released
  // ones appear without a code change. Runs once on launch + a manual Refresh.
  const [refreshing, setRefreshing] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  const [refreshPeriod, setRefreshPeriod] = useState(() => lsGet("prevail.models.refreshPeriod") || "daily");
  const verify = useCliVerifyLive();
  const discover = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshDiscoveredModels(["ollama", "lmstudio", "openrouter"]);
      const now = Date.now();
      setRefreshedAt(now);
      lsSet("prevail.models.lastRefreshed", String(now));
    } finally { setRefreshing(false); }
  }, []);
  // Auto-discover based on schedule: compare last refresh to the chosen period.
  useEffect(() => {
    const periodMs: Record<string, number> = {
      launch: 0,
      daily: 86_400_000,
      "2days": 2 * 86_400_000,
      "3days": 3 * 86_400_000,
      weekly: 7 * 86_400_000,
      "2weeks": 14 * 86_400_000,
      monthly: 30 * 86_400_000,
      "3months": 91 * 86_400_000,
      "6months": 182 * 86_400_000,
      manual: Infinity,
    };
    const ms = periodMs[refreshPeriod] ?? 0;
    if (ms === Infinity) return;
    const last = parseInt(lsGet("prevail.models.lastRefreshed") || "0", 10);
    if (Date.now() - last >= ms) void discover();
  }, [discover, refreshPeriod]);
  // Re-check = re-discover model lists AND re-validate every detected
  // provider; the status badges flip to "checking" live, so the click
  // visibly does something.
  const recheck = useCallback(async () => {
    autoVerifyClis(clis, true);
    await discover();
  }, [clis, discover]);
  const detectedClis = clis.filter((c) => c.available);
  const okCount = detectedClis.filter((c) => verify.get(c.id)?.status === "ok").length;
  return (
    <>
      <SettingsHeader
        title="Models"
        icon={Layers}
        subtitle="Every provider Prevail can use. Each one is validated automatically at launch with a real call: binary, login, and model all have to work. Expand a provider to test individual models and set the default a new chat opens with."
      />
      {/* Validity at a glance: one badged mark per detected provider. */}
      <div className="mb-4 flex flex-wrap items-center gap-4 rounded-lg border border-border-subtle bg-surface px-4 py-2.5">
        <div className="flex items-center gap-3.5">
          {detectedClis.map((c) => {
            const v = verify.get(c.id)?.status;
            return (
              <span
                key={c.id}
                className="relative"
                title={`${c.label}: ${v === "ok" ? "valid" : v === "failed" ? "not valid" : v === "verifying" ? "checking…" : "not checked"}`}
              >
                <ProviderMark vendor={c.id} size={22} />
                <span className={`absolute -bottom-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] font-bold leading-none ${
                  v === "ok" ? "bg-ok text-background"
                  : v === "failed" ? "bg-warn text-background"
                  : v === "verifying" ? "animate-pulse bg-text-muted text-background"
                  : "bg-surface-strong text-text-muted"
                }`}>
                  {v === "ok" ? "✓" : v === "failed" ? "✗" : v === "verifying" ? "·" : "○"}
                </span>
              </span>
            );
          })}
        </div>
        <span className="font-mono text-[10px] text-text-muted">
          {okCount}/{detectedClis.length} providers valid
          {refreshedAt ? ` · lists updated ${Math.max(1, Math.round((Date.now() - refreshedAt) / 1000))}s ago` : ""}
        </span>
        <select
          value={refreshPeriod}
          onChange={(e) => { setRefreshPeriod(e.target.value); lsSet("prevail.models.refreshPeriod", e.target.value); }}
          className="rounded border border-border bg-background px-2 py-1 font-mono text-[10px] text-text-muted focus:border-accent-border focus:outline-none"
          title="How often model lists auto-refresh"
        >
          <option value="launch">Every launch</option>
          <option value="daily">Daily</option>
          <option value="2days">Every other day</option>
          <option value="3days">Every 3 days</option>
          <option value="weekly">Weekly</option>
          <option value="2weeks">Every 2 weeks</option>
          <option value="monthly">Monthly</option>
          <option value="3months">Every 3 months</option>
          <option value="6months">Every 6 months</option>
          <option value="manual">Manual only</option>
        </select>
        <button
          onClick={() => void recheck()}
          disabled={refreshing}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent disabled:opacity-50"
        >
          <RotateCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
          Re-check all
        </button>
      </div>
      {/* Three collapsible groups — all collapsed by default for a clean landing */}
      {([
        {
          id: "clis",
          label: "Installed CLIs",
          icon: Sparkles,
          desc: `${clis.filter((c) => c.available).length} detected · ${clis.filter((c) => !c.available).length} not installed`,
          content: (
            <AgentsSection
              clis={clis}
              onStartChatWith={onStartChatWith}
              defaultChatCli={defaultChatCli}
              onMakeDefault={setDefaultChatCli}
              embedded
            />
          ),
        },
        {
          id: "api",
          label: "API Providers",
          icon: Layers,
          desc: "OpenRouter, AWS Bedrock: one key for hundreds of models",
          content: (
            <>
              <p className="mb-4 text-xs text-text-muted">Bring your own key, no install. OpenRouter is one key for 200+ hosted models.</p>
              <ProvidersSection onActivated={onActivated} embedded />
            </>
          ),
        },
        {
          id: "direct",
          label: "Direct Providers",
          icon: Globe,
          desc: "Anthropic, OpenAI, Google: native API keys",
          content: (
            <div className="rounded-lg border border-border-subtle bg-surface px-4 py-4 text-xs text-text-muted">
              Native single-vendor keys (Anthropic API, OpenAI API, Google AI) are coming next. Use OpenRouter above to access all of these today with one key.
            </div>
          ),
        },
      ] as const).map(({ id, label, icon: Icon, desc, content }) => {
        const isOpen = openGroups.has(id);
        return (
          <div key={id} className="mb-2 overflow-hidden rounded-lg border border-border-subtle bg-surface">
            <button
              onClick={() => toggleGroup(id)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-warm"
            >
              <Icon className="h-4 w-4 shrink-0 text-text-muted" />
              <span className="flex-1 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-text-primary">{label}</span>
              <span className="shrink-0 font-mono text-[10px] text-text-muted/60">{desc}</span>
              <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-text-muted transition-transform ${isOpen ? "rotate-90" : ""}`} strokeWidth={2.5} />
            </button>
            {isOpen && <div className="border-t border-border-subtle px-4 py-4">{content}</div>}
          </div>
        );
      })}
    </>
  );
}

function AgentsSection({
  clis,
  onStartChatWith,
  embedded,
  defaultChatCli,
  onMakeDefault,
}: {
  clis: CliInfo[];
  onStartChatWith?: (cliId: string, modelId?: string) => void;
  embedded?: boolean;
  defaultChatCli?: string;
  onMakeDefault?: (cliId: string) => void;
}) {
  const detected = clis.filter((c) => c.available);
  const missing = clis.filter((c) => !c.available);
  // Detected (the active set) opens by default; Not installed stays collapsed
  // so the landing view shows only what's usable. Both are individually
  // collapsible per the collapse-and-indent convention.
  const [showDetected, setShowDetected] = useState(true);
  const [showMissing, setShowMissing] = useState(false);
  return (
    <>
      {!embedded && (
        <SettingsHeader
          title="Agents"
          subtitle="CLIs Prevail can route prompts to. Each agent is detected from your machine. Prevail doesn't install or update them."
        />
      )}
      {detected.length > 0 && (
        <section className="mb-6">
          <button
            onClick={() => setShowDetected((v) => !v)}
            className="mb-2 flex w-full items-center gap-2 text-left"
          >
            <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-text-muted transition-transform ${showDetected ? "rotate-90" : ""}`} strokeWidth={2.5} />
            <GroupLabel className="mb-0">Detected · {detected.length}</GroupLabel>
          </button>
          {showDetected && (
            <div className="flex flex-col gap-3 pl-5">
              {detected.map((c) => (
                <AgentCard
                  key={c.id}
                  cli={c}
                  onStartChat={onStartChatWith}
                  isDefault={defaultChatCli === c.id}
                  onMakeDefault={onMakeDefault ? () => onMakeDefault(c.id) : undefined}
                />
              ))}
            </div>
          )}
        </section>
      )}
      {missing.length > 0 && (
        <section>
          <button
            onClick={() => setShowMissing((v) => !v)}
            className="mb-2 flex w-full items-center gap-2 text-left"
          >
            <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-text-muted transition-transform ${showMissing ? "rotate-90" : ""}`} strokeWidth={2.5} />
            <GroupLabel className="mb-0">Not installed · {missing.length}</GroupLabel>
          </button>
          {showMissing && (
            <div className="flex flex-col gap-3 pl-5">
              {missing.map((c) => (
                <AgentCard key={c.id} cli={c} onStartChat={onStartChatWith} />
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}


const CLI_LOGIN_CMD: Record<string, string> = {
  claude: "claude",
  codex: "codex login",
  antigravity: "agy login",
};

// When a verify error is an auth failure (CLI installed but not signed in),
// return the login command (or "" if the CLI is unknown). Returns null when
// the error isn't auth-related, so the raw message keeps showing.
function authLoginCmd(cliId: string, raw: string): string | null {
  const isAuth = /\b401\b|invalid authentication|failed to authenticate|unauthorized|not (?:logged|signed) in|please (?:run )?.*login/i.test(raw);
  if (!isAuth) return null;
  return CLI_LOGIN_CMD[cliId] ?? "";
}

function AgentCard({
  cli,
  onStartChat,
  isDefault,
  onMakeDefault,
}: {
  cli: CliInfo;
  onStartChat?: (cliId: string, modelId?: string) => void;
  isDefault?: boolean;
  onMakeDefault?: () => void;
}) {
  const brand = VENDOR_BRAND[cli.id] ?? VENDOR_BRAND.other;
  const liveVerify = useCliVerifyLive();
  // Re-render when live discovery fills in new models.
  const [, setModelsNonce] = useState(0);
  useEffect(() => {
    const h = () => setModelsNonce((n) => n + 1);
    window.addEventListener("prevail:models-refreshed", h);
    return () => window.removeEventListener("prevail:models-refreshed", h);
  }, []);
  const models = modelsFor(cli.id);
  const [open, setOpen] = useState(false);
  // The provider's default model (what a new chat uses). Set right here in
  // Models, so there's no separate Defaults page.
  const modelKey = `prevail.model.${cli.id}`;
  const [defaultModel, setDefaultModel] = useState(() => lsGet(modelKey) || models[0]?.id || "");
  useEffect(() => { if (defaultModel) lsSet(modelKey, defaultModel); }, [modelKey, defaultModel]);
  const setAsDefault = (modelId: string) => { setDefaultModel(modelId); onMakeDefault?.(); };
  const [status, setStatus] = useState<Record<string, ModelVerifyStatus>>(() => {
    const map = loadVerifyMap();
    const out: Record<string, ModelVerifyStatus> = {};
    for (const m of models) {
      const key = `${cli.id}:${m.id}`;
      if (map[key] === "ok") out[m.id] = "ok";
    }
    return out;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function verifyModel(modelId: string) {
    setStatus((s) => ({ ...s, [modelId]: "verifying" }));
    try {
      await invoke<string>("verify_cli_model", {
        args: { cli: cli.id, model: modelId || null },
      });
      setStatus((s) => {
        const next = { ...s, [modelId]: "ok" as ModelVerifyStatus };
        const map = loadVerifyMap();
        map[`${cli.id}:${modelId}`] = "ok";
        saveVerifyMap(map);
        return next;
      });
      setErrors((e) => { const { [modelId]: _, ...rest } = e; return rest; });
      setCliVerify(cli.id, { status: "ok" }); // any working model = usable provider
    } catch (e) {
      setStatus((s) => ({ ...s, [modelId]: "failed" }));
      setErrors((er) => ({ ...er, [modelId]: String(e).slice(0, 200) }));
      // Only demote the provider when nothing of it has verified ok.
      if (cliVerifyLive.get(cli.id)?.status !== "ok") {
        setCliVerify(cli.id, { status: "failed", error: String(e).slice(0, 200) });
      }
    }
  }

  function verifyAll() {
    for (const m of models) {
      if (status[m.id] === "ok" || status[m.id] === "verifying") continue;
      void verifyModel(m.id);
    }
  }

  // Auto-run verification when the card is opened the first time
  // and there are unverified models in the list.
  useEffect(() => {
    if (!open) return;
    const unverified = models.some((m) => status[m.id] !== "ok");
    if (unverified) verifyAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function StatusGlyph({ s }: { s: ModelVerifyStatus | undefined }) {
    if (s === "ok") return <span className="text-accent" title="Verified">✓</span>;
    if (s === "verifying") return <span className="text-text-muted animate-pulse" title="Verifying…">◐</span>;
    if (s === "failed") return <span className="text-warn" title="Failed verification">✗</span>;
    return <span className="text-text-muted/60" title="Not yet verified">○</span>;
  }

  const cliErr = liveVerify.get(cli.id);
  return (
    <div className={`rounded-lg border bg-surface transition-colors ${open ? "border-accent-border" : "border-border-subtle"}`}>
      {/* Single-line header — same row dimensions as every other settings list. */}
      <div className="flex items-center gap-3 px-4 py-3">
        <ProviderMark vendor={cli.id} size={30} />
        <button
          onClick={() => cli.available && setOpen((v) => !v)}
          disabled={!cli.available || models.length === 0}
          className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
        >
          {cli.available && models.length > 0 && (
            <span className="shrink-0 text-[11px] text-text-muted">{open ? "▾" : "▸"}</span>
          )}
          <span className="shrink-0 font-display text-sm font-semibold tracking-tight">{cli.label}</span>
          {(() => {
            const v = cli.available ? cliVerifyLive.get(cli.id) : undefined;
            const chip = !cli.available
              ? { cls: "border-border bg-background text-text-muted", label: "Not installed" }
              : v?.status === "ok"
                ? { cls: "border-accent-border bg-accent-soft text-accent", label: "✓ Valid" }
                : v?.status === "failed"
                  ? { cls: "border-warn/40 bg-warn/10 text-warn", label: "✗ Not valid" }
                  : v?.status === "verifying"
                    ? { cls: "border-border bg-background text-text-muted animate-pulse", label: "◐ Checking" }
                    : { cls: "border-border bg-background text-text-muted", label: "Detected" };
            return (
              <span className={`shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] ${chip.cls}`}>
                {chip.label}
              </span>
            );
          })()}
          {isDefault && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-background">
              <Check className="h-2.5 w-2.5" strokeWidth={3} /> Default
            </span>
          )}
          {cli.available && models.length > 0 && (
            <span className="shrink-0 font-mono text-[10px] text-text-muted">{models.filter((m) => status[m.id] === "ok").length}/{models.length} verified</span>
          )}
          <span className="truncate font-mono text-[10px] text-text-muted/70">
            {cli.available ? (cli.version ?? `${cli.bin} in PATH`) : `install ${cli.bin}`} · {brand.name}
          </span>
        </button>
        <button
          onClick={() => cli.available && onStartChat?.(cli.id)}
          disabled={!cli.available}
          className={`shrink-0 rounded-md border px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors ${
            cli.available
              ? "border-accent-border bg-accent-soft text-accent hover:bg-accent hover:text-background"
              : "cursor-not-allowed border-border bg-background text-text-muted/60"
          }`}
        >
          Start chat
        </button>
      </div>

      {/* Why it's not valid, on the card face: usually an auth/token problem,
          so lead with the fix (the login command) rather than the stack. */}
      {cli.available && cliErr?.status === "failed" && cliErr.error && (
        <div className="flex items-start gap-2 border-t border-border-subtle bg-warn/5 px-4 py-2">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />
          <div className="min-w-0 flex-1">
            {(() => {
              const loginCmd = authLoginCmd(cli.id, cliErr.error ?? "");
              return loginCmd ? (
                <span className="text-xs text-text-secondary">
                  Not signed in. Run <code className="rounded bg-surface-warm px-1.5 py-0.5 font-mono text-[11px] text-accent">{loginCmd}</code> in a terminal, then hit Re-check.
                </span>
              ) : (
                <span className="line-clamp-2 text-xs text-text-secondary">{cliErr.error}</span>
              );
            })()}
          </div>
          <button
            onClick={() => void verifyCliDefaultModel(cli.id)}
            className="shrink-0 rounded-md border border-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent"
          >
            Re-check
          </button>
        </div>
      )}

      {open && cli.available && models.length > 0 && (
        <div className="border-t border-border-subtle px-4 py-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">
              Models · {models.length}
            </div>
            <button
              onClick={verifyAll}
              className="rounded-md border border-border bg-background px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent"
            >
              re-verify all
            </button>
          </div>
          <div className="flex flex-col gap-1.5">
            {models.map((m) => {
              const s = status[m.id];
              const err = errors[m.id];
              return (
                <div key={m.id} className={`flex items-start gap-3 rounded-md border px-3 py-2 ${defaultModel === m.id ? "border-accent-border bg-accent-soft" : "border-border-subtle bg-background"}`}>
                  <div className="mt-0.5 w-3 shrink-0 text-center text-[12px] leading-none">
                    <StatusGlyph s={s} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-mono text-sm text-text-primary">{m.label}</span>
                      {defaultModel === m.id && <span className="rounded-full bg-accent px-1.5 py-0 font-mono text-[8px] uppercase tracking-wider text-background">default</span>}
                      {m.blurb && <span className="text-[11px] text-text-muted">{m.blurb}</span>}
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-text-muted/80">
                      <code className="text-accent">{m.id}</code>
                      {s === "failed" && err && (() => {
                        const loginCmd = authLoginCmd(cli.id, err);
                        // Not an auth error → show the raw message as before.
                        if (loginCmd === null) return <span className="ml-2 text-warn">· {err}</span>;
                        // Auth error → actionable hint; raw error on hover.
                        return (
                          <span className="ml-2 text-warn" title={err}>
                            · not signed in: run{" "}
                            {loginCmd
                              ? <code className="text-accent">{loginCmd}</code>
                              : "this CLI's login"}{" "}
                            in a terminal, then re-test
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => {
                        // Jump to the Benchmark cockpit with this model's runs
                        // expanded (key matches the leaderboard aggregation).
                        lsSet("prevail.bench.expandModel", `${cli.id}::${m.label}`);
                        window.dispatchEvent(new CustomEvent("prevail:settings-section", { detail: "benchmark" }));
                      }}
                      title={`Benchmark runs for ${m.label}: scores, domains, history`}
                      className="rounded-md border border-border bg-background px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent"
                    >
                      runs
                    </button>
                    <button
                      onClick={() => verifyModel(m.id)}
                      disabled={s === "verifying"}
                      className="rounded-md border border-border bg-background px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent disabled:opacity-40"
                    >
                      {s === "verifying" ? "testing…" : s === "ok" ? "re-test" : "test"}
                    </button>
                    {defaultModel === m.id ? (
                      <span className="rounded-md border border-accent-border bg-accent-soft px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-accent">default</span>
                    ) : (
                      <button
                        onClick={() => setAsDefault(m.id)}
                        title="Use this model by default for new chats"
                        className="rounded-md border border-border bg-background px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent"
                      >
                        set default
                      </button>
                    )}
                    <button
                      onClick={() => onStartChat?.(cli.id, m.id)}
                      className={`rounded-md border px-2 py-1 font-mono text-[9px] uppercase tracking-wider ${
                        s === "ok"
                          ? "border-accent-border bg-accent-soft text-accent hover:bg-accent hover:text-background"
                          : "border-border bg-background text-text-secondary hover:bg-surface-warm"
                      }`}
                    >
                      chat
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// Pick a representative icon for a settings page from its title, so every
// header gets a matching glyph without threading an icon through 20 call sites.
function settingsHeaderIcon(title: string): typeof Folder {
  const t = title.toLowerCase();
  if (/privacy/.test(t)) return ShieldCheck;
  if (/council/.test(t)) return Scale;
  if (/framework|lens/.test(t)) return Scale;
  if (/skill/.test(t)) return Sparkles;
  if (/model|agent|provider/.test(t)) return Layers;
  if (/safety/.test(t)) return Shield;
  if (/gateway/.test(t)) return MessagesSquare;
  if (/remote|webui/.test(t)) return Monitor;
  if (/mcp/.test(t)) return Wrench;
  if (/vault/.test(t)) return Folder;
  if (/memory|context/.test(t)) return Brain;
  if (/about me|user|profile/.test(t)) return Users;
  if (/appearance/.test(t)) return Sparkles;
  if (/shortcut/.test(t)) return SettingsIcon;
  if (/connector|integration|ingest/.test(t)) return Plug;
  if (/about/.test(t)) return Github;
  return SettingsIcon;
}

function SettingsHeader({ title, subtitle, icon }: { title: string; subtitle?: string; icon?: typeof Folder }) {
  const Icon = icon ?? settingsHeaderIcon(title);
  return (
    <div className="mb-4 border-b border-border-subtle pb-4">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent ring-1 ring-accent-border/50">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 pt-0.5">
          <h2 className="font-display text-[26px] font-bold leading-tight tracking-tight">{title}</h2>
          {subtitle && <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-text-secondary">{subtitle}</p>}
        </div>
      </div>
    </div>
  );
}

// Header hierarchy, level 2: a subsection within a settings page. Sits clearly
// below the big SettingsHeader (level 1) and above the small mono group labels
// (level 3), so the eye reads page -> subsection -> group without guessing.
// Display-weight, sentence case, with a hairline rule underneath.

// Header hierarchy, level 3: a small group label inside a subsection (e.g.
// "Detected · 2"). The quietest of the three so it never competes with a
// level-2 SubsectionHeader.

// Privacy & Connectivity — the Bunker Mode control surface. The toggle + status
// card here reflect the BACKEND policy (bunker.rs), which is the real source of
// truth and enforcer; this screen never decides anything on its own.
function PrivacyConnectivitySection({ enabled, onChange }: { enabled: boolean; onChange: (on: boolean) => void }) {
  type BunkerStatus = { enabled: boolean; network_blocked: boolean; web_blocked: boolean; cloud_blocked: boolean; local_available: boolean };
  const [status, setStatus] = useState<BunkerStatus | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => {
    invoke<BunkerStatus>("bunker_status").then(setStatus).catch(() => {});
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  async function setBunker(on: boolean) {
    setBusy(true);
    try {
      const s = await invoke<BunkerStatus>("bunker_set", { enabled: on });
      setStatus(s);
      onChange(!!s.enabled);
    } catch (e) {
      console.error("bunker_set", e);
    } finally {
      setBusy(false);
      setConfirmOff(false);
    }
  }

  // Turning OFF requires confirmation; turning ON is immediate.
  function onToggle(next: boolean) {
    if (!next) { setConfirmOff(true); return; }
    void setBunker(true);
  }

  // What's blocked vs open right now, as visual tiles. "good" = the
  // privacy-protective state (blocked / available). Each maps an icon to its
  // on/off variant so the page reads at a glance.
  const tiles = [
    {
      good: !!status?.network_blocked,
      Icon: status?.network_blocked ? WifiOff : Wifi,
      label: "Network",
      state: status?.network_blocked ? "Blocked" : "Allowed",
    },
    {
      good: !!status?.web_blocked,
      Icon: status?.web_blocked ? Search : Globe,
      label: "Web search",
      state: status?.web_blocked ? "Blocked" : "Allowed",
    },
    {
      good: !!status?.cloud_blocked,
      Icon: status?.cloud_blocked ? CloudOff : Cloud,
      label: "Cloud AI",
      state: status?.cloud_blocked ? "Blocked" : "Allowed",
    },
    {
      good: !!status?.local_available,
      Icon: Cpu,
      label: "Local models",
      state: status?.local_available ? "Available" : "Not detected",
    },
  ];

  return (
    <>
      <SettingsHeader
        title="Privacy"
        subtitle="Bunker Mode is a trust guarantee, not a preference. While it's on, everything stays on this device: local models only, no network, no cloud AI, no web search."
      />

      {/* Hero — the master control. Two colors only: the AI cyan (the "AI" in
          the wordmark) as the on-accent, and brand-dark when off. Text stays
          high-contrast (dark on the light card, white on the dark card). */}
      <div className={`rounded-2xl border p-5 transition-colors ${
        enabled
          ? "border-ai/40 bg-ai/10"
          : "border-black/30 bg-[#141416]"
      }`}>
        <div className="flex items-center gap-4">
          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${enabled ? "bg-ai/15" : "bg-white/10"}`}>
            {enabled ? <ShieldCheck className="h-6 w-6 text-ai" /> : <ShieldOff className="h-6 w-6 text-white" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className={`font-display text-lg font-semibold ${enabled ? "text-text-primary" : "text-white"}`}>Bunker Mode</span>
              <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${enabled ? "bg-ai text-white" : "bg-white/15 text-white"}`}>
                {enabled ? "On" : "Off"}
              </span>
            </div>
            <p className={`mt-1 text-sm ${enabled ? "text-text-secondary" : "text-white/70"}`}>
              {enabled
                ? "Everything stays on this device. Nothing leaves your machine."
                : "Cloud AI, web search, and network access are available and may transmit data."}
            </p>
          </div>
          <Toggle on={enabled} disabled={busy} onChange={onToggle} label="Bunker Mode" />
        </div>
      </div>

      {/* Live status — visual tiles for what's blocked vs open. */}
      <div className="mt-5">
        <div className="mb-3 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">Live status</div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {tiles.map((t) => (
            <div
              key={t.label}
              className={`rounded-xl border p-4 transition-colors ${
                t.good
                  ? "border-ai/40 bg-ai/5"
                  : "border-border bg-surface"
              }`}
            >
              <div className="flex items-center justify-between">
                <t.Icon className={`h-5 w-5 ${t.good ? "text-ai" : "text-text-muted"}`} />
                {t.good
                  ? <Check className="h-3.5 w-3.5 text-ai" />
                  : <span className="h-1.5 w-1.5 rounded-full bg-text-muted/50" />}
              </div>
              <div className="mt-2.5 text-sm font-semibold text-text-primary">{t.label}</div>
              <div className="mt-0.5 font-mono text-[11px] uppercase tracking-wider text-text-secondary">
                {t.state}
              </div>
            </div>
          ))}
        </div>

        {/* Verdict strip */}
        <div className={`mt-3 flex items-center gap-2.5 rounded-xl border px-4 py-3 text-sm ${
          enabled
            ? "border-ai/40 bg-ai/10 text-text-primary"
            : "border-black/30 bg-[#141416] text-white"
        }`}>
          {enabled ? <ShieldCheck className="h-4 w-4 shrink-0 text-ai" /> : <ShieldOff className="h-4 w-4 shrink-0" />}
          <span>
            {enabled
              ? "Verified. No requests leave your machine while Bunker Mode is active."
              : "Cloud connected. Cloud models, web search, and external services can transmit data."}
          </span>
        </div>
        {!status?.local_available && enabled && (
          <a href="https://ollama.com/download" target="_blank" rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1.5 text-xs text-accent hover:underline">
            <Cpu className="h-3.5 w-3.5" /> No local model detected. Install Ollama to run on-device.
          </a>
        )}
      </div>

      {/* Leave-Bunker-Mode confirmation */}
      {confirmOff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={() => setConfirmOff(false)}>
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 border-b border-black/20 bg-[#141416] px-5 py-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/10">
                <ShieldOff className="h-5 w-5 text-white" />
              </div>
              <div className="min-w-0">
                <h3 className="font-display text-lg font-semibold text-white">Leave Bunker Mode?</h3>
                <p className="text-xs text-white/60">This opens your machine to the network.</p>
              </div>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-text-secondary">Turning this off enables:</p>
              <div className="mt-3 grid grid-cols-1 gap-2">
                {([
                  [Cloud, "Cloud AI providers"],
                  [Globe, "Internet access"],
                  [Search, "Web search"],
                  [Server, "External services"],
                ] as const).map(([Icon, label]) => (
                  <div key={label} className="flex items-center gap-2.5 rounded-lg border border-border-subtle bg-background px-3 py-2 text-sm text-text-secondary">
                    <Icon className="h-4 w-4 shrink-0 text-text-muted" />
                    {label}
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-text-muted">Your data may be transmitted to third-party services depending on which features you use.</p>
            </div>
            <div className="flex justify-end gap-2 border-t border-border-subtle bg-surface-warm/40 px-5 py-3">
              <button onClick={() => setConfirmOff(false)} className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-surface-strong">Cancel</button>
              <button onClick={() => void setBunker(false)} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-[#141416] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-50">
                <ShieldOff className="h-4 w-4" /> Leave Bunker Mode
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── General preferences storage ──────────────────────────────────────
// Read/write small boolean + string prefs to localStorage with sensible
// defaults. Exported helpers used at call sites (textarea, chat chunk
// handlers, etc.) to read live.

function GeneralSection({ appearance }: { appearance?: ReturnType<typeof useAppearance> }) {
  const [startOnBoot, setStartOnBoot] = useState(false);
  useEffect(() => { autostartIsEnabled().then(setStartOnBoot).catch(() => {}); }, []);
  const [closeToTray, setCloseToTray] = useState(() => getPref(PREF.closeToTray, "0") === "1");
  useEffect(() => { invoke("set_close_to_tray", { enabled: closeToTray }).catch(() => {}); }, [closeToTray]);
  const [sendKey, setSendKeyState] = useState(() => getPref(PREF.sendKey, "enter"));
  const [desktopNotif, setDesktopNotif] = useState(() => getPref(PREF.desktopNotif, "0") === "1");
  const [soundDone, setSoundDone] = useState(() => getPref(PREF.soundOnDone, "0") === "1");
  const [autoConvert, setAutoConvert] = useState(() => getPref(PREF.autoConvertLongPaste, "1") === "1");
  const [stripSyc, setStripSyc] = useState(() => getPref(PREF.stripSycophancy, "0") === "1");
  const [showThinking, setShowThinking] = useState(() => getPref(PREF.showThinking, "1") === "1");
  const [promptTimeout, setPromptTimeout] = useState<string>(() => getPref(PREF.llmPromptTimeoutSec, "300"));
  const [budgetCap, setBudgetCap] = useState<string>(() => getPref(PREF.budgetMonthlyCapUsd, ""));
  // Running spend estimate. Display-only: seeded from localStorage and, if the
  // engine ever exposes a `engine_budget_status` command, refreshed from it.
  const [budgetSpent, setBudgetSpent] = useState<number>(() => {
    const v = parseFloat(getPref(PREF.budgetSpentUsd, "0"));
    return Number.isFinite(v) ? v : 0;
  });
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const s = await invoke<{ spent_usd?: number; cap_usd?: number }>("engine_budget_status");
        if (!alive) return;
        if (typeof s?.spent_usd === "number") setBudgetSpent(s.spent_usd);
        if (typeof s?.cap_usd === "number" && !getPref(PREF.budgetMonthlyCapUsd, "")) {
          setBudgetCap(String(s.cap_usd));
        }
      } catch {
        /* no engine budget command — stays display-only from localStorage */
      }
    })();
    return () => { alive = false; };
  }, []);
  const capNum = parseFloat(budgetCap);
  const hasCap = Number.isFinite(capNum) && capNum > 0;
  const pct = hasCap ? Math.min(100, Math.round((budgetSpent / capNum) * 100)) : 0;
  const meterColor = pct >= 90 ? "var(--color-danger, #d24b4b)" : pct >= 70 ? "var(--color-warn, #c98a2b)" : "var(--color-ok, #2e9e5b)";

  const Row = ({
    title, desc, control,
  }: { title: string; desc: string; control: React.ReactNode }) => (
    <div className="flex items-start justify-between gap-6 border-b border-border-subtle py-4 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-text-primary">{title}</div>
        <div className="mt-0.5 text-xs text-text-secondary">{desc}</div>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );

  const Switch = ({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) => (
    <Toggle on={on} onChange={onChange} />
  );

  const [genSubOpen, setGenSubOpen] = useState<"main" | "appearance" | "shortcuts" | null>("main");
  const toggleSub = (id: "main" | "appearance" | "shortcuts") => setGenSubOpen((v) => (v === id ? null : id));
  const GenSub = ({ id, title, children }: { id: "main" | "appearance" | "shortcuts"; title: string; children: React.ReactNode }) => (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      <button
        onClick={() => toggleSub(id)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-warm transition-colors"
      >
        <ChevronRight className={`h-4 w-4 shrink-0 text-text-muted transition-transform ${genSubOpen === id ? "rotate-90" : ""}`} strokeWidth={2.5} />
        <span className="text-sm font-semibold text-text-primary">{title}</span>
      </button>
      {genSubOpen === id && (
        <div className="border-t border-border-subtle px-4 py-5">
          {children}
        </div>
      )}
    </div>
  );

  return (
    <>
      <SettingsHeader
        title="General"
        subtitle="App-wide behavior, appearance, and keyboard shortcuts."
      />
      <div className="space-y-2">
      <GenSub id="main" title="Main">
      <div className="rounded-lg border border-border bg-surface px-5">
        <Row
          title="Start on boot"
          desc="Launch Prevail automatically when you sign in to this Mac."
          control={<Switch on={startOnBoot} onChange={async (v) => { try { if (v) await autostartEnable(); else await autostartDisable(); setStartOnBoot(v); } catch (e) { console.error("autostart", e); } }} />}
        />
        <Row
          title="Close to tray"
          desc="Keep Prevail running in the menu bar when you close the window. Quit from the tray icon or ⌘Q."
          control={<Switch on={closeToTray} onChange={(v) => { setCloseToTray(v); setPref(PREF.closeToTray, v ? "1" : "0"); }} />}
        />
        <Row
          title="Send messages with"
          desc="Choose which key combination sends messages. Use Shift+Enter for new lines either way."
          control={
            <select
              value={sendKey}
              onChange={(e) => { setSendKeyState(e.target.value); setPref(PREF.sendKey, e.target.value); }}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:border-accent-border focus:outline-none"
            >
              <option value="enter">Enter</option>
              <option value="cmd-enter">⌘ + Enter</option>
            </select>
          }
        />
        <Row
          title="Desktop notifications"
          desc="Get notified when a CLI finishes streaming a reply (Chat and Council)."
          control={<Switch on={desktopNotif} onChange={(v) => { setDesktopNotif(v); setPref(PREF.desktopNotif, v ? "1" : "0"); }} />}
        />
        <Row
          title="Sound effects"
          desc="Play a soft chime when a reply finishes."
          control={<Switch on={soundDone} onChange={(v) => { setSoundDone(v); setPref(PREF.soundOnDone, v ? "1" : "0"); }} />}
        />
        <Row
          title="Auto-convert long paste"
          desc="When you paste more than 5000 characters, treat it as a file attachment instead of inline prompt text."
          control={<Switch on={autoConvert} onChange={(v) => { setAutoConvert(v); setPref(PREF.autoConvertLongPaste, v ? "1" : "0"); }} />}
        />
        <Row
          title={`Strip "You're absolutely right!" sycophancy`}
          desc="Filters fluff openers from streamed replies before they hit the screen. Has no effect on saved logs."
          control={<Switch on={stripSyc} onChange={(v) => { setStripSyc(v); setPref(PREF.stripSycophancy, v ? "1" : "0"); }} />}
        />
        <Row
          title="Show model thinking"
          desc="When a model exposes its reasoning, show it in a collapsible 'Thinking' block above the answer (Chat and Council). Turn off to hide reasoning entirely."
          control={<Switch on={showThinking} onChange={(v) => { setShowThinking(v); setPref(PREF.showThinking, v ? "1" : "0"); }} />}
        />
        <Row
          title="LLM prompt timeout"
          desc="Hard cap on a single CLI call. The child process gets killed and the reply is finalized if it runs longer."
          control={
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={10}
                max={3600}
                value={promptTimeout}
                onChange={(e) => { setPromptTimeout(e.target.value); setPref(PREF.llmPromptTimeoutSec, e.target.value); }}
                className="w-20 rounded-md border border-border bg-background px-2 py-1.5 text-right text-sm focus:border-accent-border focus:outline-none"
              />
              <span className="font-mono text-xs text-text-muted">s</span>
            </div>
          }
        />
        <Row
          title="Monthly budget cap"
          desc="A soft USD cap for model spend. The meter below tracks estimated spend against it. Leave blank for no cap."
          control={
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-xs text-text-muted">$</span>
              <input
                type="number"
                min={0}
                step="1"
                value={budgetCap}
                placeholder="0"
                onChange={(e) => { setBudgetCap(e.target.value); setPref(PREF.budgetMonthlyCapUsd, e.target.value); }}
                className="w-24 rounded-md border border-border bg-background px-2 py-1.5 text-right text-sm focus:border-accent-border focus:outline-none"
              />
            </div>
          }
        />
      </div>

      {/* Budget meter */}
      <div className="mt-4 rounded-lg border border-border bg-surface px-5 py-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">Budget this month</div>
          <div className="font-mono text-xs text-text-secondary">
            ${budgetSpent.toFixed(2)}{hasCap ? ` / $${capNum.toFixed(2)}` : " spent"}
          </div>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-surface-strong">
          <div className="h-full rounded-full transition-all" style={{ width: hasCap ? `${pct}%` : "0%", background: meterColor }} />
        </div>
        <div className="mt-1.5 font-mono text-[10px] text-text-muted">
          {hasCap ? `${pct}% of cap used${pct >= 90 ? " · approaching limit" : ""}` : "Set a cap above to track usage against it."}
        </div>
      </div>
      </GenSub>
      {appearance && (
        <GenSub id="appearance" title="Appearance">
          <div className="mb-6 rounded-xl border border-border bg-surface p-5">
            <div className="mb-1 font-medium">Color Mode</div>
            <div className="mb-4 text-sm text-text-secondary">Pick a fixed mode or let Prevail follow your system setting.</div>
            <div className="inline-flex items-center rounded-md border border-border bg-background p-1 text-xs">
              {([{ id: "light", label: "Light", icon: Sun }, { id: "dark", label: "Dark", icon: Moon }, { id: "system", label: "System", icon: Monitor }] as const).map((m) => {
                const Icon = m.icon; const active = appearance.mode === m.id;
                return (
                  <button key={m.id} onClick={() => appearance.setMode(m.id as Mode)}
                    className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 transition-colors ${active ? "bg-accent text-background shadow-sm" : "text-text-secondary hover:bg-surface-warm"}`}>
                    <Icon className="h-3.5 w-3.5" />{m.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <div className="mb-1 font-medium">Theme</div>
            <p className="mb-4 text-sm text-text-secondary">Desktop palettes. The selected mode is applied on top.</p>
            <div className="grid grid-cols-3 gap-3">
              {PALETTES.map((p) => (
                <PaletteCard key={p.id} palette={p} active={appearance.palette === p.id} onSelect={() => appearance.setPalette(p.id)} />
              ))}
            </div>
          </div>
        </GenSub>
      )}
      <GenSub id="shortcuts" title="Shortcuts">
        <ShortcutsSection />
      </GenSub>
      </div>
    </>
  );
}

function ConfigurationSection({ vaultPath }: { vaultPath: string }) {
  const [open, setOpen] = useState<"ideal-state" | "memory" | "tasks" | null>(null);
  const toggle = (id: "ideal-state" | "memory" | "tasks") => setOpen((v) => (v === id ? null : id));
  const Sub = ({ id, title, desc, children }: { id: "ideal-state" | "memory" | "tasks"; title: string; desc: string; children: React.ReactNode }) => (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      <button
        onClick={() => toggle(id)}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-surface-warm transition-colors"
      >
        <ChevronRight className={`h-4 w-4 shrink-0 text-text-muted transition-transform ${open === id ? "rotate-90" : ""}`} strokeWidth={2.5} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-text-primary">{title}</div>
          <div className="mt-0.5 text-xs text-text-secondary">{desc}</div>
        </div>
      </button>
      {open === id && (
        <div className="border-t border-border-subtle px-4 py-5">
          {children}
        </div>
      )}
    </div>
  );
  return (
    <>
      <SettingsHeader
        title="Configuration"
        icon={Brain}
        subtitle="Your constitution, context windows, and task ledger in one place."
      />
      <div className="space-y-2">
        <Sub id="ideal-state" title="Ideal State" desc="Your personal constitution: goals, values, and priorities injected into every model turn.">
          <IdealStateSection vaultPath={vaultPath} />
        </Sub>
        <Sub id="memory" title="Memory & Context" desc="Persistent memory, distillation, and what stays in context across sessions.">
          <MemoryContextSection vaultPath={vaultPath} />
        </Sub>
        <Sub id="tasks" title="Tasks" desc="Cross-domain task ledger: every pending item across your vault in one view.">
          <TasksCrossDomainSection vaultPath={vaultPath} />
        </Sub>
      </div>
    </>
  );
}

function MemoryContextSection(_props: { vaultPath: string }) {
  const [persistent, setPersistent] = useState(() => getPref(PREF.persistentMemory, "1") === "1");
  const [memBudget, setMemBudget] = useState(() => getPref(PREF.memoryBudgetChars, "4000"));
  const [status, setStatus] = useState<{ running?: boolean; last_run_ts?: number | null; last_error?: string | null; lines_distilled?: number } | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try { const s = await invoke<typeof status>("distill_status"); if (alive) setStatus(s); } catch { /* daemon not started */ }
    };
    poll();
    const id = window.setInterval(poll, 4000);
    return () => { alive = false; window.clearInterval(id); };
  }, []);

  const Row = ({ title, desc, control }: { title: string; desc: string; control: React.ReactNode }) => (
    <div className="flex items-start justify-between gap-6 border-b border-border-subtle py-4 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-text-primary">{title}</div>
        <div className="mt-0.5 text-xs text-text-secondary">{desc}</div>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
  const Num = ({ value, set, pref, w = "w-20", step }: { value: string; set: (v: string) => void; pref: string; w?: string; step?: string }) => (
    <input type="number" step={step} value={value}
      onChange={(e) => { set(e.target.value); setPref(pref, e.target.value); }}
      className={`${w} rounded-md border border-border bg-background px-2 py-1.5 text-right text-sm focus:border-accent-border focus:outline-none`} />
  );

  return (
    <>
      <SettingsHeader
        title="Memory & Context"
        subtitle="What the system has learned about you. Every chat is captured as an intent; the distiller daemon compacts them into per-domain long-term memory that is fed back into future chats."
      />
      {/* The distiller runs on the Daemons page; this is its outcome view. A
          live status chip links across so the two pages are clearly related. */}
      <button
        onClick={() => window.dispatchEvent(new CustomEvent("prevail:settings-section", { detail: "daemons" }))}
        className="mb-4 flex w-full items-center gap-2 rounded-lg border border-border-subtle bg-surface px-4 py-2.5 text-left hover:border-accent-border"
      >
        <Brain className="h-3.5 w-3.5 shrink-0 text-accent" />
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-secondary">Distiller</span>
        <span className="font-mono text-[10px] text-text-muted">
          {status?.running ? "running" : "idle"}
          {status?.last_run_ts ? ` · last pass ${formatFreshness(Math.max(0, (Date.now() - status.last_run_ts) / 1000))} ago` : ""}
          {status?.lines_distilled ? ` · ${status.lines_distilled} lines` : ""}
        </span>
        <span className="ml-auto font-mono text-[10px] text-accent">Schedule & controls in Daemons →</span>
      </button>
      <div className="rounded-lg border border-border bg-surface px-5">
        <Row title="Persistent memory" desc="Distill the intent ledger into per-domain memory and prepend it to prompts. Master switch."
          control={<Toggle on={persistent} onChange={(v) => { setPersistent(v); setPref(PREF.persistentMemory, v ? "1" : "0"); }} />} />
        <Row title="Memory budget" desc="Hard cap (characters) on the distilled memory injected into each prompt."
          control={<Num value={memBudget} set={setMemBudget} pref={PREF.memoryBudgetChars} w="w-24" />} />
        <Row title="Context engine" desc="Strategy for managing long conversations near the context limit."
          control={
            <select value={getPref(PREF.contextEngine, "compressor")} onChange={(e) => setPref(PREF.contextEngine, e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:border-accent-border focus:outline-none">
              <option value="compressor">Compressor</option>
            </select>
          } />
      </div>
      <div className="mt-3 rounded-lg border border-border-subtle bg-surface px-4 py-2.5 text-xs text-text-muted">
        The distiller (its provider, interval, threshold, and a manual "distill now") is configured on the Daemons page. This page is what it produces.
      </div>
    </>
  );
}

// ── Daemon card ───────────────────────────────────────────────────────────────


// ── Daemons settings panel ────────────────────────────────────────────────────
// Run the self-learning loop with the desktop CLOSED, via a launchd agent
// (engine `daemon install`). When on, the in-app distiller defers to it.

function DaemonsSection({ vaultPath }: { vaultPath: string }) {
  const [distillSt, setDistillSt] = useState<DaemonStatus | null>(null);
  const [remindersSt, setRemindersSt] = useState<DaemonStatus | null>(null);
  const [taskgenSt, setTaskgenSt] = useState<DaemonStatus | null>(null);
  const [taskgenEnabled, setTaskgenEnabled] = useState(() => getPref(PREF.taskgenEnabled, "0") === "1");
  const [taskgenModel, setTaskgenModel] = useState(() => getPref(PREF.taskgenModel, "claude-haiku-4-5"));
  const [taskgenInterval, setTaskgenInterval] = useState(() => getPref(PREF.taskgenIntervalSec, "3600"));
  const [taskgenMax, setTaskgenMax] = useState(() => getPref(PREF.taskgenMaxPerDomain, "3"));
  const [skillgenSt, setSkillgenSt] = useState<DaemonStatus | null>(null);
  const [skillgenEnabled, setSkillgenEnabled] = useState(() => getPref(PREF.skillgenEnabled, "1") === "1");
  const [skillgenModel, setSkillgenModel] = useState(() => getPref(PREF.skillgenModel, "claude-haiku-4-5"));
  const [skillgenInterval, setSkillgenInterval] = useState(() => getPref(PREF.skillgenIntervalSec, "21600"));
  const [skillgenMax, setSkillgenMax] = useState(() => getPref(PREF.skillgenMaxPerDomain, "2"));
  const [skillgenMsg, setSkillgenMsg] = useState("");
  const [skillgenRunning, setSkillgenRunning] = useState(false);
  const [remInterval, setRemInterval] = useState(() => getPref(PREF.remindersIntervalSec, "900"));
  const [taskgenMsg, setTaskgenMsg] = useState("");
  const [running, setRunning] = useState(false);
  // Distill (memory) tuning — moved here from Memory & Context so all daemon
  // operation lives in one place. These write the same prefs distillCfgFromPrefs reads.
  const [dProvider, setDProvider] = useState(() => getPref(PREF.memoryProvider, "claude"));
  const [dModel, setDModel] = useState(() => getPref(PREF.distillModel, "claude-haiku-4-5"));
  const [dAuto, setDAuto] = useState(() => getPref(PREF.autoCompression, "1") === "1");
  const [dThreshold, setDThreshold] = useState(() => getPref(PREF.compressionThreshold, "0.5"));
  const [dTarget, setDTarget] = useState(() => getPref(PREF.compressionTarget, "0.2"));
  const [dProtected, setDProtected] = useState(() => getPref(PREF.protectedRecent, "20"));
  const [dInterval, setDInterval] = useState(() => getPref(PREF.distillIntervalSec, "900"));
  const [distilling, setDistilling] = useState(false);
  const [distillMsg, setDistillMsg] = useState("");
  async function distillNow() {
    setDistilling(true); setDistillMsg("");
    try {
      const lines = await invoke<number>("distill_run_once", { cfg: distillCfgFromPrefs(vaultPath) });
      setDistillMsg(lines > 0 ? `Distilled ${lines} entr${lines === 1 ? "y" : "ies"} into memory.` : "Nothing new to distill yet.");
    } catch (e) { setDistillMsg(`Failed: ${e}`); }
    finally { setDistilling(false); }
  }

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try { const s = await invoke<DaemonStatus>("distill_status"); if (alive) setDistillSt(s); } catch {}
      try { const s = await invoke<DaemonStatus>("reminders_daemon_status"); if (alive) setRemindersSt(s); } catch {}
      try { const s = await invoke<DaemonStatus>("taskgen_status"); if (alive) setTaskgenSt(s); } catch {}
      try { const s = await invoke<DaemonStatus>("skillgen_status"); if (alive) setSkillgenSt(s); } catch {}
    };
    poll();
    const id = window.setInterval(poll, 2000);
    return () => { alive = false; window.clearInterval(id); };
  }, []);

  const Row = ({ title, desc, control }: { title: string; desc: string; control: React.ReactNode }) => (
    <div className="flex items-start justify-between gap-6 border-b border-border-subtle py-4 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-text-primary">{title}</div>
        <div className="mt-0.5 text-xs text-text-secondary">{desc}</div>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );

  async function runTaskgenNow() {
    setRunning(true); setTaskgenMsg("");
    try {
      const n = await invoke<number>("taskgen_run_once", { cfg: taskgenCfgFromPrefs(vaultPath) });
      setTaskgenMsg(n > 0 ? `Generated ${n} task${n === 1 ? "" : "s"}.` : "No new tasks (domains need memory/state first).");
    } catch (e) { setTaskgenMsg(`Failed: ${e}`); }
    finally { setRunning(false); }
  }

  async function runSkillgenNow() {
    setSkillgenRunning(true); setSkillgenMsg("");
    try {
      const n = await invoke<number>("skillgen_run_once", { cfg: skillgenCfgFromPrefs(vaultPath) });
      setSkillgenMsg(n > 0 ? `Learned ${n} skill${n === 1 ? "" : "s"}.` : "No new skills (domains need conversation history first).");
    } catch (e) { setSkillgenMsg(`Failed: ${e}`); }
    finally { setSkillgenRunning(false); }
  }

  return (
    <>
      <SettingsHeader
        title="Daemons"
        subtitle="The background workers. Each runs continuously: distill intents into memory, fire task reminders, proactively generate tasks, and learn reusable skills from your conversations."
      />
      <button
        onClick={() => window.dispatchEvent(new CustomEvent("prevail:settings-section", { detail: "memory" }))}
        className="mb-4 flex w-full items-center gap-2 rounded-lg border border-border-subtle bg-surface px-4 py-2.5 text-left hover:border-accent-border"
      >
        <Brain className="h-3.5 w-3.5 shrink-0 text-accent" />
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-secondary">What they produce</span>
        <span className="ml-auto font-mono text-[10px] text-accent">Distilled memory & budget in Memory & Context →</span>
      </button>

      <div className="mb-4 flex flex-col gap-2">
        <DaemonCard
          name="Distill"
          status={distillSt}
          extra={distillSt?.lines_distilled ? `${distillSt.lines_distilled} lines distilled` : null}
          onStop={async () => { await invoke("distill_stop"); }}
          onStart={async () => { await invoke("distill_start", { cfg: distillCfgFromPrefs(vaultPath) }); }}
        />
        <DaemonCard
          name="Reminders"
          status={remindersSt}
          extra={remindersSt?.last_due_count != null
            ? remindersSt.last_due_count > 0
              ? `${remindersSt.last_due_count} task${remindersSt.last_due_count === 1 ? "" : "s"} due`
              : "no due tasks"
            : null}
          onStop={async () => { await invoke("reminders_daemon_stop"); }}
          onStart={async () => {
            const sec = Number(getPref(PREF.remindersIntervalSec, "900")) || 900;
            await invoke("reminders_daemon_start", { vault: vaultPath, interval_sec: sec });
          }}
        />
        <DaemonCard
          name="Task Gen"
          status={taskgenSt}
          extra={taskgenSt?.tasks_generated ? `${taskgenSt.tasks_generated} tasks generated` : null}
          onStop={async () => { await invoke("taskgen_stop"); }}
          onStart={async () => { await invoke("taskgen_start", { cfg: taskgenCfgFromPrefs(vaultPath) }); }}
        />
        <DaemonCard
          name="Skill Gen"
          status={skillgenSt}
          extra={skillgenSt?.skills_created ? `${skillgenSt.skills_created} skill${skillgenSt.skills_created === 1 ? "" : "s"} learned` : null}
          onStop={async () => { await invoke("skillgen_stop"); }}
          onStart={async () => { await invoke("skillgen_start", { cfg: skillgenCfgFromPrefs(vaultPath) }); }}
        />
      </div>

      <HeadlessLearnCard vaultPath={vaultPath} />

      {/* Distill (memory) tuning + manual pass — the Distill card's controls. */}
      <div className="mb-4 rounded-lg border border-border bg-surface px-5">
        <Row title="Distill provider" desc="Which agent distills the intent ledger into memory (use a cheap, fast one)."
          control={
            <select value={dProvider} onChange={(e) => { setDProvider(e.target.value); setPref(PREF.memoryProvider, e.target.value); }}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:border-accent-border focus:outline-none">
              <option value="claude">Claude</option>
              <option value="codex">Codex</option>
              <option value="ollama">Ollama (local)</option>
            </select>} />
        <Row title="Distill model" desc="Model id used for distillation, e.g. claude-haiku-4-5."
          control={<input value={dModel} onChange={(e) => { setDModel(e.target.value); setPref(PREF.distillModel, e.target.value); }}
            className="w-44 rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:border-accent-border focus:outline-none" />} />
        <Row title="Auto-compression" desc="Run the distill daemon on a timer (off = manual passes only)."
          control={<Toggle on={dAuto} onChange={(v) => { setDAuto(v); setPref(PREF.autoCompression, v ? "1" : "0"); }} />} />
        <Row title="Compression threshold" desc="Start distilling once new activity reaches this fraction of the memory budget."
          control={<input type="number" step="0.1" value={dThreshold} onChange={(e) => { setDThreshold(e.target.value); setPref(PREF.compressionThreshold, e.target.value); }}
            className="w-20 rounded-md border border-border bg-background px-2 py-1.5 text-right text-sm focus:border-accent-border focus:outline-none" />} />
        <Row title="Compression target" desc="Compress memory toward this fraction of the budget."
          control={<input type="number" step="0.1" value={dTarget} onChange={(e) => { setDTarget(e.target.value); setPref(PREF.compressionTarget, e.target.value); }}
            className="w-20 rounded-md border border-border bg-background px-2 py-1.5 text-right text-sm focus:border-accent-border focus:outline-none" />} />
        <Row title="Protected recent" desc="Never distill the most-recent N ledger entries: keep them raw."
          control={<input type="number" value={dProtected} onChange={(e) => { setDProtected(e.target.value); setPref(PREF.protectedRecent, e.target.value); }}
            className="w-20 rounded-md border border-border bg-background px-2 py-1.5 text-right text-sm focus:border-accent-border focus:outline-none" />} />
        <Row title="Distill interval" desc="How often the distill daemon runs a pass (seconds)."
          control={<div className="flex items-center gap-1.5"><input type="number" value={dInterval} onChange={(e) => { setDInterval(e.target.value); setPref(PREF.distillIntervalSec, e.target.value); }}
            className="w-20 rounded-md border border-border bg-background px-2 py-1.5 text-right text-sm focus:border-accent-border focus:outline-none" /><span className="font-mono text-xs text-text-muted">s</span></div>} />
        <Row title="Distill now" desc="Run a distillation pass immediately."
          control={<button onClick={distillNow} disabled={distilling}
            className="rounded-md border border-border bg-background px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent disabled:opacity-40">
            {distilling ? "distilling…" : "distill now"}</button>} />
        {distillMsg && <div className="pb-3 text-xs text-text-secondary">{distillMsg}</div>}
      </div>

      <div className="rounded-lg border border-border bg-surface px-5">
        <Row title="Reminders interval" desc="How often the reminders daemon checks for due tasks (seconds)."
          control={
            <div className="flex items-center gap-1.5">
              <input type="number" value={remInterval} onChange={(e) => { setRemInterval(e.target.value); setPref(PREF.remindersIntervalSec, e.target.value); }}
                className="w-20 rounded-md border border-border bg-background px-2 py-1.5 text-right text-sm focus:border-accent-border focus:outline-none" />
              <span className="font-mono text-xs text-text-muted">s</span>
            </div>
          } />
        <Row title="Task generation" desc="Proactively generate new tasks from your goals, memory, and domain state once per day."
          control={<Toggle on={taskgenEnabled} onChange={(v) => { setTaskgenEnabled(v); setPref(PREF.taskgenEnabled, v ? "1" : "0"); if (!v) invoke("taskgen_stop").catch(() => {}); else invoke("taskgen_start", { cfg: taskgenCfgFromPrefs(vaultPath) }).catch(() => {}); }} />} />
        <Row title="Task gen model" desc="Model used to generate task suggestions (use a cheap, fast model)."
          control={<input value={taskgenModel} onChange={(e) => { setTaskgenModel(e.target.value); setPref(PREF.taskgenModel, e.target.value); }}
            className="w-44 rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:border-accent-border focus:outline-none" />} />
        <Row title="Tasks per domain" desc="Maximum tasks generated per domain per day."
          control={<input type="number" value={taskgenMax} onChange={(e) => { setTaskgenMax(e.target.value); setPref(PREF.taskgenMaxPerDomain, e.target.value); }}
            className="w-16 rounded-md border border-border bg-background px-2 py-1.5 text-right text-sm focus:border-accent-border focus:outline-none" />} />
        <Row title="Task gen interval" desc="How often the task-gen daemon checks for domains that need new tasks (seconds)."
          control={
            <div className="flex items-center gap-1.5">
              <input type="number" value={taskgenInterval} onChange={(e) => { setTaskgenInterval(e.target.value); setPref(PREF.taskgenIntervalSec, e.target.value); }}
                className="w-20 rounded-md border border-border bg-background px-2 py-1.5 text-right text-sm focus:border-accent-border focus:outline-none" />
              <span className="font-mono text-xs text-text-muted">s</span>
            </div>
          } />
        <Row title="Skill learning" desc="Self-learning: distill reusable skills (playbooks, checklists, decision frameworks) from each domain's conversations, once per day."
          control={<Toggle on={skillgenEnabled} onChange={(v) => { setSkillgenEnabled(v); setPref(PREF.skillgenEnabled, v ? "1" : "0"); if (!v) invoke("skillgen_stop").catch(() => {}); else invoke("skillgen_start", { cfg: skillgenCfgFromPrefs(vaultPath) }).catch(() => {}); }} />} />
        <Row title="Skill gen model" desc="Model used to learn skills from conversations (use a cheap, fast model)."
          control={<input value={skillgenModel} onChange={(e) => { setSkillgenModel(e.target.value); setPref(PREF.skillgenModel, e.target.value); }}
            className="w-44 rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:border-accent-border focus:outline-none" />} />
        <Row title="Skills per domain" desc="Maximum new skills learned per domain per day."
          control={<input type="number" value={skillgenMax} onChange={(e) => { setSkillgenMax(e.target.value); setPref(PREF.skillgenMaxPerDomain, e.target.value); }}
            className="w-16 rounded-md border border-border bg-background px-2 py-1.5 text-right text-sm focus:border-accent-border focus:outline-none" />} />
        <Row title="Skill gen interval" desc="How often the skill-learning daemon scans domains for new lessons (seconds; default 6h)."
          control={
            <div className="flex items-center gap-1.5">
              <input type="number" value={skillgenInterval} onChange={(e) => { setSkillgenInterval(e.target.value); setPref(PREF.skillgenIntervalSec, e.target.value); }}
                className="w-20 rounded-md border border-border bg-background px-2 py-1.5 text-right text-sm focus:border-accent-border focus:outline-none" />
              <span className="font-mono text-xs text-text-muted">s</span>
            </div>
          } />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button onClick={runTaskgenNow} disabled={running}
          className="rounded-md border border-border bg-background px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent disabled:opacity-40">
          {running ? "generating…" : "generate tasks now"}
        </button>
        {taskgenMsg && <span className="text-xs text-text-secondary">{taskgenMsg}</span>}
        <button onClick={runSkillgenNow} disabled={skillgenRunning}
          className="rounded-md border border-border bg-background px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent disabled:opacity-40">
          {skillgenRunning ? "learning…" : "learn skills now"}
        </button>
        {skillgenMsg && <span className="text-xs text-text-secondary">{skillgenMsg}</span>}
      </div>
    </>
  );
}

// Shared settings Row used by the Phase 3 sections.

// OpenAI dropped its logo from simple-icons (trademark), so we keep the glyph
// path inline (same one ProviderMark uses for Codex).
const OPENAI_PATH = "M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973l-.001.142v5.518a.79.79 0 0 0 .388.677l5.815 3.354-2.02 1.168a.075.075 0 0 1-.071 0l-4.83-2.788a4.504 4.504 0 0 1-1.647-6.098zm16.597 3.855L13.116 8.38 15.131 7.22a.071.071 0 0 1 .07 0l4.83 2.792a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.394-.674zm2.01-3.023l-.142-.085-4.774-2.781a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.659 4.139l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z";

// Direct API providers on the roadmap — shown with real brand marks. `path`+`hex`
// render the company logo on a white tile; `mono` is a fallback for brands with
// no official simple-icon yet.
// Safe accessor: if a simple-icon resolves undefined (e.g. stale dep cache),
// fall back to the monogram instead of throwing and taking down the page.
const brandIcon = (icon: { path?: string; hex?: string } | undefined, mono: string): Partial<DirectProvider> =>
  icon && icon.path ? { path: icon.path, hex: `#${icon.hex ?? "111111"}` } : { mono };
const DIRECT_PROVIDERS_SOON: DirectProvider[] = [
  { name: "Anthropic", ...brandIcon(siAnthropic, "A") },
  { name: "OpenAI", path: OPENAI_PATH, hex: "#000000" },
  { name: "xAI (Grok)", ...brandIcon(siXRaw, "x") },
  { name: "Google Gemini", ...brandIcon(siGooglegemini, "G") },
  { name: "DeepSeek", ...brandIcon(siDeepseek, "DS") },
  { name: "Qwen / DashScope", ...brandIcon(siQwen, "Q") },
  { name: "MiniMax", ...brandIcon(siMinimax, "M") },
  { name: "Hugging Face", ...brandIcon(siHuggingface, "HF") },
  { name: "GLM / Z.AI", mono: "Z" },
  { name: "Kimi / Moonshot", mono: "K" },
  { name: "OpenCode Zen", mono: "OZ" },
];

// Shared dimensions for every settings list row (providers, connectors,
// gateways, …) so lists look identical across pages: single column, h-8 icon
// tile, gap-3, px-4 py-3, subtle border. Containers wrap these in `space-y-2`.

// Map an OpenRouter model id ("anthropic/claude-...", "x-ai/grok-4", "qwen/...")
// to a brand mark, so the catalog reads visually instead of as a wall of ids.
const OR_VENDOR_ICON: Record<string, { path?: string; hex?: string; mono: string }> = {
  anthropic: { ...brandIcon(siAnthropic, "A") } as { path?: string; hex?: string; mono: string },
  openai: { mono: "AI" },
  google: { ...brandIcon(siGooglegemini, "G") } as { path?: string; hex?: string; mono: string },
  "x-ai": { ...brandIcon(siXRaw, "x") } as { path?: string; hex?: string; mono: string },
  deepseek: { ...brandIcon(siDeepseek, "DS") } as { path?: string; hex?: string; mono: string },
  qwen: { ...brandIcon(siQwen, "Q") } as { path?: string; hex?: string; mono: string },
  "meta-llama": { ...brandIcon(siMeta, "M") } as { path?: string; hex?: string; mono: string },
  mistralai: { ...brandIcon(siMistralai, "Mi") } as { path?: string; hex?: string; mono: string },
  minimax: { ...brandIcon(siMinimax, "MM") } as { path?: string; hex?: string; mono: string },
  moonshotai: { mono: "Ki" },
  "z-ai": { mono: "Z" },
};
function orVendorOf(id: string): string {
  const v = id.includes("/") ? id.split("/")[0].toLowerCase() : "";
  return v;
}
function OrVendorMark({ id, size = 18 }: { id: string; size?: number }) {
  const v = OR_VENDOR_ICON[orVendorOf(id)];
  return (
    <span className="flex shrink-0 items-center justify-center rounded-md border border-border-subtle bg-white" style={{ width: size + 8, height: size + 8 }}>
      {v?.path ? (
        <svg width={size} height={size} viewBox="0 0 24 24" fill={v.hex ?? "#111"} aria-hidden><path d={v.path} /></svg>
      ) : (
        <span className="font-mono text-[9px] font-semibold text-text-muted">{v?.mono ?? "·"}</span>
      )}
    </span>
  );
}

function ProvidersSection({ onActivated, embedded }: { onActivated?: () => Promise<CliInfo[]>; embedded?: boolean }) {
  const [key, setKey] = useState("");
  const [configured, setConfigured] = useState(false);
  const [last4, setLast4] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [saved, setSaved] = useState(false);
  // I10: after a key save we re-detect providers and confirm OpenRouter is now
  // selectable, so the user gets real activation feedback instead of silence.
  const [activated, setActivated] = useState<boolean | null>(null);
  // Live OpenRouter catalog browser (curated shown by default; search reveals all).
  const [orQuery, setOrQuery] = useState("");
  const [, setOrNonce] = useState(0);
  useEffect(() => {
    invoke<boolean>("provider_key_exists", { provider: "openrouter" }).then((ok) => setConfigured(!!ok)).catch(() => {});
    invoke<string | null>("provider_key_last4", { provider: "openrouter" }).then((v) => setLast4(v ?? null)).catch(() => {});
    const h = () => setOrNonce((n) => n + 1);
    window.addEventListener("prevail:models-refreshed", h);
    return () => window.removeEventListener("prevail:models-refreshed", h);
  }, []);
  const orCurated = MODELS.openrouter ?? [];
  const orLive = DISCOVERED_MODELS.openrouter ?? [];
  const orResults = orQuery.trim()
    ? orLive.filter((m) => `${m.id} ${m.label ?? ""}`.toLowerCase().includes(orQuery.trim().toLowerCase())).slice(0, 60)
    : [];
  async function save() {
    try {
      await invoke("provider_key_set", { provider: "openrouter", key: key.trim() });
      setConfigured(!!key.trim());
      setKey("");
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1500);
      // Re-detect so OpenRouter immediately shows as available in every picker,
      // and report back whether activation took.
      if (onActivated) {
        const list = await onActivated();
        const ok = list.some((c) => c.id === "openrouter" && c.available);
        setActivated(ok);
        window.setTimeout(() => setActivated(null), 6000);
      }
    } catch (e) { console.error("provider_key_set", e); }
  }
  async function remove() {
    try {
      await invoke("provider_key_del", { provider: "openrouter" });
      setConfigured(false);
      setActivated(null);
      if (onActivated) await onActivated();
    } catch (e) { console.error(e); }
  }
  return (
    <>
      {!embedded && <SettingsHeader title="Providers" subtitle="Bring your own models. OpenRouter is one key for 200+ models (Claude, GPT, Gemini, Grok, DeepSeek, Qwen…). Direct providers are coming next." />}
      <div className="rounded-lg border border-border bg-surface p-5">
        <div className="mb-1 flex items-center gap-2">
          <span className="font-semibold text-text-primary">OpenRouter</span>
          <span className="rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent">Recommended</span>
          {configured && (
            <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-accent-border bg-accent-soft px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent">
              <Check className="h-3 w-3" strokeWidth={3} /> Configured{last4 ? ` · ····${last4}` : ""}
            </span>
          )}
        </div>
        <div className="mb-3 text-xs text-text-secondary">One API key unlocks every model. Used by the engine inside any domain. <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" className="text-accent hover:underline">Get a key ›</a></div>
        <div className="flex items-center gap-2">
          <input type="password" value={key} placeholder={configured ? "•••••••• (replace)" : "sk-or-v1-…"} onChange={(e) => setKey(e.target.value)}
            className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 font-mono text-sm focus:border-accent-border focus:outline-none" />
          <button onClick={save} disabled={!key.trim()} className="rounded-md bg-text-primary px-3 py-1.5 text-sm font-medium text-background hover:opacity-90 disabled:opacity-40">{saved ? "Saved" : "Save"}</button>
          {configured && (
            <button
              onClick={async () => {
                setTesting(true); setActivated(null);
                try {
                  await invoke<string>("verify_cli_model", { args: { cli: "openrouter", model: lsGet("prevail.model.openrouter") || null } });
                  setActivated(true);
                  setCliVerify("openrouter", { status: "ok" });
                } catch (e) {
                  setActivated(false);
                  setCliVerify("openrouter", { status: "failed", error: String(e).slice(0, 200) });
                } finally { setTesting(false); }
              }}
              disabled={testing}
              className="inline-flex items-center gap-1.5 rounded-md border border-accent-border bg-accent-soft px-3 py-1.5 text-sm text-accent hover:bg-accent hover:text-background disabled:opacity-50"
            >
              {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
              {testing ? "Testing…" : "Test live"}
            </button>
          )}
          {configured && <button onClick={remove} className="rounded-md border border-warn/40 bg-warn/10 px-3 py-1.5 text-sm text-warn hover:bg-warn/20">Remove</button>}
        </div>
        {activated === true && (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-accent-border bg-accent-soft px-3 py-2 text-xs text-accent">
            <Check className="h-4 w-4" />
            Live call succeeded: OpenRouter answered with this key. Selectable in Chat, Council, and Benchmark pickers.
          </div>
        )}
        {activated === false && (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
            <AlertTriangle className="h-4 w-4" />
            Key saved, but OpenRouter didn&apos;t come online. Double-check the key at openrouter.ai/keys.
          </div>
        )}
        {/* Curated picks shown by default; search reveals the full live catalog. */}
        <div className="mt-4 border-t border-border-subtle pt-3">
          <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary">
            <Layers className="h-3 w-3 text-accent" /> Prevail defaults
            {orLive.length > 0 && <span className="text-text-muted normal-case tracking-normal">· full live catalog: {orLive.length} models, search to browse</span>}
          </div>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {orCurated.map((m) => (
              <span key={m.id} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] text-text-secondary" title={m.id}>
                <OrVendorMark id={m.id} size={12} />{m.label}
              </span>
            ))}
          </div>
          <input
            value={orQuery}
            onChange={(e) => setOrQuery(e.target.value)}
            placeholder={orLive.length > 0 ? `Search all ${orLive.length} live models (e.g. fable, grok, qwen, kimi)…` : "Refresh in Models to load the live catalog…"}
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 font-mono text-xs focus:border-accent-border focus:outline-none"
          />
          {/* The full live catalog, always browsable (icon per vendor). Search
              narrows; otherwise the first 80 are shown so it is never blank. */}
          {orLive.length > 0 && (
            <div className="mt-2 max-h-72 overflow-auto rounded-md border border-border-subtle bg-background">
              {(orQuery.trim() ? orResults : orLive.slice(0, 80)).length === 0 ? (
                <div className="px-3 py-2 text-xs text-text-muted">No models match "{orQuery}".</div>
              ) : (
                (orQuery.trim() ? orResults : orLive.slice(0, 80)).map((m) => (
                  <button
                    key={m.id}
                    onClick={() => { navigator.clipboard.writeText(m.id).catch(() => {}); }}
                    title="Click to copy the model id"
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-warm"
                  >
                    <OrVendorMark id={m.id} size={16} />
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-primary">{m.label && m.label !== m.id ? m.label : m.id}</span>
                    <span className="shrink-0 font-mono text-[9px] text-text-muted">{orVendorOf(m.id) || "model"}</span>
                  </button>
                ))
              )}
              {!orQuery.trim() && orLive.length > 80 && (
                <div className="px-3 py-1.5 font-mono text-[10px] text-text-muted">+{orLive.length - 80} more, search to find them</div>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="mt-4">
        <div className="mb-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">Direct providers</div>
        {/* Shared list-row spec (see SETTINGS_ROW): single column, comfortable. */}
        <div className="space-y-2">
          {DIRECT_PROVIDERS_SOON.map((p) => (
            <div key={p.name} className={SETTINGS_ROW}>
              <DirectProviderMark p={p} />
              <span className="flex-1 text-sm text-text-secondary">{p.name}</span>
              <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">Coming soon</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// Connectors — data sources that auto-build per-domain context, routed through
// a connector hub (Composio). Real brand marks (simple-icons) where available,
// else a tinted lucide fallback. Placeholders for now; live wiring next.
const CONNECTOR_GROUPS: { category: string; items: Connector[] }[] = [
  { category: "Finance", items: [
    { name: "Plaid (banks & cards)", domain: "wealth", icon: Landmark, color: "#111111" },
    { name: "Coinbase", domain: "wealth", brand: siCoinbase as Brand },
    { name: "Robinhood", domain: "wealth", brand: siRobinhood as Brand },
    { name: "Wise", domain: "wealth", brand: siWise as Brand },
    { name: "QuickBooks", domain: "business", brand: siQuickbooks as Brand },
    { name: "Stripe", domain: "business", brand: siStripe as Brand },
    { name: "Shopify", domain: "business", brand: siShopify as Brand },
  ]},
  { category: "Email & Calendar", items: [
    { name: "Gmail", domain: "general", brand: siGmail as Brand },
    { name: "Outlook / IMAP", domain: "general", icon: Mail, color: "#0A66C2" },
    { name: "Google Calendar", domain: "calendar", brand: siGooglecalendar as Brand },
    { name: "Calendly", domain: "calendar", brand: siCalendly as Brand },
  ]},
  { category: "Files & Notes", items: [
    { name: "Google Drive", domain: "general", brand: siGoogledrive as Brand },
    { name: "Google Sheets", domain: "general", brand: siGooglesheets as Brand },
    { name: "Dropbox", domain: "general", brand: siDropbox as Brand },
    { name: "Notion", domain: "general", brand: siNotion as Brand },
    { name: "Obsidian", domain: "general", brand: siObsidian as Brand },
  ]},
  { category: "Productivity", items: [
    { name: "Slack", domain: "general", icon: MessageSquare, color: "#4A154B" },
    { name: "Linear", domain: "career", brand: siLinear as Brand },
    { name: "Trello", domain: "general", brand: siTrello as Brand },
    { name: "Asana", domain: "general", brand: siAsana as Brand },
    { name: "Todoist", domain: "general", brand: siTodoist as Brand },
    { name: "Airtable", domain: "general", brand: siAirtable as Brand },
    { name: "Zoom", domain: "general", brand: siZoom as Brand },
    { name: "HubSpot", domain: "business", brand: siHubspot as Brand },
  ]},
  { category: "Developer", items: [
    { name: "GitHub", domain: "career", brand: siGithub as Brand },
    { name: "GitLab", domain: "career", brand: siGitlab as Brand },
  ]},
  { category: "Health & Fitness", items: [
    { name: "Apple Health", domain: "health", icon: Heart, color: "#FF2D55" },
    { name: "Strava", domain: "health", brand: siStrava as Brand },
    { name: "Fitbit", domain: "health", brand: siFitbit as Brand },
  ]},
  { category: "Social & Media", items: [
    { name: "Reddit", domain: "explore", brand: siReddit as Brand },
    { name: "YouTube", domain: "content", brand: siYoutube as Brand },
    { name: "Spotify", domain: "explore", brand: siSpotify as Brand },
    { name: "Discord", domain: "general", brand: siDiscord as Brand },
    { name: "WhatsApp", domain: "general", brand: siWhatsapp as Brand },
    { name: "Telegram", domain: "general", brand: siTelegram as Brand },
  ]},
];


// Catalog shapes — mirror resources/connectors/catalog.json. The Rust command
// returns it verbatim, so the frontend owns the type.
// A REAL app as the engine sees it (community/vault app with live state),
// distinct from a catalog entry (a browseable directory listing).
// Real brand SVG (simple-icons) when the app matched one at build time; else a
// pattern-tinted dot. Keeps the row scannable for all 1,400+ apps.

// Each connector PATTERN maps to one ingestion tier. Short label + tint so a
// row scans at a glance without per-brand icons (the catalog has hundreds).

// Friendly domain headings. Falls back to titleCase for anything unmapped.


function ConnectorsSection({ vaultPath, focusAppId }: { vaultPath: string; focusAppId?: string }) {
  const [cat, setCat] = useState<ConnectorCatalog | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const [logos, setLogos] = useState<Record<string, BrandLogo>>({});
  const [engineApps, setEngineApps] = useState<EngineApp[] | null>(null);
  const [probing, setProbing] = useState<string | null>(null);
  const [probeResult, setProbeResult] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      try { setCat(await invoke<ConnectorCatalog>("ingestion_connector_catalog")); }
      catch (e) { setErr(String(e)); }
      try { setLogos(await invoke<Record<string, BrandLogo>>("ingestion_connector_logos")); }
      catch { /* logos optional */ }
      try { setEngineApps(await invoke<EngineApp[]>("engine_apps_list")); }
      catch { setEngineApps([]); }
    })();
  }, []);

  async function testApp(id: string) {
    setProbing(id);
    try {
      const r = await invoke<{ status?: string; message?: string }>("engine_app_probe", { id });
      setProbeResult((m) => ({ ...m, [id]: `${r.status ?? "?"}${r.message ? ": " + r.message : ""}` }));
      setEngineApps(await invoke<EngineApp[]>("engine_apps_list"));
    } catch (e) { setProbeResult((m) => ({ ...m, [id]: `error: ${e}` })); }
    setProbing(null);
  }

  const [expandedApp, setExpandedApp] = useState<string | null>(focusAppId ?? null);
  const [appSkills, setAppSkills] = useState<Record<string, { id: string; runner: string; trigger: string }[]>>({});
  // Sync prop changes (e.g. sidebar click fires a new focusAppId after mount).
  useEffect(() => { if (focusAppId) setExpandedApp(focusAppId); }, [focusAppId]);
  async function toggleApp(id: string) {
    if (expandedApp === id) { setExpandedApp(null); return; }
    setExpandedApp(id);
    if (!appSkills[id]) {
      try {
        const sk = await invoke<{ id: string; runner: string; trigger: string }[]>("engine_app_skills", { id });
        setAppSkills((s) => ({ ...s, [id]: sk }));
      } catch { setAppSkills((s) => ({ ...s, [id]: [] })); }
    }
  }

  async function syncEngineApp(id: string) {
    setProbing("sync:" + id);
    try {
      const r = await invoke<{ ok: boolean; artifacts?: number; error?: string }>("engine_app_sync", { id, vault: vaultPath });
      setProbeResult((m) => ({ ...m, [id]: r.ok ? `synced. ${r.artifacts ?? 0} artifact(s)` : `sync failed: ${r.error}` }));
      setEngineApps(await invoke<EngineApp[]>("engine_apps_list"));
    } catch (e) { setProbeResult((m) => ({ ...m, [id]: `error: ${e}` })); }
    setProbing(null);
  }

  // "Add" a catalog app: scaffold a real engine app folder, then refresh the
  // Connected list so it appears with live status.
  const [adding, setAdding] = useState<string | null>(null);
  const [addMsg, setAddMsg] = useState<Record<string, string>>({});
  async function addApp(a: CatalogApp) {
    const id = a.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
    if (!id) return;
    setAdding(a.name);
    try {
      const r = await invoke<{ ok: boolean; path?: string; error?: string }>("engine_app_add", {
        id, title: a.name, integration: a.pattern, domains: [a.domain],
      });
      setAddMsg((m) => ({ ...m, [a.name]: r.ok ? "added" : (r.error ?? "failed") }));
      if (r.ok) {
        setEngineApps(await invoke<EngineApp[]>("engine_apps_list"));
        // Tell the sidebar (and any other listener) to re-pull its app list so
        // the new app shows up immediately, not just on next launch.
        window.dispatchEvent(new CustomEvent("prevail:apps-changed"));
      }
    } catch (e) { setAddMsg((m) => ({ ...m, [a.name]: `${e}`.replace(/^error:\s*/i, "") || "failed" })); }
    setAdding(null);
  }
  const connectedIds = useMemo(() => new Set((engineApps ?? []).map((a) => a.id)), [engineApps]);
  const [triageOnly, setTriageOnly] = useState(false);
  const needsAttention = useMemo(
    () => (engineApps ?? []).filter((a) => a.status === "error" || a.status === "expired"),
    [engineApps],
  );

  // Reuse the curated brand marks where an app name matches; everything else
  // shows a neutral pattern-tinted dot. Keeps CONNECTOR_GROUPS/ConnectorIcon live.
  const brandByName = useMemo(() => {
    const m: Record<string, Connector> = {};
    for (const g of CONNECTOR_GROUPS) for (const it of g.items) m[it.name.split(" (")[0].toLowerCase()] = it;
    return m;
  }, []);

  const needle = q.trim().toLowerCase();
  // Default to the household-name core (tier 1). Searching or "Show all"
  // widens to the full catalog so nothing is ever truly hidden.
  // An app's tags = its primary domain plus any extra cross-category tags it
  // carries (e.g. Tesla: automotive + tech). Most apps have only their domain,
  // so the chip set stays the union of every domain and every extra tag.
  const allTags = useMemo(() => {
    const keys = new Set<string>();
    for (const a of cat?.apps ?? []) {
      keys.add(a.domain);
      for (const t of a.tags ?? []) keys.add(t);
    }
    return Array.from(keys)
      .map((d) => ({ key: d, label: DOMAIN_LABEL[d] ?? titleCase(d) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [cat]);

  const flatApps = useMemo(() => {
    const all = cat?.apps ?? [];
    const base = needle || showAll ? all : all.filter((a) => a.tier === 1);
    const appTags = (a: CatalogApp) => [a.domain, ...(a.tags ?? [])];
    let filtered = needle
      ? base.filter((a) => a.name.toLowerCase().includes(needle) || appTags(a).some((t) => t.toLowerCase().includes(needle) || (DOMAIN_LABEL[t] ?? "").toLowerCase().includes(needle)))
      : base;
    // Tag filter is OR across an app's full tag set, so Tesla appears under
    // both "automotive" and "tech" rather than being forced into one group.
    if (activeTags.size > 0) filtered = filtered.filter((a) => appTags(a).some((t) => activeTags.has(t)));
    return filtered.slice().sort((a, b) => a.name.localeCompare(b.name));
  }, [cat, needle, showAll, activeTags]);

  const total = cat?.apps.length ?? 0;
  const coreTotal = useMemo(() => (cat?.apps ?? []).filter((a) => a.tier === 1).length, [cat]);
  const shown = flatApps.length;
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of cat?.apps ?? []) c[a.pattern] = (c[a.pattern] ?? 0) + 1;
    return c;
  }, [cat]);

  return (
    <>
      <SettingsHeader
        title="Apps"
        subtitle="Every app Prevail can pull from, pre-populated and tagged by how it connects. Pulled data lands in the matching domain's vault and feeds the intent ledger + memory."
      />

      {/* Connected apps — the REAL apps the engine has wired up (with live auth
          + sync state), distinct from the browseable catalog below. */}
      {engineApps && engineApps.length > 0 && (
        <div className="mb-6">
          <div className="mb-2 flex items-baseline gap-2">
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">Connected</span>
            <span className="font-mono text-[10px] text-text-muted/60">{engineApps.length}</span>
            {needsAttention.length > 0 && (
              <button
                onClick={() => setTriageOnly((v) => !v)}
                className={`ml-auto rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${triageOnly ? "border-warn bg-warn/10 text-warn" : "border-warn/40 text-warn/80 hover:bg-warn/10"}`}
                title="Apps with expired auth or sync errors"
              >
                {needsAttention.length} need attention
              </button>
            )}
          </div>
          <div className="space-y-2">
            {(triageOnly ? needsAttention : engineApps).map((app) => {
              const tint = STATUS_TINT[app.status] ?? "#9aa0a6";
              const open = expandedApp === app.id;
              return (
                <div key={app.id}>
                  <div className={`group ${SETTINGS_ROW} hover:border-accent-border hover:bg-surface-warm`}>
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: tint }} title={app.status} />
                    <button onClick={() => toggleApp(app.id)} className="min-w-0 flex-1 text-left" title="Show detail">
                      <div className="flex items-center gap-2">
                        <ChevronRight className={`h-3 w-3 shrink-0 text-text-muted transition-transform ${open ? "rotate-90" : ""}`} strokeWidth={2.5} />
                        <span className="truncate text-sm font-medium text-text-primary">{app.account?.label ? `${app.title} · ${app.account.label}` : app.title}</span>
                        <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-text-muted">{app.integration}</span>
                        {app.domains.length > 0 && <span className="shrink-0 font-mono text-[9px] text-text-muted/70">→ {app.domains.map(titleCase).join(", ")}</span>}
                      </div>
                      <div className="pl-5 font-mono text-[10px] text-text-muted">
                        {app.status}{app.refresh?.every ? ` · ${app.refresh.every}` : ""} · synced {relTime(app.lastSuccessTs)}
                        {probeResult[app.id] && <span className="ml-2 text-text-secondary">{probeResult[app.id]}</span>}
                        {app.lastError && !probeResult[app.id] && <span className="ml-2 text-warn">{app.lastError}</span>}
                      </div>
                    </button>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        onClick={() => testApp(app.id)}
                        disabled={probing === app.id}
                        className="rounded border border-border bg-background px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-50"
                      >
                        {probing === app.id ? "testing" : "test"}
                      </button>
                      <button
                        onClick={() => syncEngineApp(app.id)}
                        disabled={probing === "sync:" + app.id}
                        title="Sync this app now"
                        className="rounded border border-border bg-background px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-50"
                      >
                        {probing === "sync:" + app.id ? "syncing" : "sync"}
                      </button>
                    </div>
                  </div>
                  {open && (
                    <div className="mb-1 ml-7 mt-1 space-y-2 rounded-lg border border-border-subtle bg-background px-3 py-2 text-xs">
                      {/* Schedule */}
                      {app.refresh?.every && (
                        <div>
                          <div className="mb-0.5 font-mono text-[10px] uppercase tracking-wider text-text-muted">Schedule</div>
                          <div className="font-mono text-[11px] text-text-secondary">
                            every {app.refresh.every} · last synced {relTime(app.lastSuccessTs)}
                          </div>
                        </div>
                      )}
                      {/* Domains and vault write paths */}
                      {app.domains.length > 0 && (
                        <div>
                          <div className="mb-0.5 font-mono text-[10px] uppercase tracking-wider text-text-muted">Vault paths</div>
                          <ul className="space-y-0.5">
                            {app.domains.map((d) => (
                              <li key={d} className="font-mono text-[11px] text-text-secondary">
                                ▸ {titleCase(d)} <span className="text-text-muted/60">→ vault/{d}/</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {/* Skills */}
                      <div>
                        <div className="mb-0.5 font-mono text-[10px] uppercase tracking-wider text-text-muted">Skills</div>
                        {appSkills[app.id] === undefined ? (
                          <div className="text-text-muted">loading…</div>
                        ) : appSkills[app.id].length === 0 ? (
                          <div className="text-text-muted">No skills yet. Add one under <code className="text-accent">skills/</code> to enable syncing.</div>
                        ) : (
                          <ul className="space-y-0.5">
                            {appSkills[app.id].map((s) => (
                              <li key={s.id} className="font-mono text-[11px] text-text-secondary">▸ {s.id} <span className="text-text-muted">· {s.runner} · {s.trigger}</span></li>
                            ))}
                          </ul>
                        )}
                      </div>
                      {app.lastError && <div className="text-warn">last error: {app.lastError}</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {engineApps && engineApps.length === 0 && (
        <div className="mb-6 rounded-lg border border-border-subtle bg-surface px-4 py-3 text-xs text-text-muted">
          No apps connected yet. Drop a manifest into <code className="text-accent">~/.prevail/apps/&lt;id&gt;/</code> or add one from the catalog below; it then appears here with live status and syncs into its domains.
        </div>
      )}
      {/* Connector hub */}
      <div className="mb-5 flex items-start gap-3 rounded-2xl border border-border bg-surface p-5 shadow-sm">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft">
          <Plug className="h-5 w-5 text-accent" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-text-primary">Connector catalog</span>
            <span className="rounded-full bg-surface-warm px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-muted">{total} apps</span>
          </div>
          <div className="mt-1 text-xs text-text-secondary">
            Each app routes through one of four connector patterns, and each pattern maps to an ingestion tier. A new app just needs a pattern tag, never bespoke code.
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {(["api", "oauth", "cli", "browser"] as const).map((p) => (
              <span key={p} className="inline-flex items-center gap-1.5">
                <PatternChip pattern={p} />
                <span className="font-mono text-[10px] text-text-muted">{PATTERN_TIER[p].replace(/^Tier [A-D] · /, "")} · {counts[p] ?? 0}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {err && <div className="mb-4 rounded-lg border border-border bg-surface px-4 py-3 text-xs text-text-muted">Could not load the catalog: {err}</div>}

      {/* Search + Core/All toggle. Search auto-expands matching domains and
          always spans the full catalog regardless of the toggle. */}
      <div className="mb-2 flex items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Search all ${total.toLocaleString()} apps…`}
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-accent-border focus:outline-none"
        />
        <div className="flex shrink-0 overflow-hidden rounded-md border border-border">
          {([["core", "Core"], ["all", "All"]] as const).map(([val, label]) => {
            const active = val === "all" ? showAll : !showAll;
            return (
              <button
                key={val}
                onClick={() => setShowAll(val === "all")}
                className={`px-3 py-2 text-xs font-medium transition-colors ${active ? "bg-accent-soft text-accent" : "bg-background text-text-muted hover:bg-surface-warm"}`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
      {/* Tag filter chips */}
      {allTags.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {allTags.map((t) => {
            const active = activeTags.has(t.key);
            return (
              <button
                key={t.key}
                onClick={() => setActiveTags((s) => { const n = new Set(s); if (n.has(t.key)) n.delete(t.key); else n.add(t.key); return n; })}
                className={`rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-colors ${active ? "border-accent bg-accent-soft text-accent" : "border-border bg-background text-text-muted hover:border-accent-border hover:text-text-secondary"}`}
              >
                {t.label}
              </button>
            );
          })}
          {activeTags.size > 0 && (
            <button
              onClick={() => setActiveTags(new Set())}
              className="rounded-full border border-border bg-background px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:border-warn/50 hover:text-warn"
            >
              clear
            </button>
          )}
        </div>
      )}
      <div className="mb-4 font-mono text-[10px] uppercase tracking-wider text-text-muted/70">
        {needle
          ? `${shown.toLocaleString()} match${shown === 1 ? "" : "es"}`
          : activeTags.size > 0
            ? `${shown.toLocaleString()} app${shown === 1 ? "" : "s"} in selected categories`
            : showAll
              ? `Showing all ${total.toLocaleString()} apps`
              : `Showing ${coreTotal} core apps · toggle All for the full ${total.toLocaleString()}`}
      </div>

      {/* Flat alphabetical list — category shown as secondary label on each row */}
      <div className="space-y-1.5">
        {flatApps.map((a) => {
          const brand = brandByName[a.name.toLowerCase()];
          const hasLogo = !!(a.iconSlug && logos[a.iconSlug]);
          return (
            <div key={a.name} className={`group ${SETTINGS_ROW} py-2 hover:border-accent-border hover:bg-surface-warm`}>
              {hasLogo ? (
                <AppLogo app={a} logos={logos} />
              ) : brand ? (
                <ConnectorIcon c={brand} />
              ) : (
                <AppLogo app={a} logos={logos} />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-text-primary">
                  {a.name}
                  {a.note && <span className="ml-2 text-[11px] font-normal text-text-muted">{a.note}</span>}
                </span>
                <span className="font-mono text-[10px] text-text-muted/60">
                  {[a.domain, ...(a.tags ?? [])].map((t) => DOMAIN_LABEL[t] ?? titleCase(t)).join(" · ")}
                </span>
              </span>
              {a.via && <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-text-muted/70">via {a.via}</span>}
              {a.fallback && <span className="shrink-0 font-mono text-[9px] text-text-muted/50" title={`falls back to ${a.fallback}`}>→ {PATTERN_LABEL[a.fallback] ?? a.fallback}</span>}
              {a.verified && a.sources && a.sources.length > 0 && (
                <span className="shrink-0 font-mono text-[9px] text-accent" title={`Verified connector. Listed by: ${a.sources.join(", ")}`}>
                  ✓ {a.sources.map((s) => SOURCE_ABBR[s] ?? s).join("·")}
                </span>
              )}
              {(() => {
                const slug = a.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
                const already = connectedIds.has(slug);
                const msg = addMsg[a.name];
                const errored = msg && msg !== "added";
                return already ? (
                  <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-accent" title="Already a connected app">added</span>
                ) : (
                  <span className="flex shrink-0 items-center gap-1.5">
                    {errored && (
                      <span className="max-w-[160px] truncate font-mono text-[9px] text-err" title={msg}>{msg}</span>
                    )}
                    <button
                      onClick={() => addApp(a)}
                      disabled={adding === a.name}
                      title={errored ? `Retry. Last error: ${msg}` : "Add as a connectable app"}
                      className={`shrink-0 rounded border bg-background px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider transition-opacity group-hover:opacity-100 disabled:opacity-50 ${errored ? "border-err/50 text-err opacity-100 hover:border-err" : "border-border text-text-muted opacity-0 hover:border-accent-border hover:text-accent"}`}
                    >
                      {adding === a.name ? "…" : errored ? "retry" : "add"}
                    </button>
                  </span>
                );
              })()}
              <PatternChip pattern={a.pattern} />
            </div>
          );
        })}
        {cat && flatApps.length === 0 && (
          <div className="rounded-lg border border-border-subtle bg-surface px-4 py-6 text-center text-sm text-text-muted">No apps match "{q}".</div>
        )}
      </div>
    </>
  );
}

// App lock (F4 Phase 0) — set/change/remove the passcode that gates opening the
// desktop app. Honest about scope: it locks the UI, it does NOT yet encrypt the
// vault files on disk.

// Vault encryption (F4 Phase 1) — encrypt the vault at rest, or decrypt it back.
// Self-verifying in the engine (auto-rollback if anything is unreadable), and
// shows the one-time recovery code on encryption.
function VaultEncryptionCard({ vaultPath }: { vaultPath: string }) {
  const [status, setStatus] = useState<{ encrypted: boolean; unlocked: boolean } | null>(null);
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<string | null>(null);
  const refresh = async () => {
    try { setStatus(await invoke("engine_vault_status", { vault: vaultPath })); } catch { setStatus(null); }
  };
  useEffect(() => { void refresh(); /* eslint-disable-next-line */ }, [vaultPath]);
  async function encrypt() {
    if (pass.length < 4) { setNote("Passcode must be at least 4 characters."); return; }
    if (!window.confirm("Encrypt this vault? Make sure you have a backup first. You'll get a one-time recovery code: save it.")) return;
    setBusy(true); setNote(null); setRecovery(null);
    try {
      await backupVaultNow(vaultPath); // automatic pre-encryption snapshot
      const r = await invoke<{ ok: boolean; recoveryCode?: string | null; error?: string }>("engine_vault_encrypt", { vault: vaultPath, passcode: pass });
      if (r.ok) {
        if (r.recoveryCode) setRecovery(r.recoveryCode);
        await invoke("engine_vault_unlock", { vault: vaultPath, passcode: pass }).catch(() => {});
        setNote("Vault encrypted. Save your recovery code somewhere safe.");
        setPass("");
        await refresh();
      } else {
        setNote(r.error ?? "Encryption failed.");
      }
    } catch (e) { setNote(`Failed: ${String(e)}`); } finally { setBusy(false); }
  }
  async function decrypt() {
    setBusy(true); setNote(null);
    try {
      await backupVaultNow(vaultPath); // automatic pre-decryption snapshot
      const r = await invoke<{ ok: boolean; error?: string }>("engine_vault_decrypt", { vault: vaultPath, passcode: pass });
      if (r.ok) { setNote("Vault decrypted back to plaintext. Reloading…"); setPass(""); await refresh(); setTimeout(() => window.location.reload(), 800); }
      else setNote(r.error ?? "Wrong passcode.");
    } catch (e) { setNote(`Failed: ${String(e)}`); } finally { setBusy(false); }
  }
  if (!status) return null;
  return (
    <div className="mb-4 rounded-lg border border-border bg-surface p-5">
      <div className="flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-text-primary">
        <Shield className="h-3.5 w-3.5" /> Vault encryption {status.encrypted ? "· on" : "· off"}
      </div>
      <p className="mt-2 text-xs text-text-muted">
        {status.encrypted
          ? "Your vault files are encrypted at rest with AES-256-GCM. They're unreadable on disk without your passcode."
          : "Encrypt your vault files at rest so they can't be read off disk. Editing in external apps (Obsidian, Finder) stops working while encrypted."}
      </p>
      <div className="mt-3 flex items-center gap-2">
        <input
          type="password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          placeholder={status.encrypted ? "Passcode" : "New passcode (min 4 chars)"}
          className="w-56 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:border-accent-border focus:outline-none"
        />
        {status.encrypted ? (
          <button onClick={decrypt} disabled={busy || !pass} className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-surface-warm disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Decrypt vault
          </button>
        ) : (
          <button onClick={encrypt} disabled={busy || pass.length < 4} className="inline-flex items-center gap-2 rounded-md border border-accent-border bg-accent px-3 py-1.5 text-sm text-background hover:opacity-90 disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Shield className="h-3.5 w-3.5" />} Encrypt vault
          </button>
        )}
      </div>
      {recovery && (
        <div className="mt-3 rounded-lg border border-accent-border bg-accent-soft p-3">
          <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-accent">Recovery code: save this now</div>
          <div className="mt-1 select-all font-mono text-sm text-text-primary">{recovery}</div>
          <div className="mt-1 text-[11px] text-text-muted">If you forget your passcode, this is the only other way to unlock your vault. It won't be shown again.</div>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-background hover:bg-accent-hover"
          >
            I saved it · Restart Prevail
          </button>
          <span className="ml-2 text-[11px] text-text-muted">Restarting re-opens the vault through the unlock screen so every view reads it correctly.</span>
        </div>
      )}
      {note && <div className="mt-2 text-xs text-text-secondary">{note}</div>}
    </div>
  );
}

function SafetySection({ vaultPath }: { vaultPath: string }) {
  const [approvalMode, setApprovalMode] = useState(() => getPref(PREF.approvalMode, "manual"));
  const [approvalTimeout, setApprovalTimeout] = useState(() => getPref(PREF.approvalTimeoutSec, "60"));
  const [confirmMcp, setConfirmMcp] = useState(() => getPref(PREF.confirmMcpReloads, "1") === "1");
  const [allowlist, setAllowlist] = useState(() => getPref(PREF.commandAllowlist, ""));
  const [redact, setRedact] = useState(() => getPref(PREF.redactSecrets, "0") === "1");
  const [allowPrivate, setAllowPrivate] = useState(() => getPref(PREF.allowPrivateUrls, "0") === "1");
  const [checkpoints, setCheckpoints] = useState(() => getPref(PREF.fileCheckpoints, "0") === "1");
  return (
    <>
      <SettingsHeader title="Safety" subtitle="Guardrails for what the agent can do and what gets stored. Redact secrets is enforced here; approval, allowlist, and checkpoints are honored by the engine." />
      <AppLockCard />
      <VaultEncryptionCard vaultPath={vaultPath} />
      <div className="rounded-lg border border-border bg-surface px-5">
        <SettingsRowLite title="Approval mode" desc="How commands that need explicit approval are handled."
          control={
            <select value={approvalMode} onChange={(e) => { setApprovalMode(e.target.value); setPref(PREF.approvalMode, e.target.value); }}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:border-accent-border focus:outline-none">
              <option value="manual">Manual</option>
              <option value="auto">Auto</option>
            </select>
          } />
        <SettingsRowLite title="Approval timeout" desc="How long an approval prompt waits before timing out."
          control={<div className="flex items-center gap-1.5"><input type="number" value={approvalTimeout} onChange={(e) => { setApprovalTimeout(e.target.value); setPref(PREF.approvalTimeoutSec, e.target.value); }} className="w-20 rounded-md border border-border bg-background px-2 py-1.5 text-right text-sm focus:border-accent-border focus:outline-none" /><span className="font-mono text-xs text-text-muted">s</span></div>} />
        <SettingsRowLite title="Confirm MCP reloads" desc="Ask before reloading MCP servers."
          control={<Toggle on={confirmMcp} onChange={(v) => { setConfirmMcp(v); setPref(PREF.confirmMcpReloads, v ? "1" : "0"); }} />} />
        <SettingsRowLite title="Command allowlist" desc="Comma-separated commands the agent may run without prompting."
          control={<input value={allowlist} placeholder="git, ls, cat" onChange={(e) => { setAllowlist(e.target.value); setPref(PREF.commandAllowlist, e.target.value); }} className="w-56 rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:border-accent-border focus:outline-none" />} />
        <SettingsRowLite title="Redact secrets" desc="Scrub API keys, tokens, and passwords from saved chat transcripts and the intent ledger."
          control={<Toggle on={redact} onChange={(v) => { setRedact(v); setPref(PREF.redactSecrets, v ? "1" : "0"); }} />} />
        <SettingsRowLite title="Allow private URLs" desc="Let the agent fetch localhost / private-network URLs."
          control={<Toggle on={allowPrivate} onChange={(v) => { setAllowPrivate(v); setPref(PREF.allowPrivateUrls, v ? "1" : "0"); }} />} />
        <SettingsRowLite title="File checkpoints" desc="Snapshot files before the agent edits them so changes can be rolled back."
          control={<Toggle on={checkpoints} onChange={(v) => { setCheckpoints(v); setPref(PREF.fileCheckpoints, v ? "1" : "0"); }} />} />
      </div>
    </>
  );
}

// WhatsApp is rendered as its own (fuller) card below, so it's excluded here.

const COMING_SOON_GATEWAYS: { name: string; icon?: { path: string; hex: string }; mono?: typeof Mail }[] = [
  { name: "Discord", icon: siDiscord },
  { name: "Slack", mono: MessagesSquare },
  { name: "Signal", icon: siSignal },
  { name: "Matrix", icon: siMatrix },
  { name: "Mattermost", icon: siMattermost },
  { name: "Email (IMAP/SMTP)", mono: Mail },
  { name: "SMS (Twilio)", mono: MessageSquare },
];

// U2: Gateway is the single, self-contained section (owns its header) — folds in
// the former "Integrations" bridge cards (A1) without the earlier double header /
// double Telegram-card bug. Live bridges first, then coming-soon, evenly gridded.
function GatewaySection() {
  const [bridgesOpen, setBridgesOpen] = useState(false);
  const [surfacesOpen, setSurfacesOpen] = useState(false);
  const [liveTg, setLiveTg] = useState(false);
  const liveWa = false;
  useEffect(() => {
    let alive = true;
    const check = async () => {
      try { const t = await invoke<{ running: boolean }>("telegram_bridge_status"); if (alive) setLiveTg(!!t.running); } catch { if (alive) setLiveTg(false); }
    };
    void check();
    const id = window.setInterval(() => void check(), 8000);
    return () => { alive = false; window.clearInterval(id); };
  }, []);
  const anyLive = liveTg || liveWa;
  return (
    <>
      <SettingsHeader title="Gateway" icon={MessagesSquare} subtitle="Chat with your council from anywhere. Your vault stays local: these bridges relay messages to your domains and back." />

      <div className="space-y-2">
        <div className="rounded-lg border border-border bg-surface overflow-hidden">
          <button
            onClick={() => setBridgesOpen((v) => !v)}
            className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-surface-warm transition-colors"
          >
            <ChevronRight className={`h-4 w-4 shrink-0 text-text-muted transition-transform ${bridgesOpen ? "rotate-90" : ""}`} strokeWidth={2.5} />
            <span className="flex-1 text-sm font-semibold text-text-primary">Bridges</span>
            {anyLive && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent">
                <span className="pulse-soft inline-block h-1.5 w-1.5 rounded-full bg-accent" />
                live{liveTg ? " · Telegram" : ""}
              </span>
            )}
          </button>
          {bridgesOpen && (
            <div className="border-t border-border-subtle px-4 py-4 space-y-4">
              <TelegramCard />
              <WhatsAppCard />
            </div>
          )}
        </div>

        <div className="rounded-lg border border-border bg-surface overflow-hidden">
          <button
            onClick={() => setSurfacesOpen((v) => !v)}
            className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-surface-warm transition-colors"
          >
            <ChevronRight className={`h-4 w-4 shrink-0 text-text-muted transition-transform ${surfacesOpen ? "rotate-90" : ""}`} strokeWidth={2.5} />
            <span className="flex-1 text-sm font-semibold text-text-primary">More surfaces</span>
            <span className="font-mono text-[10px] text-text-muted">{COMING_SOON_GATEWAYS.length} coming</span>
          </button>
          {surfacesOpen && (
            <div className="border-t border-border-subtle px-4 py-2 space-y-1">
              {COMING_SOON_GATEWAYS.map((g) => (
                <div key={g.name} className={SETTINGS_ROW}>
                  <GatewayMark icon={g.icon} mono={g.mono} />
                  <span className="flex-1 text-sm text-text-secondary">{g.name}</span>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">Coming soon</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function RemoteSection() {
  const [running, setRunning] = useState(false);
  const [port, setPort] = useState(() => getPref(PREF.webuiPort, "8787"));
  const [user, setUser] = useState(() => getPref(PREF.webuiUser, "admin"));
  const [pass, setPass] = useState(() => {
    let p = getPref(PREF.webuiPass, "");
    if (!p) { p = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6); setPref(PREF.webuiPass, p); }
    return p;
  });
  const [showPass, setShowPass] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    invoke<{ running: boolean }>("webui_status").then((s) => setRunning(!!s.running)).catch(() => {});
  }, []);
  async function toggle(on: boolean) {
    setErr("");
    try {
      if (on) {
        await invoke("webui_start", { port: Number(port) || 8787, user, pass });
        setRunning(true);
      } else {
        await invoke("webui_stop");
        setRunning(false);
      }
    } catch (e) { setErr(String(e)); }
  }
  return (
    <>
      <SettingsHeader title="Remote (WebUI)" subtitle="Serve this exact app to a browser: same UI, no rebuild. Then reach it from your phone or laptop, anywhere, via Tailscale or Cloudflare." />
      <div className="rounded-lg border border-border bg-surface px-5">
        <SettingsRowLite title="Enable WebUI" desc="Run the bridge server so a browser can use Prevail. This Mac must stay on."
          control={<Toggle on={running} onChange={toggle} />} />
        <SettingsRowLite title="Port" desc="Local port the WebUI listens on."
          control={<input type="number" value={port} disabled={running} onChange={(e) => { setPort(e.target.value); setPref(PREF.webuiPort, e.target.value); }} className="w-24 rounded-md border border-border bg-background px-2 py-1.5 text-right text-sm focus:border-accent-border focus:outline-none disabled:opacity-50" />} />
        <SettingsRowLite title="Username" desc="Login for the WebUI."
          control={<input value={user} disabled={running} onChange={(e) => { setUser(e.target.value); setPref(PREF.webuiUser, e.target.value); }} className="w-40 rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:border-accent-border focus:outline-none disabled:opacity-50" />} />
        <SettingsRowLite title="Password" desc="Keep this private: anyone with it and the URL can use your agent."
          control={
            <div className="flex items-center gap-2">
              <input type={showPass ? "text" : "password"} value={pass} disabled={running} onChange={(e) => { setPass(e.target.value); setPref(PREF.webuiPass, e.target.value); }} className="w-40 rounded-md border border-border bg-background px-2 py-1.5 font-mono text-sm focus:border-accent-border focus:outline-none disabled:opacity-50" />
              <button onClick={() => setShowPass((v) => !v)} className="font-mono text-[11px] text-text-muted hover:text-accent">{showPass ? "hide" : "show"}</button>
            </div>
          } />
      </div>
      {running && (
        <div className="mt-4 rounded-lg border border-accent-border bg-accent-soft px-5 py-4">
          <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-accent">Live</div>
          <div className="text-sm text-text-primary">Open <a href={`http://localhost:${port}`} target="_blank" rel="noreferrer" className="font-mono text-accent hover:underline">http://localhost:{port}</a> in a browser, or from another device use this Mac's Tailscale/LAN address on port {port}.</div>
        </div>
      )}
      {err && <div className="mt-3 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">{err}</div>}
    </>
  );
}

// The MCP "expose" config is pasted into Claude Desktop and used long-term, so
// it must reference a STABLE absolute path — not the transient location the app
// happens to be running from. When launched straight off the mounted DMG
// (/Volumes/…) or under macOS App Translocation (/private/var/folders/…), the
// bundled-sidecar path would vanish the moment the volume ejects. Normalize
// those to the canonical installed location. (feedback v0.4.1 B9)
function mcpCommandPath(enginePath: string): { command: string; unstable: boolean } {
  const p = (enginePath || "").trim();
  const unstable =
    p === "" ||
    p.includes("/Volumes/") ||
    p.includes("AppTranslocation") ||
    p.includes("/private/var/folders/");
  if (unstable) return { command: "/Applications/Prevail.app/Contents/MacOS/prevail", unstable: true };
  return { command: p, unstable: false };
}

function McpSection({ vaultPath }: { vaultPath: string }) {
  const [enginePath, setEnginePath] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [testing, setTesting] = useState(false);
  const [handshake, setHandshake] = useState<{ ok: boolean; msg: string } | null>(null);
  async function runHandshake() {
    setTesting(true); setHandshake(null);
    try {
      const r = await invoke<{ ok: boolean; info?: string; error?: string }>("mcp_test_handshake", { vault: vaultPath });
      setHandshake({ ok: !!r.ok, msg: r.ok ? (r.info ?? "Handshake OK.") : (r.error ?? "Handshake failed.") });
    } catch (e) {
      setHandshake({ ok: false, msg: String(e).slice(0, 160) });
    } finally { setTesting(false); }
  }
  useEffect(() => {
    invoke<{ engine_bin?: string }>("app_diagnostics").then((d) => setEnginePath(d.engine_bin ?? "prevail")).catch(() => setEnginePath("prevail"));
  }, []);
  const { command: mcpCommand, unstable: mcpPathUnstable } = mcpCommandPath(enginePath);
  // Ready-to-paste configs per client — the resolved absolute bin path baked in,
  // so connecting is copy-paste instead of guesswork.
  const clients: { id: string; label: string; kind: "shell" | "json" | "toml"; body: string; note: string }[] = [
    {
      id: "claude-code", label: "Claude Code", kind: "shell",
      body: `claude mcp add prevail -- ${mcpCommand} mcp --vault ${vaultPath}`,
      note: "Run this in your terminal. Restart Claude Code, then `/mcp` to confirm.",
    },
    {
      id: "claude-desktop", label: "Claude Desktop", kind: "json",
      body: JSON.stringify({ mcpServers: { prevail: { command: mcpCommand, args: ["mcp", "--vault", vaultPath] } } }, null, 2),
      note: "Add to claude_desktop_config.json (Settings → Developer → Edit Config), then restart.",
    },
    {
      id: "codex", label: "Codex", kind: "toml",
      body: `[mcp_servers.prevail]\ncommand = "${mcpCommand}"\nargs = ["mcp", "--vault", "${vaultPath}"]`,
      note: "Add to ~/.codex/config.toml, then restart Codex.",
    },
    {
      id: "gemini", label: "Gemini CLI", kind: "json",
      body: JSON.stringify({ mcpServers: { prevail: { command: mcpCommand, args: ["mcp", "--vault", vaultPath] } } }, null, 2),
      note: "Add to ~/.gemini/settings.json under mcpServers, then restart.",
    },
  ];
  const [client, setClient] = useState(clients[0].id);
  const active = clients.find((c) => c.id === client) ?? clients[0];
  return (
    <>
      <SettingsHeader title="MCP" icon={Wrench} subtitle="Use Prevail headlessly: expose your vault as an MCP server so Claude Code, Claude Desktop, Codex, or the Gemini CLI drive it: the same domains, routing, and self-learning, no UI required." />
      <div className="mb-5">
        <div className="mb-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">Connected servers (Prevail consumes)</div>
        <McpCard />
      </div>
      <div className="rounded-lg border border-border bg-surface p-5">
        <div className="mb-1 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">Expose Prevail to your agent</div>
        <div className="mb-3 text-xs text-text-secondary">Pick your tool, copy the config (the engine path is filled in), paste it, restart the tool. Then Test handshake to confirm it answers.</div>
        {mcpPathUnstable && (
          <div className="mb-3 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[11px] text-warn">
            <div className="mb-2 font-medium">Prevail is not in your Applications folder.</div>
            <div className="mb-2">MCP requires a stable path. Move Prevail.app to /Applications/ once and this resolves permanently.</div>
            {(() => {
              const [moving, setMoving] = useState(false);
              const [moveMsg, setMoveMsg] = useState<string | null>(null);
              return (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={async () => {
                      setMoving(true); setMoveMsg(null);
                      try {
                        const src = enginePath?.includes(".app") ? enginePath.slice(0, enginePath.lastIndexOf(".app") + 4) : enginePath || "";
                        const msg = await invoke<string>("move_to_applications", { source: src });
                        setMoveMsg(msg);
                      } catch (e) { setMoveMsg(`Failed: ${e}`); }
                      setMoving(false);
                    }}
                    disabled={moving || !enginePath}
                    className="inline-flex items-center gap-1.5 rounded border border-warn bg-warn/20 px-2.5 py-1 text-[11px] font-semibold hover:bg-warn/30 disabled:opacity-50"
                  >
                    {moving ? "Moving…" : "Move to Applications automatically"}
                  </button>
                  <button
                    onClick={() => invoke("open_in_finder", { path: "/Applications" }).catch(() => {})}
                    className="inline-flex items-center gap-1.5 rounded border border-warn/40 bg-warn/10 px-2.5 py-1 text-[11px] hover:bg-warn/20"
                  >
                    <Folder className="h-3 w-3" /> Open Applications folder
                  </button>
                  {moveMsg && <span className="w-full text-[11px]">{moveMsg}</span>}
                </div>
              );
            })()}
          </div>
        )}
        <div className="mb-3 inline-flex flex-wrap gap-1 rounded-lg border border-border-subtle bg-surface-warm/60 p-1">
          {clients.map((c) => (
            <button key={c.id} onClick={() => setClient(c.id)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${client === c.id ? "bg-surface text-accent shadow-sm ring-1 ring-black/5" : "text-text-muted hover:text-text-secondary"}`}>
              {c.label}
            </button>
          ))}
        </div>
        <pre className="overflow-auto rounded-md border border-border-subtle bg-background p-3 font-mono text-[11px] text-text-secondary whitespace-pre-wrap">{active.body}</pre>
        <div className="mt-1.5 text-[11px] text-text-muted">{active.note}</div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button onClick={() => { navigator.clipboard.writeText(active.body).catch(() => {}); setCopied(true); window.setTimeout(() => setCopied(false), 1500); }}
            className="rounded-md border border-border bg-background px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent">
            {copied ? "Copied" : `Copy ${active.kind === "shell" ? "command" : "config"}`}
          </button>
          <button onClick={runHandshake} disabled={testing}
            className="inline-flex items-center gap-1.5 rounded-md border border-accent-border bg-accent-soft px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-accent hover:bg-accent hover:text-background disabled:opacity-50">
            {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
            {testing ? "Testing…" : "Test handshake"}
          </button>
          {handshake && (
            <span className={`font-mono text-[11px] ${handshake.ok ? "text-ok" : "text-warn"}`}>
              {handshake.ok ? "✓ " : "✗ "}{handshake.msg}
            </span>
          )}
        </div>
      </div>
    </>
  );
}

// Settings > Tasks: every task across every domain in one place, so you can
// triage what is accumulating where (the cross-domain view, vs per-domain
// Insights). Grouped by status; shows due, source, and added date.
function TasksCrossDomainSection({ vaultPath }: { vaultPath: string }) {
  type TaskRow = { domain: string; text: string; done: boolean; due?: string | null; added?: string | null; source?: string | null };
  const [rows, setRows] = useState<TaskRow[]>([]);
  const [domainFilter, setDomainFilter] = useState("all");
  const [showDone, setShowDone] = useState(false);
  const refresh = () => invoke<TaskRow[]>("tasks_read_all", { vault: vaultPath }).then((r) => setRows(Array.isArray(r) ? r : [])).catch(() => {});
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [vaultPath]);
  const domains = useMemo(() => [...new Set(rows.map((r) => r.domain))].sort(), [rows]);
  const today = new Date().toISOString().slice(0, 10);
  const shown = rows.filter((r) => (domainFilter === "all" || r.domain === domainFilter) && (showDone || !r.done));
  const openCount = rows.filter((r) => !r.done).length;
  const overdue = rows.filter((r) => !r.done && r.due && r.due < today).length;
  async function toggle(r: TaskRow) {
    try {
      const cur = await invoke<TaskRow[]>("tasks_read", { vault: vaultPath, domain: r.domain });
      const next = cur.map((t) => (t.text === r.text ? { ...t, done: !t.done } : t));
      await invoke("tasks_set", { vault: vaultPath, domain: r.domain, tasks: next });
      refresh();
    } catch (e) { console.error("toggle task", e); }
  }
  return (
    <>
      <SettingsHeader title="Tasks" icon={Check} subtitle="Every task across every domain, in one place: triage what is piling up where. Per-domain lists live in each domain's Insights tab." />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] text-text-secondary">{openCount} open{overdue > 0 ? ` · ${overdue} overdue` : ""}</span>
        <select value={domainFilter} onChange={(e) => setDomainFilter(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1.5 font-mono text-[11px] text-text-secondary">
          <option value="all">All domains</option>
          {domains.map((d) => <option key={d} value={d}>{titleCase(d)}</option>)}
        </select>
        <button onClick={() => setShowDone((s) => !s)} className={`rounded-md border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider ${showDone ? "border-accent-border bg-accent-soft text-accent" : "border-border text-text-muted hover:border-accent-border hover:text-accent"}`}>
          {showDone ? "Hiding done off" : "Show done"}
        </button>
      </div>
      {shown.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-sm text-text-muted">No {showDone ? "" : "open "}tasks{domainFilter !== "all" ? ` in ${titleCase(domainFilter)}` : ""}.</div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border">
          {shown.map((r, i) => (
            <label key={`${r.domain}-${r.text}-${i}`} className="flex items-start gap-3 border-b border-border-subtle px-4 py-2.5 last:border-0 hover:bg-surface-warm">
              <input type="checkbox" checked={r.done} onChange={() => toggle(r)} className="mt-0.5" />
              <span className="mt-0.5 shrink-0 rounded bg-surface-warm px-1.5 py-0.5 font-mono text-[10px] text-text-muted">{titleCase(r.domain)}</span>
              <span className={`min-w-0 flex-1 text-sm ${r.done ? "text-text-muted line-through" : "text-text-primary"}`}>{r.text}</span>
              {r.source && r.source !== "user" && <span className="shrink-0 rounded bg-surface-warm px-1.5 py-0.5 font-mono text-[9px] text-text-muted">{r.source === "daemon" ? "auto" : "suggested"}</span>}
              {r.due && !r.done && (() => { const od = r.due < today, du = r.due === today; return <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] ${od ? "bg-warn/15 text-warn" : du ? "bg-accent-soft text-accent" : "bg-surface-warm text-text-muted"}`}>{od ? "overdue" : du ? "today" : r.due}</span>; })()}
              <span className="shrink-0 font-mono text-[9px] text-text-muted/60">{r.added ?? ""}</span>
            </label>
          ))}
        </div>
      )}
    </>
  );
}

// Settings > Intents: every question ever asked, across every domain, in one
// searchable browser. Each row is the exact ask plus the model settings in
// effect (replayable provenance, kept on-device).
function IntentsSection({ vaultPath }: { vaultPath: string }) {
  type IntentRow = { message?: string; cli?: string; model?: string; ts?: number; domain?: string };
  const [intents, setIntents] = useState<IntentRow[]>([]);
  const [q, setQ] = useState("");
  const [domainFilter, setDomainFilter] = useState("all");
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  useEffect(() => {
    invoke<IntentRow[]>("intents_read_all", { vault: vaultPath, limit: 500 })
      .then((r) => setIntents(Array.isArray(r) ? r : []))
      .catch(() => setIntents([]));
  }, [vaultPath]);
  const domains = useMemo(
    () => [...new Set(intents.map((i) => i.domain ?? "general"))].sort(),
    [intents],
  );
  const shown = intents.filter(
    (i) =>
      (domainFilter === "all" || (i.domain ?? "general") === domainFilter) &&
      (!q.trim() || String(i.message ?? "").toLowerCase().includes(q.trim().toLowerCase())),
  );
  return (
    <>
      <SettingsHeader
        title="Intents"
        icon={Lightbulb}
        subtitle="Every question you've asked, across every domain: the exact ask plus the model settings in effect, kept on your machine as replayable provenance. Per-domain views live in each domain's Insights tab."
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="search intents…"
          className="min-w-[200px] flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-border focus:outline-none"
        />
        <select
          value={domainFilter}
          onChange={(e) => setDomainFilter(e.target.value)}
          className="rounded-md border border-border bg-background px-2 py-1.5 font-mono text-[11px] text-text-secondary"
        >
          <option value="all">All domains</option>
          {domains.map((d) => (
            <option key={d} value={d}>{titleCase(d)}</option>
          ))}
        </select>
        <span className="font-mono text-[10px] text-text-muted">{shown.length} of {intents.length}</span>
      </div>
      {shown.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-sm text-text-muted">
          {intents.length === 0
            ? "No intents captured yet. Every chat question is logged here as you work."
            : "Nothing matches that filter."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border">
          {shown.map((it, i) => (
            <div key={i} className="flex items-start gap-3 border-b border-border-subtle px-4 py-2.5 last:border-0 hover:bg-surface-warm">
              <span className="mt-0.5 shrink-0 rounded bg-surface-warm px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
                {titleCase(it.domain ?? "general")}
              </span>
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 text-sm text-text-primary">{String(it.message ?? "(no text)")}</div>
                <div className="mt-0.5 font-mono text-[10px] text-text-muted">
                  {it.cli ?? ""}{it.model ? ` · ${it.model}` : ""}{it.ts ? ` · ${formatFreshness(Math.max(0, (Date.now() - it.ts) / 1000))}` : ""}
                </div>
              </div>
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(String(it.message ?? ""));
                  setCopiedIdx(i);
                  setTimeout(() => setCopiedIdx((c) => (c === i ? null : c)), 1500);
                }}
                title="Copy the question to re-ask it anywhere"
                className="shrink-0 rounded-md border border-border px-2 py-1 font-mono text-[10px] text-text-secondary hover:border-accent-border hover:text-accent"
              >
                {copiedIdx === i ? "copied" : "copy"}
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// Map an ideal-state section heading to an icon matching its theme, so the
// rendered constitution reads as a visual map rather than a text wall.
function idealSectionIcon(title: string) {
  const t = title.toLowerCase();
  if (/vision|north|ideal|future|dream/.test(t)) return Compass;
  if (/value|principle|rule|constitution/.test(t)) return Scale;
  if (/wealth|money|finan|invest/.test(t)) return Coins;
  if (/health|body|fitness|energy|sleep/.test(t)) return Activity;
  if (/family|relation|people|friend|marriage/.test(t)) return Users;
  if (/work|career|business|craft|build/.test(t)) return Briefcase;
  if (/learn|grow|educat|skill|read|stud/.test(t)) return GraduationCap;
  if (/home|living|place|environment/.test(t)) return Home;
  if (/faith|spirit|soul|peace|joy/.test(t)) return Heart;
  if (/freedom|travel|world|adventure/.test(t)) return Globe;
  if (/legacy|impact|give|generos|serve/.test(t)) return Award;
  if (/secur|safe|protect|risk/.test(t)) return Shield;
  if (/mind|mental|focus|clarity|think/.test(t)) return Brain;
  if (/time|priorit|goal|target|measure/.test(t)) return Target;
  return Lightbulb;
}

// Alignment readout — how close each life pillar is to the ideal state. Reads
// the engine's alignment report (signal mode); shown on the Ideal State page.

function IdealStateSection({ vaultPath }: { vaultPath: string }) {
  const [body, setBody] = useState<string>("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [versions, setVersions] = useState<{ name: string; path: string }[]>([]);
  const loadVersions = () =>
    invoke<{ name: string; path: string }[]>("ideal_state_versions", { vault: vaultPath })
      .then((v) => setVersions(Array.isArray(v) ? v : []))
      .catch(() => {});
  useEffect(() => {
    invoke<string>("read_ideal_state", { vault: vaultPath })
      .then((s) => { setBody(s); setLoaded(true); })
      .catch(() => setLoaded(true));
    void loadVersions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultPath]);
  async function save() {
    setSaving(true);
    try {
      await invoke("write_ideal_state", { vault: vaultPath, body });
      setSavedAt(Date.now());
      setEditing(false);
      void loadVersions();
    } finally {
      setSaving(false);
    }
  }

  // Split the markdown into an intro plus one block per `## ` heading, so the
  // default view is a structured, icon-marked map of the constitution.
  const parsed = useMemo(() => {
    const lines = body.split("\n");
    let title = "";
    const intro: string[] = [];
    const sections: { title: string; body: string[] }[] = [];
    let cur: { title: string; body: string[] } | null = null;
    for (const line of lines) {
      const h2 = line.match(/^##\s+(.+)/);
      const h1 = line.match(/^#\s+(.+)/);
      if (h2) { cur = { title: h2[1].trim(), body: [] }; sections.push(cur); continue; }
      if (h1 && !cur && !title) { title = h1[1].trim(); continue; }
      (cur ? cur.body : intro).push(line);
    }
    return {
      title,
      intro: intro.join("\n").trim(),
      sections: sections.map((s) => ({ title: s.title, body: s.body.join("\n").trim() })),
    };
  }, [body]);

  return (
    <>
      <SettingsHeader
        title="Ideal State"
        icon={Compass}
        subtitle="The vision and values everything optimizes for. Every chat, council, recommendation, plan, and background daemon reads this first and aligns to it. Saved to vault/ideal-state.md the moment you hit Save."
      />
      <AlignmentCard vaultPath={vaultPath} />
      <div className="mb-4 flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
          {editing
            ? "Editing markdown"
            : parsed.sections.length > 0
              ? `${parsed.sections.length} section${parsed.sections.length === 1 ? "" : "s"} · highest precedence everywhere`
              : "Highest precedence everywhere"}
        </span>
        <div className="flex items-center gap-2">
          {savedAt && !editing && (
            <span className="font-mono text-[10px] text-ok">✓ saved</span>
          )}
          {loaded && (
            <button
              onClick={() => setEditing((e) => !e)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 font-mono text-[11px] text-text-secondary hover:border-accent-border hover:text-accent"
            >
              {editing ? <Eye className="h-3.5 w-3.5" /> : <PenLine className="h-3.5 w-3.5" />}
              {editing ? "View" : "Edit"}
            </button>
          )}
        </div>
      </div>
      {editing ? (
        <div className="rounded-lg border border-border bg-surface">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={"# Operating Vision\n\n## Values\n\n- What every decision should honor\n\n## Wealth\n\n- The position you are building toward"}
            rows={24}
            className="w-full resize-y rounded-lg bg-transparent p-4 font-mono text-sm leading-relaxed text-text-primary placeholder:text-text-muted focus:outline-none"
          />
          <div className="flex items-center justify-between gap-2 border-t border-border-subtle px-4 py-2">
            <span className="font-mono text-[10px] text-text-muted">
              {body.length.toLocaleString()} chars · sections start with ## headings
            </span>
            <button
              onClick={save}
              disabled={saving || !loaded}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-background hover:bg-accent-hover disabled:bg-surface-strong disabled:text-text-muted"
            >
              {saving ? "saving…" : "Save"}
            </button>
          </div>
        </div>
      ) : !loaded ? null : body.trim() === "" ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-surface px-6 py-10 text-center">
          <Compass className="h-8 w-8 text-accent" />
          <div className="font-display text-base font-semibold">No Ideal State yet</div>
          <p className="max-w-md text-sm text-text-secondary">
            Write the life you are building and the principles every decision should honor.
            Use ## headings (Values, Wealth, Health, Family) and the page renders them as a map.
          </p>
          <button
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-background hover:bg-accent-hover"
          >
            <PenLine className="h-3.5 w-3.5" /> Start writing
          </button>
        </div>
      ) : (
        <div>
          {parsed.title && (
            <h2 className="font-display text-lg font-bold tracking-tight">{parsed.title}</h2>
          )}
          {parsed.intro && (
            <div className="mt-2 rounded-xl border border-accent-border bg-accent-soft/40 p-4 text-sm leading-relaxed text-text-primary">
              <Markdown source={parsed.intro} compact />
            </div>
          )}
          {versions.length > 0 && (
            <details className="mb-3 rounded-lg border border-border-subtle bg-surface px-3 py-2">
              <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
                History · {versions.length} version{versions.length === 1 ? "" : "s"} · every edit is snapshotted, nothing is ever lost
              </summary>
              <div className="mt-2 flex flex-col gap-1">
                {versions.map((v) => (
                  <div key={v.path} className="flex items-center gap-2 px-1 py-1">
                    <span className="flex-1 font-mono text-[11px] text-text-secondary">{v.name.replace("_", " · ")}</span>
                    <button
                      onClick={async () => {
                        try {
                          const old = await invoke<string>("read_text_file", { path: v.path });
                          if (window.confirm("Restore this version? The current text is snapshotted first.")) {
                            setBody(old);
                            await invoke("write_ideal_state", { vault: vaultPath, body: old });
                            setSavedAt(Date.now());
                            void loadVersions();
                          }
                        } catch (e) { console.error("restore ideal state", e); }
                      }}
                      className="rounded-md border border-border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent"
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            </details>
          )}
          {parsed.sections.length > 0 ? (
            <div className="relative mt-4">
              <div className="absolute bottom-4 left-[17px] top-4 w-px bg-border" aria-hidden />
              <div className="space-y-3">
                {parsed.sections.map((s) => {
                  const Icon = idealSectionIcon(s.title);
                  return (
                    <div key={s.title} className="relative flex gap-3.5">
                      <div className="relative z-10 mt-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-accent-border bg-accent-soft">
                        <Icon className="h-4 w-4 text-accent" />
                      </div>
                      <div className="min-w-0 flex-1 rounded-xl border border-border bg-surface p-4">
                        <div className="font-display text-sm font-semibold tracking-tight">{s.title}</div>
                        {s.body && (
                          <div className="mt-2 text-sm leading-relaxed text-text-secondary">
                            <Markdown source={s.body} compact />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-border bg-surface p-4 text-sm leading-relaxed text-text-secondary">
              <Markdown source={body} compact />
            </div>
          )}
        </div>
      )}
    </>
  );
}

// "Demo & Production" — its own top-level Settings section (sibling of Vault):
// the demo/production mode toggle (with the real clean-slate production switch)
// plus the importable starter packs. Kept separate from Vault so the mode
// control is easy to find.
function DemoModeSection({ vaultPath, onVaultMoved, onSetupDomains }: { vaultPath: string; onVaultMoved?: (path: string) => void; onSetupDomains?: () => void }) {
  const [appMode, setAppMode] = useState<"demo" | "production" | null>(null);
  const [switchingMode, setSwitchingMode] = useState(false);
  const [packs, setPacks] = useState<{ file: string; name: string; version: string; description: string | null; domains: string[] }[]>([]);
  const [importingPack, setImportingPack] = useState<string | null>(null);
  const [importedPacks, setImportedPacks] = useState<Set<string>>(new Set());
  const [note, setNote] = useState<string | null>(null);
  // The remembered production vault path, so switching demo<->production never
  // re-asks for the folder, and both locations can be shown.
  const [prodVault, setProdVault] = useState<string>(() => lsGet(LS.vaultProduction) || "");
  useEffect(() => {
    const loadMode = () =>
      invoke<{ mode: "demo" | "production" }>("engine_appmode_get").then((m) => setAppMode(m.mode)).catch(() => {});
    loadMode();
    invoke<typeof packs>("engine_pack_list").then(setPacks).catch(() => {});
    window.addEventListener("prevail:appmode", loadMode);
    return () => window.removeEventListener("prevail:appmode", loadMode);
  }, []);
  // When we're in production, the current vaultPath IS the production vault —
  // remember it (covers vaults set up before this round-trip logic existed).
  useEffect(() => {
    if (appMode === "production" && vaultPath && !vaultPath.includes("/.prevail/demo-vault")) {
      if (vaultPath !== prodVault) { setProdVault(vaultPath); lsSet(LS.vaultProduction, vaultPath); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appMode, vaultPath]);

  // Point the app at a chosen folder as the production vault. `runOnboarding`
  // is false when a starter pack already populated it — the pack IS the start.
  async function enterProduction(picked: string, runOnboarding: boolean) {
    // Snapshot before clearing the demo sandbox (a pre-event backup).
    await backupVaultNow(vaultPath);
    await invoke<{ vault: string; demoCleared: boolean }>("engine_production_init", { vault: picked, clearDemo: vaultPath });
    await invoke("engine_appmode_set", { mode: "production", vault: picked }).catch(() => {});
    setProdVault(picked); lsSet(LS.vaultProduction, picked);
    setAppMode("production");
    window.dispatchEvent(new Event("prevail:appmode"));
    onVaultMoved?.(picked);
    if (runOnboarding) onSetupDomains?.();
  }

  // Leave the demo sandbox for your own vault. If a production vault is already
  // remembered, just switch back to it (no re-pick, no onboarding); otherwise
  // pick a fresh folder and run setup.
  async function switchToProduction() {
    // Already have a production vault on disk? Round-trip straight back to it.
    if (prodVault) {
      const ok = await invoke<boolean>("vault_exists", { path: prodVault }).catch(() => false);
      if (ok) {
        setSwitchingMode(true); setNote(null);
        try {
          await invoke("engine_appmode_set", { mode: "production", vault: prodVault }).catch(() => {});
          setAppMode("production");
          window.dispatchEvent(new Event("prevail:appmode"));
          onVaultMoved?.(prodVault);
          setNote(`Back in your own vault (${prodVault}).`);
        } catch (e) { setNote(`Could not switch: ${String(e)}`); }
        finally { setSwitchingMode(false); }
        return;
      }
    }
    const confirmOk = await tauriConfirm(
      "Ready to set up your own vault? You'll choose a folder for it, then set up your domains. The demo sample data is cleared.",
      { title: "Use your own vault", kind: "info", okLabel: "Choose my vault folder", cancelLabel: "Stay in demo" },
    );
    if (!confirmOk) return;
    const picked = await open({ directory: true, multiple: false, title: "Choose a folder for your own vault" });
    if (!picked || typeof picked !== "string") return;
    setSwitchingMode(true);
    setNote(null);
    try {
      await enterProduction(picked, true);
    } catch (e) {
      setNote(`Could not set up your vault: ${String(e)}`);
    } finally {
      setSwitchingMode(false);
    }
  }
  // Return to the demo sandbox: repoint the app at the demo vault (re-seeding
  // the bundled sample data) and flip the flag. The production vault is
  // remembered, untouched, and one click away.
  async function switchToDemo() {
    setSwitchingMode(true);
    setNote(null);
    try {
      const demoPath = await invoke<string>("import_sample_vault");
      await invoke("engine_appmode_set", { mode: "demo", vault: demoPath }).catch(() => {});
      await invoke("engine_appmode_mark_demo", { vault: demoPath }).catch(() => {});
      setAppMode("demo");
      window.dispatchEvent(new Event("prevail:appmode"));
      onVaultMoved?.(demoPath);
      setNote("You're back in the demo sandbox. Your own vault is remembered and one click away.");
    } catch (e) {
      setNote(`Could not switch: ${String(e)}`);
    } finally {
      setSwitchingMode(false);
    }
  }
  async function importPack(p: { name: string; domains: string[] }) {
    // In demo mode, importing is an intent to keep something — trigger vault setup first,
    // then import the pack into the new vault once it's ready.
    if (appMode === "demo") {
      const ok = await tauriConfirm(
        `Starter packs are saved to your own vault. You're in demo: set up your vault now and "${p.name}" will be imported there.`,
        { title: "Set up your own vault first", kind: "info", okLabel: "Set up my vault", cancelLabel: "Keep exploring" },
      );
      if (!ok) return;
      const picked = await open({ directory: true, multiple: false, title: "Choose a folder for your own vault" });
      if (!picked || typeof picked !== "string") return;
      setSwitchingMode(true);
      setImportingPack(p.name);
      setNote(null);
      try {
        // The pack populates the vault, so skip domain onboarding entirely.
        await enterProduction(picked, false);
        const r = await invoke<{ created: string[]; skipped: string[] }>("engine_pack_import", { vault: picked, pack: p.name, overwrite: false });
        const parts: string[] = [];
        if (r.created.length) parts.push(`added ${r.created.join(", ")}`);
        if (r.skipped.length) parts.push(`kept ${r.skipped.join(", ")}`);
        setImportedPacks((s) => new Set(s).add(p.name));
        setNote(`Vault set up and ${p.name} imported: ${parts.join(" · ") || "no new domains"}.`);
        window.dispatchEvent(new Event("prevail:domains-changed"));
      } catch (e) {
        setNote(`Could not set up vault: ${String(e)}`);
      } finally {
        setSwitchingMode(false);
        setImportingPack(null);
      }
      return;
    }
    // Production mode — import directly into the current vault.
    setImportingPack(p.name);
    setNote(null);
    try {
      const r = await invoke<{ created: string[]; skipped: string[] }>("engine_pack_import", { vault: vaultPath, pack: p.name, overwrite: false });
      const parts: string[] = [];
      if (r.created.length) parts.push(`added ${r.created.join(", ")}`);
      if (r.skipped.length) parts.push(`kept ${r.skipped.join(", ")}`);
      setImportedPacks((s) => new Set(s).add(p.name));
      setNote(`Imported ${p.name}: ${parts.join(" · ") || "no new domains"}. Find them in your sidebar.`);
      window.dispatchEvent(new Event("prevail:domains-changed"));
    } catch (e) {
      setNote(`Import failed: ${String(e)}`);
    } finally {
      setImportingPack(null);
    }
  }
  const isDemo = appMode === "demo";
  return (
    <>
      <SettingsHeader
        title="Demo Mode"
        subtitle="Explore Prevail with sample data, then set up your own vault when you're ready."
      />
      {/* Visual stage: Demo -> Your Vault. The current stage glows. */}
      <div className="mb-5 flex items-stretch gap-3">
        <div className={`flex-1 rounded-xl border p-4 text-center transition-colors ${isDemo ? "border-accent-border bg-accent-soft ring-2 ring-accent/30" : "border-border bg-surface opacity-60"}`}>
          <Sparkles className={`mx-auto h-6 w-6 ${isDemo ? "text-accent" : "text-text-muted"}`} />
          <div className={`mt-2 font-mono text-[11px] font-bold uppercase tracking-[0.18em] ${isDemo ? "text-accent" : "text-text-muted"}`}>Demo</div>
          <div className="mt-0.5 text-xs text-text-secondary">Sample data to explore</div>
          {isDemo && <div className="mt-1 font-mono text-[10px] font-bold uppercase tracking-wider text-accent">You are here</div>}
        </div>
        <div className="flex items-center text-text-muted"><ArrowRight className="h-5 w-5" /></div>
        <div className={`flex-1 rounded-xl border p-4 text-center transition-colors ${!isDemo && appMode ? "border-border bg-surface-warm ring-2 ring-text-muted/20" : "border-border bg-surface opacity-60"}`}>
          <ShieldCheck className={`mx-auto h-6 w-6 ${!isDemo && appMode ? "text-text-primary" : "text-text-muted"}`} />
          <div className={`mt-2 font-mono text-[11px] font-bold uppercase tracking-[0.18em] ${!isDemo && appMode ? "text-text-primary" : "text-text-muted"}`}>Your Vault</div>
          <div className="mt-0.5 text-xs text-text-secondary">Your own private workspace</div>
          {!isDemo && appMode && <div className="mt-1 font-mono text-[10px] font-bold uppercase tracking-wider text-text-secondary">You are here</div>}
        </div>
      </div>
      {/* Where each vault lives — demo (read-only) and production (the real
          data, a danger zone). Always visible so the two are never confused. */}
      <div className="mb-5 space-y-2">
        <div className="flex items-center gap-2 rounded-lg border border-border-subtle bg-surface px-3 py-2">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-text-muted" />
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-text-muted">Demo vault</span>
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-secondary" title={isDemo ? vaultPath : "~/.prevail/demo-vault"}>{isDemo ? vaultPath : "~/.prevail/demo-vault"}</span>
          <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-text-muted">sample · re-seeded</span>
        </div>
        <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${prodVault ? "border-warn/40 bg-warn/5" : "border-dashed border-border bg-surface"}`}>
          <ShieldCheck className={`h-3.5 w-3.5 shrink-0 ${prodVault ? "text-warn" : "text-text-muted"}`} />
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-text-muted">Your vault</span>
          {prodVault ? (
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-primary" title={prodVault}>{prodVault}</span>
          ) : (
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-muted">not set up yet</span>
          )}
          {prodVault && <span className="shrink-0 font-mono text-[9px] font-bold uppercase tracking-wider text-warn">real data · do not move/delete</span>}
        </div>
        {prodVault && (
          <p className="px-1 text-[10px] text-text-muted">
            This folder holds your real vault. Switching to demo never touches it; do not delete or move it from Finder, or Prevail will lose track of it.
          </p>
        )}
      </div>
      {/* Action: in demo, the 3-step setup; in your own vault, a quiet way back. */}
      {isDemo && prodVault ? (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-warm p-4">
          <p className="text-sm text-text-secondary">You have your own vault set up. Switch back to it any time, no re-setup.</p>
          <button
            onClick={switchToProduction}
            disabled={switchingMode}
            className="shrink-0 inline-flex items-center gap-2 rounded-md border border-accent-border bg-accent px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
          >
            {switchingMode ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {switchingMode ? "Switching…" : "Switch to my vault"}
          </button>
        </div>
      ) : isDemo ? (
        <div className="mb-4 rounded-xl border border-accent-border bg-accent-soft p-4">
          <div className="mb-3 text-sm font-semibold text-text-primary">Setting up your own vault takes three steps:</div>
          <div className="mb-4 flex items-stretch gap-2">
            {[
              { n: 1, label: "Choose your vault folder" },
              { n: 2, label: "Set up your domains" },
              { n: 3, label: "Start for real, demo data cleared" },
            ].map((step, i) => (
              <Fragment key={step.n}>
                {i > 0 && (
                  <div className="flex shrink-0 items-center text-accent">
                    <ArrowRight className="h-4 w-4" />
                  </div>
                )}
                <div className="flex flex-1 flex-col items-center gap-1.5 rounded-lg border border-accent-border bg-background/60 p-2.5 text-center">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-background">{step.n}</span>
                  <span className="text-xs leading-tight text-text-secondary">{step.label}</span>
                </div>
              </Fragment>
            ))}
          </div>
          <button
            onClick={switchToProduction}
            disabled={switchingMode}
            className="inline-flex items-center gap-2 rounded-md border border-accent-border bg-accent px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
          >
            {switchingMode ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            {switchingMode ? "Setting up…" : "Set up my own vault"}
          </button>
        </div>
      ) : appMode ? (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-warm p-4">
          <p className="text-sm text-text-secondary">You're in your own vault. You can explore the demo sandbox any time.</p>
          <button
            onClick={switchToDemo}
            disabled={switchingMode}
            className="shrink-0 inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-surface-warm disabled:opacity-50"
          >
            {switchingMode ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {switchingMode ? "Switching…" : "Explore demo sandbox"}
          </button>
        </div>
      ) : null}
      {packs.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-text-primary">
            <Sparkles className="h-3.5 w-3.5" /> Starter packs
          </div>
          <p className="mb-3 text-xs text-text-muted">
            Import a ready-made set of domains for your situation. Import one at a time; existing domains are always kept, never overwritten.
          </p>
          {/* Visible result right where you're looking, not just a footer. */}
          {note && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-accent-border bg-accent-soft px-3 py-2 text-xs text-text-primary">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
              <span>{note}</span>
            </div>
          )}
          <div className="flex flex-col gap-2">
            {packs.map((p) => {
              const imported = importedPacks.has(p.name);
              const busy = importingPack === p.name;
              return (
                <div key={p.file} className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${imported ? "border-accent-border bg-accent-soft" : "border-border bg-surface"}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                      {p.name}
                      {imported && <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-background"><Check className="h-3 w-3" /> Imported</span>}
                    </div>
                    {p.description && <div className="mt-0.5 text-xs text-text-muted">{p.description}</div>}
                    <div className="mt-1 font-mono text-[10px] text-text-secondary">{p.domains.join(" · ")}</div>
                  </div>
                  <button
                    onClick={() => importPack(p)}
                    disabled={importingPack !== null || imported}
                    className={`shrink-0 inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm disabled:opacity-50 ${imported ? "border-accent-border bg-accent-soft text-accent" : "border-border bg-background hover:bg-surface-warm"}`}
                  >
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : imported ? <Check className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
                    {busy ? "Importing…" : imported ? "Imported" : "Import"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {/* Footer so the page closes cleanly instead of ending abruptly. */}
      <div className="mt-6 flex items-center gap-2 border-t border-border-subtle pt-4 text-xs text-text-muted">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-text-muted" />
        <span>
          {isDemo
            ? "You're in demo mode. Importing a pack sets up your own vault and moves you out of demo: or use the button above to set up your vault first."
            : "You're in your own vault. Import a starter pack any time to add ready-made domains."}
        </span>
      </div>
    </>
  );
}

function VaultSettings({ vaultPath, onChange, onSetupDomains, onVaultMoved }: { vaultPath: string; onChange: () => void; onSetupDomains?: () => void; onVaultMoved?: (path: string) => void }) {
  const [backingUp, setBackingUp] = useState(false);
  const [backupNote, setBackupNote] = useState<string | null>(null);
  // "Move vault into the app" — copy the current vault into the app-owned
  // location (~/.prevail/vault) via the engine, non-destructively, then repoint.
  const [moving, setMoving] = useState(false);
  const [moveNote, setMoveNote] = useState<string | null>(null);
  const embedded = vaultPath.replace(/\/+$/, "").endsWith("/.prevail/vault");
  async function moveIntoApp() {
    setMoving(true);
    setMoveNote(null);
    try {
      const r = await invoke<{ dest: string; alreadyEmbedded: boolean; copied: number; sourceFiles: number; ok: boolean }>(
        "engine_vault_embed",
        { vault: vaultPath },
      );
      if (r.alreadyEmbedded) {
        setMoveNote("Vault is already inside the app.");
      } else if (r.ok) {
        setMoveNote(`Moved ${r.copied} file${r.copied === 1 ? "" : "s"} into the app. Your original folder is left untouched.`);
        onVaultMoved?.(r.dest);
      } else {
        setMoveNote(`Move incomplete (${r.copied}/${r.sourceFiles} files). Your original folder is untouched; nothing was changed.`);
      }
    } catch (e) {
      setMoveNote(`Move failed: ${String(e)}`);
    } finally {
      setMoving(false);
    }
  }
  async function backupVault() {
    setBackingUp(true);
    setBackupNote(null);
    try {
      const res = await invoke<BackupResult>("engine_vault_backup", { vault: vaultPath, domainOpt: null });
      if (res.ok) {
        const nDomains = res.domains?.length ?? 0;
        const files = res.file_count ?? 0;
        setBackupNote(
          `Backed up ${nDomains} domain${nDomains === 1 ? "" : "s"} · ${files} file${files === 1 ? "" : "s"} · ${bytesHuman(res.bytes ?? 0)}${res.archive_path ? ` → ${res.archive_path}` : ""}`,
        );
      } else {
        setBackupNote(`Backup failed: ${res.error ?? "unknown error"}`);
      }
    } catch (e) {
      setBackupNote(`Backup failed: ${String(e)}`);
    } finally {
      setBackingUp(false);
    }
  }
  return (
    <>
      <SettingsHeader title="Vault" subtitle="Where Prevail reads + writes your domain folders. Each child folder with a state.md becomes a life domain." />
      <SettingRow label="Vault folder" desc="Currently selected workspace.">
        <button
          onClick={onChange}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-surface-warm"
        >
          <Folder className="h-3.5 w-3.5" />
          Change
        </button>
      </SettingRow>
      {onSetupDomains && (
        <SettingRow label="Domains" desc="Let Prevail recommend a starter set of life domains, or add more.">
          <button
            onClick={onSetupDomains}
            className="inline-flex items-center gap-2 rounded-md border border-accent-border bg-accent-soft px-3 py-1.5 text-sm text-accent hover:bg-accent hover:text-background"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Set up domains
          </button>
        </SettingRow>
      )}
      <div className="mt-1 rounded-lg border border-border bg-surface p-4 font-mono text-xs text-text-primary">
        {vaultPath}
      </div>
      {!embedded && (
        <SettingRow label="Move vault into the app" desc="Copy this vault into the app-owned location so there's no loose folder to manage. Your original folder is copied, never moved or deleted.">
          <button
            onClick={moveIntoApp}
            disabled={moving}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-surface-warm disabled:opacity-50"
          >
            {moving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Folder className="h-3.5 w-3.5" />}
            {moving ? "Moving…" : "Move into app"}
          </button>
        </SettingRow>
      )}
      {moveNote && (
        <div className="mt-1 rounded-lg border border-border-subtle bg-surface px-4 py-2 text-xs text-text-secondary">{moveNote}</div>
      )}
      <SettingRow label="Back up vault" desc="Write a compressed archive of the entire vault. Nothing is deleted.">
        <button
          onClick={backupVault}
          disabled={backingUp}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-surface-warm disabled:opacity-50"
        >
          {backingUp ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          {backingUp ? "Backing up…" : "Back up vault"}
        </button>
      </SettingRow>
      {backupNote && (
        <div className="mt-1 break-all rounded-lg border border-border-subtle bg-surface px-3 py-2 font-mono text-[11px] text-text-secondary">
          {backupNote}
        </div>
      )}
      <BackupAutomationCard vault={vaultPath} onChange={onChange} />
    </>
  );
}

// Scheduled automatic backups + restore points, on the Vault page. Reuses the
// module-scope backup scheduler; restore unpacks an archive over the vault
// after snapshotting the current state first.
function BackupAutomationCard({ vault, onChange }: { vault: string; onChange?: () => void }) {
  const [enabled, setEnabled] = useState(() => lsGet(BACKUP_CFG.enabled, "0") === "1");
  const [freq, setFreq] = useState(() => lsGet(BACKUP_CFG.freq, "weekly") || "weekly");
  const [changeThreshold, setChangeThreshold] = useState(() => lsGet(BACKUP_CFG.changeThreshold, "0"));
  const [backups, setBackups] = useState<{ name: string; path: string; bytes: number; mtime: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const refresh = () =>
    invoke<{ name: string; path: string; bytes: number; mtime: number }[]>("vault_backups_list", { destDir: lsGet(BACKUP_CFG.dest) || null })
      .then((b) => setBackups(Array.isArray(b) ? b : []))
      .catch(() => {});
  useEffect(() => {
    refresh();
    const f = () => refresh();
    window.addEventListener("prevail:backup-done", f);
    return () => window.removeEventListener("prevail:backup-done", f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const last = Number(lsGet(BACKUP_CFG.lastRun, "0")) || 0;
  return (
    <div className="mt-4 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-3">
        <RotateCw className="h-4 w-4 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <div className="font-display text-sm font-semibold tracking-tight">Automatic backups</div>
          <div className="text-xs text-text-secondary">
            Snapshots the whole vault on a schedule (and before risky operations like encryption or a mode switch), kept outside the vault. Old ones are pruned automatically.
            {enabled && last > 0 && ` Last backup ${formatFreshness(Math.max(0, (Date.now() - last) / 1000))} ago.`}
          </div>
        </div>
        <select value={freq} onChange={(e) => { setFreq(e.target.value); lsSet(BACKUP_CFG.freq, e.target.value); }} disabled={!enabled}
          className="rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] text-text-secondary disabled:opacity-40">
          <option value="daily">daily</option>
          <option value="weekly">weekly</option>
          <option value="monthly">monthly</option>
        </select>
        <label className="flex items-center gap-1.5 font-mono text-[11px] text-text-muted">
          or every
          <input
            type="number" min="0" value={changeThreshold}
            onChange={(e) => { setChangeThreshold(e.target.value); lsSet(BACKUP_CFG.changeThreshold, e.target.value); }}
            disabled={!enabled}
            title="Also back up after this many vault changes (0 = off)"
            className="w-14 rounded-md border border-border bg-background px-2 py-1 text-right text-[11px] disabled:opacity-40"
          />
          changes
        </label>
        <button onClick={() => { const v = !enabled; setEnabled(v); lsSet(BACKUP_CFG.enabled, v ? "1" : "0"); }}
          className={`rounded-md border px-3 py-1 font-mono text-[11px] uppercase tracking-wider ${enabled ? "border-accent-border bg-accent-soft text-accent" : "border-border text-text-muted hover:border-accent-border hover:text-accent"}`}>
          {enabled ? "On" : "Off"}
        </button>
        <button onClick={async () => { setBusy(true); setNote(null); const ok = await backupVaultNow(vault); setNote(ok ? "Backup created." : "Backup failed."); setBusy(false); }}
          disabled={busy}
          className="rounded-md border border-border px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent disabled:opacity-50">
          {busy ? "…" : "Back up now"}
        </button>
      </div>
      {note && <div className="mt-2 text-xs text-text-secondary">{note}</div>}
      {backups.length > 0 && (
        <details className="mt-3 rounded-lg border border-border-subtle bg-background px-3 py-2">
          <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
            Restore points · {backups.length}
          </summary>
          <div className="mt-2 flex flex-col gap-1">
            {backups.map((b) => (
              <div key={b.path} className="flex items-center gap-2 px-1 py-1">
                <span className="flex-1 truncate font-mono text-[11px] text-text-secondary" title={b.path}>{b.name.replace("prevail-backup-", "").replace(".tar.gz", "")}</span>
                <span className="shrink-0 font-mono text-[10px] text-text-muted">{bytesHuman(b.bytes)}</span>
                <button
                  onClick={async () => {
                    const ok = await tauriConfirm(
                      "Restore this backup over your current vault? Your current state is backed up first, so this is reversible.",
                      { title: "Restore vault", kind: "warning", okLabel: "Restore", cancelLabel: "Cancel" },
                    );
                    if (!ok) return;
                    setBusy(true); setNote(null);
                    try {
                      await backupVaultNow(vault); // snapshot current state first
                      await invoke("vault_restore_archive", { vault, archive: b.path });
                      setNote("Restored. Reloading…");
                      onChange?.();
                      setTimeout(() => window.location.reload(), 900);
                    } catch (e) { setNote(`Restore failed: ${String(e)}`); }
                    finally { setBusy(false); }
                  }}
                  disabled={busy}
                  className="shrink-0 rounded-md border border-border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent disabled:opacity-50">
                  Restore
                </button>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function FrameworksSection() {
  const fwLens = useFrameworkLens();
  const activeFramework = FRAMEWORKS.find((f) => f.id === fwLens.framework);
  const activeLens = LENSES.find((l) => l.id === fwLens.lens);
  return (
    <>
      <SettingsHeader
        title="Frameworks & Lenses"
        subtitle="The bracketed preamble Prevail prepends to every prompt. A framework shapes the structure of the answer; a lens shapes the perspective it comes from."
      />

      {/* Why this matters, shown visually rather than as a paragraph. */}
      <div className="mb-7 rounded-2xl border border-accent-border bg-accent-soft/40 p-5">
        <div className="flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-accent">
          <Lightbulb className="h-3.5 w-3.5" /> Why this matters
        </div>

        {/* The flow: raw question, wrapped in framework + lens, sharper answer. */}
        <div className="mt-4 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          <div className="flex flex-1 flex-col items-center rounded-xl border border-border-subtle bg-background px-3 py-3 text-center">
            <MessageSquare className="h-5 w-5 text-text-muted" />
            <div className="mt-1.5 text-sm font-semibold text-text-primary">Your question</div>
            <div className="text-[11px] text-text-muted">as you'd type it</div>
          </div>
          <ArrowRight className="mx-auto h-4 w-4 shrink-0 rotate-90 text-accent sm:rotate-0" />
          <div className="flex flex-1 flex-col items-center rounded-xl border border-accent-border bg-accent-soft px-3 py-3 text-center">
            <div className="flex items-center gap-1.5 text-lg text-accent">◆<span className="text-text-muted">+</span>◇</div>
            <div className="mt-1.5 text-sm font-semibold text-accent">Framework + Lens</div>
            <div className="text-[11px] text-text-muted">a deliberate shape</div>
          </div>
          <ArrowRight className="mx-auto h-4 w-4 shrink-0 rotate-90 text-accent sm:rotate-0" />
          <div className="flex flex-1 flex-col items-center rounded-xl border border-border-subtle bg-background px-3 py-3 text-center">
            <Sparkles className="h-5 w-5 text-accent" />
            <div className="mt-1.5 text-sm font-semibold text-text-primary">Sharper answer</div>
            <div className="text-[11px] text-text-muted">structured, on-angle</div>
          </div>
        </div>

        {/* What each control does. */}
        <div className="mt-3 grid grid-cols-1 gap-3">
          <div className="rounded-xl border border-border-subtle bg-background p-3.5">
            <div className="flex items-center gap-2"><span className="text-accent">◆</span><span className="text-sm font-semibold text-text-primary">Framework</span></div>
            <p className="mt-1 text-[13px] leading-snug text-text-secondary">Shapes the structure. BLUF leads with the answer; SCQA walks situation to recommendation.</p>
          </div>
          <div className="rounded-xl border border-border-subtle bg-background p-3.5">
            <div className="flex items-center gap-2"><span className="text-accent">◇</span><span className="text-sm font-semibold text-text-primary">Lens</span></div>
            <p className="mt-1 text-[13px] leading-snug text-text-secondary">Shapes the perspective. First principles, steelman, or an outsider's eye.</p>
          </div>
        </div>

        <p className="mt-3 text-[13px] text-text-muted">Stack a framework with a lens to pressure-test one decision from several angles at once.</p>
      </div>

      {/* One full-width column, stacked: Frameworks, then Lenses. */}
      <div className="space-y-8">
        <PreambleColumn
          glyph="◆"
          title="Frameworks"
          tagline="Structure: how the answer is shaped."
          options={FRAMEWORKS}
          active={activeFramework}
          selectedId={fwLens.framework}
          onSelect={fwLens.setFramework}
        />
        <PreambleColumn
          glyph="◇"
          title="Lenses"
          tagline="Perspective: the angle the answer comes from."
          options={LENSES}
          active={activeLens}
          selectedId={fwLens.lens}
          onSelect={fwLens.setLens}
        />
      </div>

      {/* More coming soon + feedback + website. */}
      <div className="mt-8 rounded-2xl border border-border-subtle bg-surface p-5">
        <div className="flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">
          <Sparkles className="h-3.5 w-3.5 text-accent" /> More coming soon
        </div>
        <p className="mt-2 max-w-3xl text-sm text-text-secondary">
          Custom frameworks and lenses (write and save your own) are on the way. Today's set ships with Prevail. Have a
          framework or lens you'd want built in? Tell us, it shapes what we add next.
        </p>
        <div className="mt-3.5 flex flex-wrap gap-2">
          <a
            href="https://github.com/fru-dev3/prevail-desktop/issues/new"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-text-secondary transition-colors hover:border-accent-border hover:text-accent"
          >
            <MessageSquare className="h-3.5 w-3.5" /> Suggestions & feedback
          </a>
          <a
            href="https://prevail.sh"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-text-secondary transition-colors hover:border-accent-border hover:text-accent"
          >
            <Globe className="h-3.5 w-3.5" /> prevail.sh
          </a>
        </div>
      </div>
    </>
  );
}





// Stable color picker for the first-letter skill avatars. Same skill
// name always lands on the same swatch so the grid feels consistent.
const SKILL_AVATAR_PALETTE = [
  { bg: "#ef6c4a", fg: "#ffffff" }, // orange
  { bg: "#3b82f6", fg: "#ffffff" }, // blue
  { bg: "#6366f1", fg: "#ffffff" }, // indigo
  { bg: "#8b5cf6", fg: "#ffffff" }, // violet
  { bg: "#a855f7", fg: "#ffffff" }, // purple
  { bg: "#ec4899", fg: "#ffffff" }, // pink
  { bg: "#10b981", fg: "#ffffff" }, // emerald
  { bg: "#14b8a6", fg: "#ffffff" }, // teal
  { bg: "#f59e0b", fg: "#1a1a1a" }, // amber
  { bg: "#0ea5e9", fg: "#ffffff" }, // sky
];

function pickSkillColor(name: string): { bg: string; fg: string } {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = ((h << 5) - h) + name.charCodeAt(i);
    h |= 0;
  }
  return SKILL_AVATAR_PALETTE[Math.abs(h) % SKILL_AVATAR_PALETTE.length];
}

function SkillsSection({ vaultPath }: { vaultPath: string }) {
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("");
  const [listOpen, setListOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    invoke<SkillEntry[]>("scan_skills", { vault: vaultPath })
      .then((s) => { if (mounted) setSkills(s); })
      .catch(() => { if (mounted) setSkills([]); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [vaultPath]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter((s) =>
      s.name.toLowerCase().includes(q) ||
      s.domain.toLowerCase().includes(q) ||
      (s.description ?? "").toLowerCase().includes(q));
  }, [skills, filter]);

  async function openSkill(p: string) {
    try { await invoke("open_in_finder", { path: p }); } catch {}
  }
  async function rescan() {
    setLoading(true);
    try {
      const s = await invoke<SkillEntry[]>("scan_skills", { vault: vaultPath });
      setSkills(s);
    } catch { /* ignore */ }
    setLoading(false);
  }

  return (
    <>
      <SettingsHeader
        title="Skills"
        subtitle="Drop a folder under any domain's skills/ directory to expose it here. The first non-empty line of SKILL.md or README.md becomes the description."
      />

      <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
        {/* Toolbar: title · count · refresh · search */}
        <div className="mb-4 flex items-center gap-3">
          <h3 className="font-display text-xl font-semibold tracking-tight">My Skills</h3>
          <span className="rounded-full bg-surface-warm px-2 py-0.5 font-mono text-[10px] text-text-secondary">{skills.length}</span>
          <button
            onClick={rescan}
            title="Re-scan vault"
            className="ml-1 flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-surface-warm hover:text-text-primary"
          >
            ↻
          </button>
          <div className="flex-1" />
          <div className="relative w-64">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted">⌕</span>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search skills…"
              className="w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-2 text-sm focus:border-accent-border focus:outline-none"
            />
          </div>
        </div>

        {/* Path bar */}
        <div className="mb-4 flex items-center gap-2 rounded-md bg-background px-3 py-2 font-mono text-[11px] text-text-secondary">
          <Folder className="h-3.5 w-3.5 text-text-muted" />
          <span className="truncate" title={vaultPath}>{vaultPath}</span>
        </div>

        {loading && <div className="py-6 text-center text-sm text-text-muted">scanning…</div>}
        {!loading && skills.length === 0 && (
          <div className="rounded-lg border border-dashed border-border bg-background p-10 text-center">
            <Sparkles className="mx-auto h-8 w-8 text-text-muted opacity-50" />
            <p className="mt-3 text-sm text-text-muted">
              No skills found. Try creating <code className="text-accent">{"<domain>/skills/<skill-name>/"}</code> with a SKILL.md.
            </p>
          </div>
        )}
        {!loading && filtered.length === 0 && skills.length > 0 && (
          <div className="rounded-lg border border-dashed border-border bg-background p-6 text-center text-sm text-text-muted">
            No skills match <code className="text-accent">{filter}</code>.
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <>
            <button
              onClick={() => setListOpen((v) => !v)}
              className="flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left text-xs text-text-muted hover:text-text-secondary transition-colors"
            >
              <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-transform ${listOpen ? "rotate-90" : ""}`} strokeWidth={2.5} />
              {listOpen ? "Collapse" : `Show ${filtered.length} skill${filtered.length === 1 ? "" : "s"}`}
            </button>
            {listOpen && (
              <ul className="ml-4 mt-1 flex flex-col gap-1 border-l border-border-subtle pl-3">
                {filtered.map((s) => {
                  const cleaned = (s.description ?? "").replace(/^[>*\-\s]+/, "").trim();
                  const color = pickSkillColor(s.name);
                  const initial = (s.name || "·").charAt(0).toUpperCase();
                  return (
                    <li key={s.path}>
                      <button
                        onClick={() => openSkill(s.path)}
                        title={s.path}
                        className="group flex w-full items-start gap-4 rounded-xl px-3 py-3 text-left transition-colors hover:bg-surface-warm"
                      >
                        <span
                          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg font-display text-xl font-bold ring-1 ring-black/5"
                          style={{ background: color.bg, color: color.fg }}
                        >
                          {initial}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-2">
                            <span className="font-display text-base font-semibold tracking-tight text-text-primary">{s.name}</span>
                            <span className="rounded-md border border-border-subtle bg-background px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted">
                              {titleCase(s.domain)}
                            </span>
                          </div>
                          {cleaned && (
                            <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-text-secondary">
                              {cleaned}
                            </p>
                          )}
                        </div>
                        <Folder className="mt-1.5 h-4 w-4 shrink-0 text-text-muted opacity-0 transition-opacity group-hover:opacity-100" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// INGESTION SECTION — UI surface for the triple-tier engine
//   Tier A: MCP subprocess registry (start/stop/status)
//   Tier B: Composio managed gateway (API key + start)
//   Tier C: Playwright headed browser automation (per-portal run)
//
// All three speak to commands defined in src-tauri/src/ingestion/.
// Status is polled every 4s while the section is mounted.



function IngestionSection() {
  const [tiers, setTiers] = useState<IngestionTierStatus[]>([]);
  const [mcp, setMcp] = useState<IngestionMcpServer[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [artifacts, setArtifacts] = useState<IngestionArtifact[]>([]);

  async function refresh() {
    try {
      const [t, m] = await Promise.all([
        invoke<IngestionTierStatus[]>("ingestion_status"),
        invoke<IngestionMcpServer[]>("ingestion_mcp_list"),
      ]);
      setTiers(t);
      setMcp(m);
      setErr(null);
    } catch (e) {
      setErr(String(e));
    }
  }
  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 4000);
    let unl: UnlistenFn | null = null;
    (async () => {
      unl = await listen<IngestionArtifact>(
        "ingestion:artifact",
        (e) => setArtifacts((cur) => [e.payload, ...cur].slice(0, 50)),
      );
    })();
    return () => { window.clearInterval(id); if (unl) unl(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openMcpConfig() {
    try {
      const p = await invoke<string>("ingestion_mcp_config_init");
      await invoke("open_in_finder", { path: p });
    } catch (e) { console.error(e); }
  }
  async function reloadMcp() {
    try {
      await invoke("ingestion_mcp_reload");
      await refresh();
    } catch (e) { console.error(e); }
  }

  return (
    <>
      <SettingsHeader
        title="Ingestion"
        subtitle="Triple-tier data engine. Pull artifacts from MCP servers, the Composio gateway, or a headed browser into the right domain folder: without leaving the app."
      />
      {err && (
        <div className="mb-4 rounded border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">{err}</div>
      )}

      <div className="space-y-6">
        {tiers.map((t) => (
          <IngestionTierCard
            key={t.id}
            tier={t}
            mcp={t.id === "tier_a_mcp" ? mcp : undefined}
            onRefresh={refresh}
            onOpenMcpConfig={openMcpConfig}
            onReloadMcp={reloadMcp}
          />
        ))}
        {tiers.length === 0 && (
          <div className="rounded border border-dashed border-border bg-surface p-6 text-sm text-text-muted">
            Loading tier status…
          </div>
        )}

        <IngestionBrowserRunner />

        <IngestionAuditPanel />

        {artifacts.length > 0 && (
          <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <div className="font-display text-base font-semibold tracking-tight">Recent artifacts</div>
              <span className="rounded-full bg-surface-warm px-2 py-0.5 font-mono text-[10px] text-text-secondary">{artifacts.length}</span>
            </div>
            <ul className="flex flex-col gap-1.5">
              {artifacts.map((a, i) => (
                <li key={`${a.path}_${i}`} className="flex items-center gap-3 rounded-md border border-border-subtle bg-background px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-mono text-sm text-text-primary">{a.original}</span>
                      <span className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-[9px] text-accent">{a.domain}</span>
                      <span className="rounded bg-surface-warm px-1.5 py-0.5 font-mono text-[9px] text-text-secondary">{a.source}</span>
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[10px] text-text-muted">
                      {a.path} · {a.sha256.slice(0, 12)}… · {(a.size / 1024).toFixed(1)} KB
                    </div>
                  </div>
                  <button
                    onClick={() => invoke("open_in_finder", { path: a.path })}
                    className="shrink-0 rounded border border-border bg-background px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent"
                  >
                    reveal
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}

// Tier D — one allowlisted CLI integration (mirrors the Rust CliProvider).


// Post-login automation step the Tier C engine executes. The shape
// mirrors the Rust PostLoginAction enum (serde tag = "type").


// Audit log surface. Reads the appended JSON lines from
// ~/Library/Application Support/Prevail/ingestion.log via Tauri.
// Collapsed by default to avoid noise; expand on click. Each ingest
// row offers a "reveal" button when the path still exists on disk.

// Editable list of post-login automation steps for Tier C. Lets the
// user add / remove / reorder / tweak actions inline without
// touching JSON. Each step renders the fields its action type
// needs and nothing else. Reorder via ↑↓ buttons; delete via ×.


// Read-only reference of every keyboard shortcut wired into the app.
// Helps discoverability — most users won't find ⌘P or ⌘B by accident.
function ShortcutsSection() {
  type Entry = { keys: string[]; label: string; desc: string };
  const groups: Array<{ name: string; entries: Entry[] }> = [
    {
      name: "Navigation",
      entries: [
        { keys: ["⌘", "K"], label: "New chat", desc: "Drops the current domain + thread, lands on the no-domain dashboard." },
        { keys: ["⌘", "P"], label: "Quick switcher", desc: "Fuzzy finder over every domain and every saved thread." },
        { keys: ["⌘", "B"], label: "Toggle sidebar", desc: "Collapses or expands the domain rail." },
        { keys: ["⌘", ","], label: "Open Settings", desc: "Jumps to the settings panel from anywhere." },
      ],
    },
    {
      name: "Composer",
      entries: [
        { keys: ["↵"], label: "Send (Enter mode)", desc: "Default. Switch to ⌘+↵ in Settings → General → Send messages with." },
        { keys: ["⇧", "↵"], label: "New line", desc: "Insert a hard newline without sending." },
        { keys: ["↑"], label: "Recall last prompt", desc: "Walk backward through this domain's prompt history." },
        { keys: ["↓"], label: "Recall next prompt", desc: "Walk forward; ↓ past the newest clears the composer." },
        { keys: ["/"], label: "Skill autocomplete", desc: "Type / and a few letters to fuzzy-match a skill in this domain." },
      ],
    },
    {
      name: "Thread rail",
      entries: [
        { keys: ["double-click"], label: "Rename", desc: "Edit the thread's title inline. ↵ to confirm." },
        { keys: ["+"], label: "New thread", desc: "Creates an empty thread file immediately: rename it before typing." },
      ],
    },
  ];

  const Key = ({ children }: { children: React.ReactNode }) => (
    <kbd className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded border border-border bg-background px-1.5 font-mono text-[11px] font-medium text-text-primary shadow-sm">
      {children}
    </kbd>
  );

  return (
    <>
      <SettingsHeader title="Shortcuts" subtitle="Keyboard surface for common actions. Most are global: they work even while you're typing." />
      <div className="space-y-6">
        {groups.map((g) => (
          <section key={g.name} className="rounded-xl border border-border bg-surface p-5 shadow-sm">
            <div className="mb-3 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">
              {g.name}
            </div>
            <ul className="flex flex-col divide-y divide-border-subtle">
              {g.entries.map((e, i) => (
                <li key={i} className="flex items-center justify-between gap-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-text-primary">{e.label}</div>
                    <div className="mt-0.5 text-xs text-text-secondary">{e.desc}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {e.keys.map((k, j) => (
                      <Fragment key={j}>
                        <Key>{k}</Key>
                        {j < e.keys.length - 1 && e.keys.length > 1 && k.length === 1 && e.keys[j+1].length === 1 && (
                          <span className="text-[11px] text-text-muted">+</span>
                        )}
                      </Fragment>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

function AboutSection({ vaultPath }: { vaultPath: string }) {
  const verify = useCliVerifyLive();
  const [checking, setChecking] = useState(false);
  const [latest, setLatest] = useState<string | null>(null);
  const [checkErr, setCheckErr] = useState<string | null>(null);
  const [checks, setChecks] = useState<DiagCheck[] | null>(null);
  const [diagRunning, setDiagRunning] = useState(false);
  const [diagCopied, setDiagCopied] = useState(false);

  // A real health check: each item verifies one thing Prevail depends on and
  // says why it matters, with a pass/warn/fail verdict you can act on.
  async function runDiagnosis() {
    setDiagRunning(true);
    const out: DiagCheck[] = [];
    let d: { desktop_version: string; os: string; arch: string; engine_version?: string; engine_bin: string; engine_bundled: boolean; app_support: string } | null = null;
    try { d = await invoke("app_diagnostics"); } catch { /* engine probe failed */ }

    // Engine sidecar.
    if (d) {
      const match = d.engine_version && d.engine_version.length > 0;
      out.push({
        label: "Engine", status: match ? "ok" : "warn",
        detail: `${d.engine_version ?? "unknown"} ${d.engine_bundled ? "(bundled)" : `(${d.engine_bin})`}`,
        why: "The engine runs every chat, council, and benchmark. Bundled = shipped with the app.",
      });
    } else {
      out.push({ label: "Engine", status: "fail", detail: "not reachable", why: "Without the engine, nothing runs. Reinstall the app." });
    }

    // Vault: reachable, writable, encryption state.
    if (vaultPath) {
      let exists = false;
      try { exists = await invoke<boolean>("vault_exists", { path: vaultPath }); } catch { /* */ }
      let enc: { encrypted: boolean; unlocked: boolean } | null = null;
      try { enc = await invoke("engine_vault_status", { vault: vaultPath }); } catch { /* */ }
      const encNote = enc?.encrypted ? (enc.unlocked ? " · encrypted, unlocked" : " · encrypted, LOCKED") : "";
      out.push({
        label: "Vault", status: exists ? (enc?.encrypted && !enc.unlocked ? "warn" : "ok") : "fail",
        detail: `${vaultPath}${encNote}`,
        why: exists ? "Your data lives here. An encrypted+locked vault can't be read until you unlock it." : "The vault path doesn't exist; pick or restore it in Settings → Vault.",
      });
    } else {
      out.push({ label: "Vault", status: "fail", detail: "no vault selected", why: "Set up a vault in Settings → Vault or Demo Mode." });
    }

    // Agents: detected AND validated.
    let clis: CliInfo[] = [];
    try { clis = await invoke<CliInfo[]>("detect_clis"); } catch { /* */ }
    const detected = clis.filter((c) => c.available);
    const valid = detected.filter((c) => verify.get(c.id)?.status === "ok");
    out.push({
      label: "Agents", status: valid.length > 0 ? "ok" : detected.length > 0 ? "warn" : "fail",
      detail: detected.length === 0 ? "none detected" : detected.map((c) => `${c.label}${verify.get(c.id)?.status === "ok" ? " ✓" : verify.get(c.id)?.status === "failed" ? " ✗" : " ?"}`).join(", "),
      why: valid.length > 0 ? "These models are installed and answered a live test." : detected.length > 0 ? "Installed but not validated; open Settings → Models and re-check (often a login/token issue)." : "Install at least one CLI (claude, codex, ollama) to chat.",
    });

    // Network + Bunker.
    const online = typeof navigator !== "undefined" ? navigator.onLine : true;
    const bunker = isBunkerOn();
    out.push({
      label: "Network", status: bunker ? "info" : online ? "ok" : "warn",
      detail: bunker ? "Bunker Mode ON (local-only by design)" : online ? "online" : "offline",
      why: bunker ? "Cloud is intentionally blocked; only local models run." : online ? "Cloud models and updates are reachable." : "Offline; cloud models and update checks won't work until reconnected.",
    });

    // Update check.
    try {
      const u = await checkUpdate();
      out.push({
        label: "Updates", status: u ? "warn" : "ok",
        detail: u ? `v${u.version} available` : `on the latest (v${APP_VERSION})`,
        why: u ? "Click 'Check for updates' above to install it in place." : "You're running the newest release.",
      });
    } catch {
      out.push({ label: "Updates", status: "info", detail: "couldn't check", why: "Update feed unreachable (offline or first release). Not a problem." });
    }

    // Background surfaces.
    try {
      const tg = await invoke<{ running: boolean }>("telegram_bridge_status");
      const wu = await invoke<{ running: boolean }>("webui_status");
      const surfaces = [tg.running ? "Telegram" : null, wu.running ? "WebUI" : null].filter(Boolean);
      out.push({
        label: "External access", status: surfaces.length > 0 ? "info" : "ok",
        detail: surfaces.length > 0 ? `LIVE: ${surfaces.join(", ")}` : "none active",
        why: surfaces.length > 0 ? "These bridges can reach the app from outside right now." : "No external surface is exposed.",
      });
    } catch { /* */ }

    setChecks(out);
    setDiagRunning(false);
  }

  function diagText(): string {
    const head = `Prevail Desktop v${APP_VERSION}`;
    const lines = (checks ?? []).map((c) => `[${c.status.toUpperCase()}] ${c.label}: ${c.detail}`);
    return [head, ...lines].join("\n");
  }

  async function exportConfig() {
    const cfg: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k.startsWith("prevail.")) cfg[k] = localStorage.getItem(k) ?? "";
    }
    try {
      const path = await save({ defaultPath: "prevail-config.json", filters: [{ name: "JSON", extensions: ["json"] }] });
      if (!path) return;
      await invoke("write_text_file", { path, contents: JSON.stringify(cfg, null, 2) });
    } catch (e) { console.error("exportConfig", e); }
  }

  async function importConfig() {
    try {
      const path = await open({ multiple: false, directory: false, filters: [{ name: "JSON", extensions: ["json"] }] });
      if (!path || typeof path !== "string") return;
      const json = await invoke<string>("read_text_file", { path });
      const cfg = JSON.parse(json) as Record<string, string>;
      for (const [k, v] of Object.entries(cfg)) if (k.startsWith("prevail.")) localStorage.setItem(k, String(v));
      window.location.reload();
    } catch (e) { console.error("importConfig", e); }
  }

  async function resetConfig() {
    const ok = await tauriConfirm("Reset all Prevail preferences to defaults? Your vault, chats, and stored secrets are not affected.", { title: "Reset to defaults", kind: "warning" });
    if (!ok) return;
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      // Reset prefs + desktop settings, but keep the vault selection.
      if ((k.startsWith("prevail.pref.") || k.startsWith("prevail.desktop.") || k.startsWith("prevail.about.")) && k !== "prevail.desktop.vaultPath") keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
    window.location.reload();
  }

  async function uninstall(scope: "app" | "data") {
    const msg = scope === "app"
      ? "Remove Prevail.app from Applications? Your config, chats, and secrets stay so you can reinstall later."
      : "Remove the app, all app data, caches, and stored secrets? Your vault folder is NOT deleted. This cannot be undone.";
    const ok = await tauriConfirm(msg, { title: "Uninstall Prevail", kind: "warning" });
    if (!ok) return;
    try { await invoke("app_uninstall", { scope }); } catch (e) { console.error("uninstall", e); }
  }

  const [installing, setInstalling] = useState(false);
  async function checkForUpdates() {
    setChecking(true);
    setCheckErr(null);
    setLatest(null);
    try {
      // Preferred path: the Tauri updater — checks the signed latest.json feed,
      // downloads + installs in-place, then relaunches. No browser detour.
      const update = await checkUpdate();
      if (update) {
        setLatest(update.version);
        setInstalling(true);
        await update.downloadAndInstall();
        await relaunch();
        return;
      }
      // No update object → already current.
      setLatest(APP_VERSION);
    } catch (_pluginErr) {
      // Updater feed not reachable yet (e.g. first release before latest.json
      // is published) → fall back to the GitHub releases API + open the page.
      try {
        const r = await fetch("https://api.github.com/repos/fru-dev3/prevail-desktop/releases?per_page=10");
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const releases = await r.json() as Array<{ tag_name: string; prerelease: boolean; html_url: string }>;
        const top = releases.find((rel) => !rel.prerelease) ?? releases[0];
        if (!top) throw new Error("no releases found");
        setLatest(top.tag_name);
        try { await invoke("open_in_finder", { path: top.html_url }); } catch {}
      } catch (e) {
        setCheckErr(String(e).slice(0, 200));
      }
    } finally {
      setChecking(false);
      setInstalling(false);
    }
  }

  function Row({ label, href }: { label: string; href: string }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="flex w-full items-center justify-between gap-4 border-b border-border-subtle px-1 py-3 text-left text-sm text-text-primary last:border-0 hover:text-accent"
      >
        <span>{label}</span>
        <span className="text-text-muted">›</span>
      </a>
    );
  }

  const cmp = latest ? compareSemver(latest.replace(/^v/, ""), APP_VERSION) : 0;
  const upToDate = latest && cmp <= 0;
  const newer = latest && cmp > 0;

  return (
    <div className="mx-auto max-w-xl">
      <div className="flex flex-col items-center text-center">
        <img src="/logo.png" alt="Prevail" className="h-16 w-16 rounded-2xl shadow-md" />
        <h1 className="mt-3 font-display text-2xl font-extrabold tracking-tight">
          <Brand className="[letter-spacing:0.12em]" />
        </h1>
        <p className="mt-1 text-xs text-text-secondary">One desktop. Your AI council, grounded in your domains.</p>
      </div>

      {/* Update card — version + one-click install, compact. */}
      <div className="mt-4 rounded-xl border border-border bg-surface p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-surface-warm px-2.5 py-1 font-mono text-xs text-text-secondary">v{APP_VERSION}</span>
          <span className="flex-1 text-xs text-text-muted">
            {newer ? "An update is ready to install." : upToDate ? "You're on the latest release." : "Install updates in place, no browser needed."}
          </span>
          <button
            onClick={checkForUpdates}
            disabled={checking}
            className="shrink-0 rounded-md bg-text-primary px-3 py-1.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {installing ? "Installing…" : checking ? "Checking…" : newer ? "Download & install" : "Check for updates"}
          </button>
        </div>
        {latest && (
          <div className={`mt-2 rounded-md border px-3 py-1.5 text-xs ${
            upToDate ? "border-accent-border bg-accent-soft text-accent" : "border-warn/40 bg-warn/10 text-warn"
          }`}>
            {upToDate ? `Latest release (${latest}).` : newer ? `Update available: ${latest}. Click Download & install.` : `Latest: ${latest}`}
          </div>
        )}
        {checkErr && <div className="mt-2 rounded-md border border-warn/40 bg-warn/10 px-3 py-1.5 text-xs text-warn">{checkErr}</div>}
      </div>

      <div className="mt-3 rounded-xl border border-border bg-surface px-4 py-1 shadow-sm">
        <Row label="Help & documentation" href="https://github.com/fru-dev3/prevail-desktop#readme" />
        <Row label="Update log" href="https://github.com/fru-dev3/prevail-desktop/releases" />
        <Row label="Report an issue" href="https://github.com/fru-dev3/prevail-desktop/issues/new" />
        <Row label="Prevail CLI" href="https://github.com/fru-dev3/prevail-cli" />
        <Row label="Official website" href="https://prevail.sh" />
      </div>

      {/* Alpha / liability disclaimer */}
      <div className="mt-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-sm">
        <div className="mb-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">Alpha software</div>
        <p className="text-xs leading-relaxed text-text-secondary">
          Prevail is an early, experimental alpha released for demonstration and testing. It is provided "as is",
          without warranty of any kind, express or implied, and you use it at your own risk. The authors are not liable
          for any data loss, costs, or damages arising from its use. It runs third-party AI tools and, unless Bunker
          Mode is on, may send data to cloud providers. Always review anything important yourself. Feedback and bug
          reports are very welcome, they directly shape what comes next.
        </p>
        <a
          href="https://github.com/fru-dev3/prevail-desktop/issues/new"
          target="_blank"
          rel="noreferrer"
          className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-text-secondary transition-colors hover:border-accent-border hover:text-accent"
        >
          <MessageSquare className="h-3.5 w-3.5" /> Share feedback
        </a>
      </div>

      {/* Config — export / import / reset */}
      <div className="mt-3 rounded-xl border border-border bg-surface p-4 shadow-sm">
        <div className="mb-3 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">Configuration</div>
        <div className="flex flex-wrap gap-2">
          <button onClick={exportConfig}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-text-secondary hover:border-accent-border hover:text-accent">Export config…</button>
          <button onClick={importConfig}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-text-secondary hover:border-accent-border hover:text-accent">Import config…</button>
          <button onClick={resetConfig}
            className="rounded-md border border-warn/40 bg-warn/10 px-3 py-1.5 text-sm text-warn hover:bg-warn/20">Reset all to defaults</button>
        </div>
        <div className="mt-2 text-xs text-text-secondary">Backs up / restores all app preferences (not your vault). Reset clears every preference and reloads.</div>
      </div>

      {/* Diagnostics — a real health check, one row per thing Prevail needs. */}
      <div className="mt-3 rounded-xl border border-border bg-surface p-4 shadow-sm">
        <div className="mb-1 flex items-center justify-between">
          <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">Health check</div>
          <div className="flex gap-2">
            <button onClick={runDiagnosis} disabled={diagRunning}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-50">{diagRunning ? "Checking…" : "Run check"}</button>
            {checks && (
              <button onClick={() => { navigator.clipboard.writeText(diagText()).catch(() => {}); setDiagCopied(true); window.setTimeout(() => setDiagCopied(false), 1500); }}
                className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-text-secondary hover:border-accent-border hover:text-accent">{diagCopied ? "Copied" : "Copy report"}</button>
            )}
          </div>
        </div>
        <p className="mb-3 text-xs text-text-muted">Verifies everything Prevail depends on is healthy. Copy the report when filing an issue.</p>
        {checks && (
          <div className="flex flex-col gap-1.5">
            {checks.map((c) => (
              <div key={c.label} className="flex items-start gap-2.5 rounded-lg border border-border-subtle bg-background px-3 py-2">
                <span className={`mt-0.5 shrink-0 font-mono text-sm font-bold ${
                  c.status === "ok" ? "text-ok" : c.status === "fail" ? "text-warn" : c.status === "warn" ? "text-warn" : "text-text-muted"
                }`}>{c.status === "ok" ? "✓" : c.status === "fail" ? "✗" : c.status === "warn" ? "!" : "·"}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-text-primary">{c.label}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-secondary" title={c.detail}>{c.detail}</span>
                  </div>
                  <div className="text-[11px] leading-snug text-text-muted">{c.why}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Danger zone — uninstall (never touches the vault) */}
      <div className="mt-3 rounded-xl border border-warn/30 bg-warn/5 p-4">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-warn">Danger zone</div>
        <div className="mb-3 text-xs text-text-secondary">Removes the app and its data. Your vault is never deleted.</div>
        <div className="flex flex-col gap-2">
          <button onClick={() => uninstall("app")}
            className="rounded-md border border-border bg-background px-3 py-2 text-left text-sm text-text-primary hover:border-warn/50">
            <div className="font-medium">Uninstall the app</div>
            <div className="text-xs text-text-secondary">Remove /Applications/Prevail.app. Keeps all config, chats, and secrets.</div>
          </button>
          <button onClick={() => uninstall("data")}
            className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-left text-sm text-warn hover:bg-warn/20">
            <div className="font-medium">Uninstall everything (keep vault)</div>
            <div className="text-xs">Remove the app, all app data, caches, and stored secrets. Your vault folder stays.</div>
          </button>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between gap-3 px-1 text-[11px] text-text-muted">
        <span>MIT licensed · Tauri 2 · React 19 · Tailwind 4</span>
        <span>Local-first · Vault stays on this Mac</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// APPEARANCE SECTION — Color Mode toggle + 6 theme palette cards
// Modeled after the Hermes desktop Appearance pane.
function AppearanceSection({ appearance }: { appearance: ReturnType<typeof useAppearance> }) {
  return (
    <section className="mt-10">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-tight">Appearance</h2>
          <p className="mt-1 max-w-2xl text-sm text-text-secondary">
            Mode controls brightness; theme controls the accent palette and surface styling.
          </p>
        </div>
      </div>

      {/* Color Mode segmented control */}
      <div className="mt-6 rounded-xl border border-border bg-surface p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-medium">Color Mode</div>
            <div className="mt-1 text-sm text-text-secondary">
              Pick a fixed mode or let Prevail follow your system setting.
            </div>
          </div>
          <div className="inline-flex shrink-0 items-center rounded-md border border-border bg-background p-1 text-xs">
            {[
              { id: "light", label: "Light", icon: Sun },
              { id: "dark", label: "Dark", icon: Moon },
              { id: "system", label: "System", icon: Monitor },
            ].map((m) => {
              const Icon = m.icon;
              const active = appearance.mode === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => appearance.setMode(m.id as Mode)}
                  className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 transition-colors ${
                    active
                      ? "bg-accent text-background shadow-sm"
                      : "text-text-secondary hover:bg-surface-warm"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Theme palette cards */}
      <div className="mt-6">
        <div className="mb-1 font-medium">Theme</div>
        <p className="mb-4 text-sm text-text-secondary">
          Desktop palettes. The selected mode is applied on top.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {PALETTES.map((p) => (
            <PaletteCard
              key={p.id}
              palette={p}
              active={appearance.palette === p.id}
              onSelect={() => appearance.setPalette(p.id)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}


// Council config — its own first-class section. You pick the EXACT models on the
// default panel (per-provider, multiple models allowed) and which one chairs.
function CouncilSettingsSection({ clis }: { clis: CliInfo[] }) {
  const available = useMemo(() => clis.filter((c) => c.available && (!isBunkerOn() || isLocalCli(c.id))), [clis]);
  const [members, setMembers] = useState<Set<string>>(() => new Set(readCouncilMembers()));
  const [chair, setChair] = useState<string>(() => readCouncilChair());
  // Each provider expands/collapses INDEPENDENTLY — a Set of open provider ids,
  // not a single value (opening one never closes another).
  const [expandedSet, setExpandedSet] = useState<Set<string>>(() => new Set());
  // Once providers are detected: prune any stale slot keys that no longer map to
  // a real (available provider, model) — that's what made the count drift from
  // the visible badges — then seed a sensible default if the panel is empty.
  useEffect(() => {
    if (available.length === 0) return;
    const valid = new Set<string>();
    for (const c of available) for (const m of councilModelsFor(c.id)) valid.add(councilSlotKey(c.id, m.id));
    setMembers((prev) => {
      const pruned = new Set([...prev].filter((k) => valid.has(k)));
      if (pruned.size > 0) return pruned.size === prev.size ? prev : pruned;
      // Empty after pruning → seed the first model of the first three providers.
      return new Set(available.slice(0, 3).map((c) => councilSlotKey(c.id, councilModelsFor(c.id)[0].id)));
    });
    setExpandedSet((e) => (e.size ? e : new Set([available[0].id])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available]);
  useEffect(() => { lsSet(COUNCIL_MEMBERS_KEY, JSON.stringify([...members])); }, [members]);
  useEffect(() => {
    lsSet(COUNCIL_CHAIR_KEY, chair);
    const cli = chair.split("::")[0];
    if (cli) lsSet(LS.defaultChairCli, cli); // back-compat
  }, [chair]);
  // Chair must be a current member.
  useEffect(() => {
    if (members.size && !members.has(chair)) setChair([...members][0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members]);

  const toggle = (key: string) => setMembers((m) => { const n = new Set(m); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  // Resolve a readable chair label from its slot key.
  const chairLabel = (() => {
    if (!chair) return "-";
    const [cli, model] = chair.split("::");
    const c = clis.find((x) => x.id === cli);
    const m = councilModelsFor(cli).find((x) => x.id === model);
    return `${c?.label ?? cli} · ${m?.label ?? (model || "default")}`;
  })();

  return (
    <>
      <SettingsHeader title="Council" subtitle="Convene several models on one question: each answers independently, then a chair writes the verdict. Pick the exact models on your default panel (you can add several from the same provider)." />
      {/* Compact summary bar — what the panel is right now. */}
      <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-accent-border bg-accent-soft px-4 py-3 text-sm">
        <span className="font-semibold text-text-primary">{members.size} model{members.size === 1 ? "" : "s"} on the panel</span>
        <span className="inline-flex items-center gap-1 text-text-secondary"><Crown className="h-3.5 w-3.5 text-accent" /> chair: <span className="font-medium text-text-primary">{chairLabel}</span></span>
      </div>
      <div className="space-y-2">
        {available.length === 0 && <div className="rounded-lg border border-dashed border-border bg-surface p-4 text-sm text-text-muted">No providers available{isBunkerOn() ? " in Bunker Mode (local only)" : ""}.</div>}
        {available.map((c) => {
          const models = councilModelsFor(c.id);
          const picked = models.filter((m) => members.has(councilSlotKey(c.id, m.id))).length;
          const isExp = expandedSet.has(c.id);
          return (
            <div key={c.id} className={`overflow-hidden rounded-lg border bg-surface transition-colors ${isExp || picked > 0 ? "border-accent-border" : "border-border-subtle"}`}>
              <button onClick={() => setExpandedSet((e) => { const n = new Set(e); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                {isExp ? <ChevronDown className="h-4 w-4 shrink-0 text-text-muted" /> : <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" />}
                <ProviderMark vendor={c.id} size={26} />
                <span className="flex-1 font-display text-sm font-semibold text-text-primary">{c.label}</span>
                {picked > 0 && <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-background">{picked} on panel</span>}
                <span className="shrink-0 font-mono text-[10px] text-text-muted">{models.length} model{models.length === 1 ? "" : "s"}</span>
              </button>
              {isExp && (
                <div className="space-y-1.5 border-t border-border-subtle bg-background/40 p-3">
                  {models.map((m) => {
                    const key = councilSlotKey(c.id, m.id);
                    const on = members.has(key);
                    const isChair = chair === key;
                    return (
                      <div key={key} className={`flex items-center gap-3 rounded-md border px-3 py-2 ${on ? "border-accent-border bg-accent-soft" : "border-border-subtle bg-surface"}`}>
                        <button onClick={() => toggle(key)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                          <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${on ? "border-accent bg-accent text-background" : "border-border bg-background"}`}>
                            {on && <Check className="h-3 w-3" strokeWidth={3} />}
                          </span>
                          <span className="min-w-0">
                            <span className="font-mono text-sm text-text-primary">{m.label}</span>
                            {m.blurb && <span className="ml-2 text-[11px] text-text-muted">{m.blurb}</span>}
                          </span>
                        </button>
                        {on && (
                          <button
                            onClick={() => setChair(key)}
                            title={isChair ? "Chairs the council (writes the verdict)" : "Make this model the chair"}
                            className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider ${
                              isChair ? "bg-accent text-background" : "border border-border text-text-muted hover:border-accent-border hover:text-accent"
                            }`}
                          >
                            <Crown className="h-3 w-3" /> {isChair ? "Chair" : "Chair"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-xs leading-relaxed text-text-muted">
        Convene a council from the <span className="text-accent">Council</span> tab in any domain: it starts with this panel. Each model answers in parallel; the <Crown className="inline h-3 w-3" /> chair synthesizes a consensus + disagreements + recommended action. <span className="text-accent">Defaults</span> sets your single-model chat; this sets the panel.
      </p>
    </>
  );
}



// FrameworkPickerCard was deleted with v0.2.92 — the chip-row UI
// it provided lived only in Settings → Defaults as a duplicate of
// the dedicated Settings → Frameworks page. The full two-column
// FrameworksSection is now the single source of truth.

// ─────────────────────────────────────────────────────────────────────
// Integration cards (Telegram / WhatsApp / MCP / Briefings) are now
// rendered directly inside Settings → Integrations. Old ToolsPanel
// wrapper removed.


function TelegramCard() {
  // Audit #7: the bot token is a secret — it lives in the Keychain, never in
  // localStorage. `token` is a transient input value only; `tokenSaved` reflects
  // whether a token exists in the Keychain. chatId is just an identifier (not a
  // secret), so it stays in localStorage.
  const [token, setToken] = useState("");
  const [tokenSaved, setTokenSaved] = useState(false);
  const [chatId, setChatId] = useState(lsGet(LS.telegramChatId));
  const [bridgeCli, setBridgeCli] = useState(lsGet("prevail.telegram.cli") || "claude");
  const [bridgeModel, setBridgeModel] = useState(lsGet("prevail.telegram.model"));
  // Only route to providers that are detected AND validated (the user asked for
  // the dropdown to list "the ones that have been validated and are actually
  // active"). cliVerifyLive is the app-wide validation map.
  const verify = useCliVerifyLive();
  const [tgClis, setTgClis] = useState<CliInfo[]>([]);
  useEffect(() => { invoke<CliInfo[]>("detect_clis").then(setTgClis).catch(() => {}); }, []);
  const routableClis = tgClis.filter((c) => c.available && verify.get(c.id)?.status !== "failed");
  // Keep the selection valid: if the chosen CLI isn't routable, fall back.
  useEffect(() => {
    if (routableClis.length > 0 && !routableClis.some((c) => c.id === bridgeCli)) {
      setBridgeCli(routableClis[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tgClis, verify]);
  const [status, setStatus] = useState<{ kind: "idle" | "ok" | "err"; msg: string }>({ kind: "idle", msg: "" });
  const [bridge, setBridge] = useState<TgBridgeStatus | null>(null);
  const [feed, setFeed] = useState<Array<{ dir: "in" | "out"; text: string; ts: number }>>([]);

  // On mount: migrate any legacy localStorage token into the Keychain (then wipe
  // it), and reflect whether a token is configured.
  useEffect(() => {
    (async () => {
      try {
        const legacy = lsGet(LS.telegramToken);
        if (legacy && legacy.trim()) {
          await invoke("provider_key_set", { provider: "telegram", key: legacy.trim() });
          lsSet(LS.telegramToken, ""); // wipe the plaintext secret from localStorage
        }
        const ok = await invoke<boolean>("provider_key_exists", { provider: "telegram" });
        setTokenSaved(!!ok);
      } catch { /* keychain unavailable: leave unconfigured */ }
    })();
  }, []);
  useEffect(() => { lsSet(LS.telegramChatId, chatId); }, [chatId]);
  useEffect(() => { lsSet("prevail.telegram.cli", bridgeCli); }, [bridgeCli]);
  useEffect(() => { lsSet("prevail.telegram.model", bridgeModel); }, [bridgeModel]);

  async function refreshStatus() {
    try {
      const s = await invoke<TgBridgeStatus>("telegram_bridge_status");
      setBridge(s);
    } catch { /* ignore */ }
  }
  useEffect(() => {
    void refreshStatus();
    const id = window.setInterval(() => void refreshStatus(), 3000);
    let u1: UnlistenFn | null = null;
    let u2: UnlistenFn | null = null;
    (async () => {
      u1 = await listen<{ text: string }>("tg:message_in", (e) => {
        setFeed((cur) => [...cur.slice(-19), { dir: "in", text: e.payload.text, ts: Date.now() }]);
      });
      u2 = await listen<{ text: string }>("tg:message_out", (e) => {
        setFeed((cur) => [...cur.slice(-19), { dir: "out", text: e.payload.text, ts: Date.now() }]);
      });
    })();
    return () => { window.clearInterval(id); if (u1) u1(); if (u2) u2(); };
  }, []);

  async function startBridge() {
    if (!chatId.trim() || (!token.trim() && !tokenSaved)) {
      setStatus({ kind: "err", msg: "fill in token + chat ID first" });
      return;
    }
    try {
      // If a new token was typed, persist it to the Keychain (and clear the
      // input); otherwise the bridge resolves the saved token server-side.
      if (token.trim()) {
        await invoke("provider_key_set", { provider: "telegram", key: token.trim() });
        setTokenSaved(true);
        setToken("");
      }
      // Routing table: every vault domain plus its stored/derived keywords,
      // so a "wealth" question from Telegram lands in the wealth domain with
      // a recorded thread.
      let routes: { domain: string; keywords: string[] }[] = [];
      let vault: string | null = null;
      try {
        vault = lsGet(LS.vault) || null;
        if (vault) {
          const ds = await invoke<{ name: string }[]>("scan_vault", { path: vault });
          routes = ds.map((d) => ({
            domain: d.name,
            keywords: (lsGet(`prevail.domain.${d.name}.routing.keywords`) || "")
              .split(",").map((s) => s.trim()).filter(Boolean),
          }));
        }
      } catch { /* routing is best-effort; bridge works without it */ }
      await invoke("telegram_bridge_start", {
        cfg: {
          token: "", // bridge reads the secret from the Keychain
          chat_id: chatId.trim(),
          cli: bridgeCli,
          model: bridgeModel || null,
          domain: null,
          vault,
          routes,
        },
      });
      await refreshStatus();
    } catch (e) {
      setStatus({ kind: "err", msg: String(e) });
    }
  }
  async function stopBridge() {
    try {
      await invoke("telegram_bridge_stop");
      await refreshStatus();
    } catch (e) {
      setStatus({ kind: "err", msg: String(e) });
    }
  }

  async function testSend() {
    if (!chatId || (!token.trim() && !tokenSaved)) {
      setStatus({ kind: "err", msg: "fill in token + chat ID first" });
      return;
    }
    // If a fresh token was typed, save it first so Test uses the same secret.
    if (token.trim()) {
      try { await invoke("provider_key_set", { provider: "telegram", key: token.trim() }); setTokenSaved(true); setToken(""); } catch { /* ignore */ }
    }
    setStatus({ kind: "idle", msg: "sending…" });
    try {
      const r = await invoke<{ ok: boolean; description?: string }>("telegram_send", {
        token: "", chatId, text: "◆ Prevail desktop · test message ✓",
      });
      if (r.ok) {
        setStatus({ kind: "ok", msg: "delivered ✓" });
      } else {
        setStatus({ kind: "err", msg: r.description ?? "send failed" });
      }
    } catch (e) {
      setStatus({ kind: "err", msg: String(e) });
    }
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#229ED9]/15">
          <svg width={20} height={20} viewBox="0 0 24 24" fill="#229ED9" aria-hidden><path d={siTelegram.path} /></svg>
        </div>
        <div>
          <h3 className="font-semibold">Telegram bridge</h3>
          <p className="text-xs text-text-muted">
            Two-way chat. Inbound messages from the configured chat are routed to your chosen CLI and the reply pushed back. Test button still works for one-shot pushes.
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <label className="block">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-text-muted">
            Bot token
            {tokenSaved && <span className="rounded-full bg-accent-soft px-1.5 py-0 font-mono text-[9px] tracking-wider text-accent">in keychain</span>}
          </div>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={tokenSaved ? "•••••••• (saved: type to replace)" : "123456:ABC-XYZ…"}
            className="mt-1 w-full rounded border border-border bg-background px-3 py-2 font-mono text-sm"
            spellCheck={false}
          />
        </label>
        <label className="block">
          <div className="text-xs uppercase tracking-wider text-text-muted">Chat ID</div>
          <input
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            placeholder="-1001234567890"
            className="mt-1 w-full rounded border border-border bg-background px-3 py-2 font-mono text-sm"
            spellCheck={false}
          />
        </label>
        <div className="flex items-center justify-between pt-1">
          <button
            onClick={testSend}
            disabled={!chatId || (!token.trim() && !tokenSaved)}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-background hover:bg-accent-hover disabled:bg-surface-strong disabled:text-text-muted"
          >
            <Send className="h-3.5 w-3.5" />
            Send test message
          </button>
          {status.kind === "ok" && (
            <span className="text-xs text-ok"><Check className="mr-1 inline h-3 w-3" />{status.msg}</span>
          )}
          {status.kind === "err" && (
            <span className="text-xs text-warn">{status.msg}</span>
          )}
        </div>

        <div className="rounded-lg border border-border bg-background p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">
              Bidirectional bridge
            </div>
            <span className={`rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
              bridge?.running
                ? "border border-accent-border bg-accent-soft text-accent"
                : "border border-border bg-surface text-text-muted"
            }`}>
              {bridge?.running ? "running" : "stopped"}
            </span>
          </div>
          <p className="mb-3 text-[11px] text-text-muted">
            Messages you send to the bot from Telegram get routed to the CLI below and the reply is pushed back to the same chat.
          </p>
          <div className="grid grid-cols-1 gap-3">
            <label className="block">
              <div className="text-[10px] uppercase tracking-wider text-text-muted">Route to CLI</div>
              <select
                value={bridgeCli}
                onChange={(e) => setBridgeCli(e.target.value)}
                className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm focus:border-accent-border focus:outline-none"
              >
                {routableClis.length === 0 ? (
                  <option value="">No validated provider; set one up in Models</option>
                ) : (
                  routableClis.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}{verify.get(c.id)?.status === "ok" ? " ✓" : ""}
                    </option>
                  ))
                )}
              </select>
            </label>
            <label className="block">
              <div className="text-[10px] uppercase tracking-wider text-text-muted">Model</div>
              <select
                value={bridgeModel}
                onChange={(e) => setBridgeModel(e.target.value)}
                className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm focus:border-accent-border focus:outline-none"
              >
                <option value="">{`Provider default (${modelsFor(bridgeCli)[0]?.label ?? "default"})`}</option>
                {modelsFor(bridgeCli).map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-3 flex items-center gap-2">
            {!bridge?.running ? (
              <button
                onClick={startBridge}
                disabled={!chatId.trim() || (!token.trim() && !tokenSaved)}
                className="rounded-md border border-accent-border bg-accent-soft px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-accent hover:bg-accent hover:text-background disabled:opacity-50"
              >
                start bridge
              </button>
            ) : (
              <button
                onClick={stopBridge}
                className="rounded-md border border-border bg-background px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:border-warn hover:text-warn"
              >
                stop bridge
              </button>
            )}
            {bridge && (
              <span className="font-mono text-[10px] text-text-muted">
                in: {bridge.inbound_count} · out: {bridge.outbound_count}
                {bridge.last_inbound_ts ? ` · last in ${Math.round((Date.now() / 1000 - bridge.last_inbound_ts))}s ago` : ""}
              </span>
            )}
          </div>
          {bridge?.last_error && (
            <div className="mt-2 rounded border border-warn/40 bg-warn/10 px-2 py-1 text-xs text-warn">
              {bridge.last_error}
            </div>
          )}
          {feed.length > 0 && (
            <ul className="mt-3 max-h-40 overflow-y-auto rounded border border-border-subtle bg-surface px-2 py-1.5">
              {feed.map((f, i) => (
                <li key={i} className="font-mono text-[10px] leading-relaxed">
                  <span className={f.dir === "in" ? "text-accent" : "text-text-muted"}>
                    {f.dir === "in" ? "▶" : "◀"}
                  </span>{" "}
                  <span className={f.dir === "in" ? "text-text-primary" : "text-text-secondary"}>
                    {f.text.slice(0, 200)}{f.text.length > 200 ? "…" : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-border-subtle bg-background px-3 py-2">
          <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">Routing keywords</div>
          <p className="mt-1 text-xs text-text-secondary">
            Inbound messages are matched against each domain's keywords to pick where they land.
            Set them per-domain under{" "}
            <span className="font-mono text-accent">Domain → Prefs → Channels &amp; routing</span>{" "}
            (saved to <span className="font-mono">manifest.routing.keywords</span>).
          </p>
        </div>

        <p className="text-xs text-text-muted">
          New to Telegram bots?{" "}
          <a href="https://core.telegram.org/bots/features#botfather" target="_blank" rel="noreferrer" className="text-accent hover:underline">
            Create one via @BotFather
          </a>, then add it to your chat and use{" "}
          <a href="https://api.telegram.org/bot{TOKEN}/getUpdates" target="_blank" rel="noreferrer" className="text-accent hover:underline">
            getUpdates
          </a>{" "}
          to find your chat ID.
        </p>
      </div>
    </div>
  );
}


function McpCard() {
  const [enabled, setEnabled] = useState(lsGet(LS.mcpEnabled) === "1");
  useEffect(() => { lsSet(LS.mcpEnabled, enabled ? "1" : ""); }, [enabled]);
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-ai/15 text-ai">
          <Network className="h-5 w-5" />
        </div>
        <div>
          <h3 className="font-semibold">
            MCP server <span className="ml-2 rounded bg-warn/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-warn">preview</span>
          </h3>
          <p className="text-xs text-text-muted">Expose your vault to Claude Desktop or any MCP client over localhost.</p>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between rounded-lg border border-border bg-background p-3">
        <div>
          <div className="text-sm">MCP server</div>
          <div className="text-xs text-text-muted">
            {enabled ? "Listening on localhost:7842" : "Off"}
          </div>
        </div>
        <Toggle on={enabled} onChange={setEnabled} label="Enable MCP server" />
      </div>
      <p className="mt-3 text-xs text-text-muted">
        For full MCP coverage right now, run the <Brand /> CLI's <code className="text-accent">mcp-server</code> command: it ships read-only by default and is parent-process verified.
      </p>
    </div>
  );
}

// BriefingsCard removed — landing back in v0.3 when wired up.

















