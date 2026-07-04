// The primary single-model Chat panel, extracted from App.tsx: composer, message
// stream, per-domain context, agent picker, and the domain sub-views. Renders the
// shared chatviews + domainpanels.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Activity, ArrowUpRight, BookOpen, Boxes, Briefcase, Check, ClipboardList, Compass, FileText, Folder, Ghost, Home, Image as ImageIcon, Layers, Lightbulb, ListChecks, Loader2, MessageSquare, PanelRightOpen, Paperclip, Pencil, Plug, Plus, RefreshCw, Repeat, Scale, Settings as SettingsIcon, ShieldAlert, Sparkles, Target, TrendingUp, X } from "lucide-react";
import { PrevailLogo } from "./PrevailLogo";
import { invoke, listen } from "./bridge";
import { addNote } from "./notesstore";
import { toast } from "./toast";
import { readLoops, writeLoops, newLoopId, type Loop } from "./loops";
import { MODELS, isHarnessRuntime } from "./constants";
import { relTime, scoreColor, titleCase } from "./format";
import { startProcess, endProcess } from "./processes";
import { ContextMeter, contextWindowFor, estimateTokens } from "./contextmeter";
import { domainBlurb, inheritedGoogleAccount, isLocalCli, looksLikeJudgmentCall, preferredLocalCli, stripAnsi } from "./helpers";
import { buildChatContext, buildIdealStatePreamble, buildOmegaPreamble, buildQuickActions, buildSkillsPreamble, curatedFor, loadPreferredSkills, maybeRedact, maybeStripSycophancy, modelsFor, savePreferredSkills } from "./helpers2";
import { LS, PREF, getDomainToggle, getPref, incognitoActive, isBunkerOn, lsGet, lsSet, setPref } from "./storage";
import { Markdown } from "./Markdown";
import { ContextScoreBadge, NewSkillForm, ScoreBar, SkillsList } from "./panels";
import { InsightsPanel, UsageDashboard } from "./panels2";
import { ContextScorePanel, DomainAppsTab, AppRowLogo } from "./panels3";
import { domainIcon } from "./icons";
import { useFrameworkLens } from "./hooks";
import { ProviderMark } from "./marks";
import { DomainHome, DomainStatusBar, MessageList } from "./chatviews";
import { LoopsPanel } from "./loopspanel";
import { BoardPanel } from "./boardpanel";
import { AgentPickerRail, ContextCanvas, DomainContextDrawer, DomainPrefsPanel } from "./domainpanels";
import { HomeBriefing } from "./recommendationspanel";
import type { BrandLogo, ChatEvent, ChatMessage, CliInfo, ContextScore, Domain, DomainContextBundle, DomainTab, EngineApp, LifeReadiness, SkillEntry, ThreadMeta, ThreadTurn } from "./types";
import type { UnlistenFn } from "./bridge";
import { savePastedImages } from "./paste";

// Per-domain cache of the cheap (no-audit) context score. engine_score spawns the
// engine binary; users switch domains often, so re-opening a domain within the TTL
// should be instant (no spawn). Rescans (audit) refresh it.
const _scoreCache = new Map<string, { at: number; score: ContextScore }>();
const SCORE_CACHE_TTL_MS = 30_000;

// ── Welcome dashboard subcomponents ───────────────────────────────────
// A clickable stat tile - a single metric that routes to its own tab. Kept
// local to the Welcome dashboard so its styling stays consistent.
function StatTile({ icon: Icon, label, value, hint, onClick }: {
  icon: typeof Home; label: string; value: React.ReactNode; hint?: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group flex flex-col items-start gap-1 rounded-xl border border-border-subtle bg-surface/50 p-4 text-left transition-colors hover:border-accent-border hover:bg-surface-warm/50"
    >
      <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-text-muted">
        <Icon className="h-3.5 w-3.5 text-accent" /> {label}
      </span>
      <span className="text-2xl font-bold leading-none text-text-primary">{value}</span>
      {hint && <span className="text-[11px] text-text-muted">{hint}</span>}
      <span className="mt-1 inline-flex items-center gap-0.5 text-[10px] font-medium text-text-muted opacity-0 transition-opacity group-hover:opacity-100">
        Open <ArrowUpRight className="h-3 w-3" />
      </span>
    </button>
  );
}

// The score-breakdown dimension row: a labelled mini ScoreBar. Reused for each
// of coverage/density/freshness/structure/activity so the score becomes legible.
function ScoreDimRow({ label, dim }: { label: string; dim: { score: number; detail: string } | undefined }) {
  const val = dim?.score ?? 0;
  const color = scoreColor(val);
  return (
    <div title={dim?.detail || ""}>
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="text-text-secondary">{label}</span>
        <span className="font-mono font-semibold" style={{ color }}>{Math.round(val)}</span>
      </div>
      <ScoreBar value={val} max={100} color={color} />
    </div>
  );
}

export function ChatPanel({
  domain,
  domainPath,
  threadDomain,
  isApp,
  appId,
  appAccount,
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
  domainTab,
  setDomainTab,
  active = true,
}: {
  domain: string | null;
  domainPath: string | null;
  // Where threads are stored/listed. Defaults to `domain`. An open app passes
  // its own `_app-<id>` scope so conversations live in the app's space,
  // independent of the (possibly many) domains it's bound to - while `domain`
  // above still drives model grounding.
  threadDomain?: string | null;
  // True when an app (not a domain) is open. Suppresses domain-only chrome:
  // the domain hero header and DomainHome's "apps refreshing this domain"
  // strip. The app is isolated; it feeds domains, it isn't one.
  isApp?: boolean;
  // The connected app's id when an app is open (isApp). Lets the chat pull the
  // app's own SKILL.md and auto-attach it as context so the model knows how to
  // use that app. Null for a plain domain conversation.
  appId?: string | null;
  // The open app's account BINDING (manifest.account.label) - which identity of
  // a multi-account connector this app instance IS. Carried into the turn so an
  // app chat authenticates as its bound identity without a chip pick.
  appAccount?: string | null;
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
  // Whether this is the ACTIVE surface (chat tab, not council). Only the active
  // surface claims the global drag-attach hook so a dropped app/domain lands
  // here and not in the hidden-but-mounted council panel (and vice versa).
  active?: boolean;
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
  // This is purely additive - neither path is removed.
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
  // Per-CLI model selection - persisted to localStorage as
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
    // Domain override when set, else fall back to the global default - so both
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
  // Per-provider search over the full catalog (OpenRouter is 300+); empty shows
  // the curated defaults so the menu isn't a wall.
  const [modelSearch, setModelSearch] = useState<Record<string, string>>({});
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
  // Seed the composer from elsewhere (e.g. the task detail panel's "Discuss with
  // AI"): prefill the prompt + jump to the chat tab so the user can just hit send.
  useEffect(() => {
    const onSeed = (e: Event) => {
      const text = (e as CustomEvent<string>).detail;
      if (typeof text === "string" && text) {
        setInput(text); setDomainTab("chat");
        // Handled live, so drop any pending copy meant for the mount fallback,
        // otherwise the same seed re-applies on a later chat mount.
        try { localStorage.removeItem("prevail.compose.pending"); } catch { /* ignore */ }
      }
    };
    window.addEventListener("prevail:compose-seed", onSeed as EventListener);
    // Pending seed from a view that wasn't mounted when it fired (e.g. Spark in
    // Settings): pick it up on mount so "Explore in chat" reliably lands here.
    try {
      const pending = localStorage.getItem("prevail.compose.pending");
      if (pending) { localStorage.removeItem("prevail.compose.pending"); setInput(pending); setDomainTab("chat"); }
    } catch { /* ignore */ }
    return () => window.removeEventListener("prevail:compose-seed", onSeed as EventListener);
  }, []);
  // Learned router (v1): when the user overrides Auto's pick via a routing chip,
  // persist the signal to the LOCAL vault store so Auto personalizes this bucket
  // (domain + difficulty band) over time. This surface has the domain + vault the
  // chip lacks. Best-effort: a failed log must never break the chat.
  useEffect(() => {
    const onOverride = (e: Event) => {
      const d = (e as CustomEvent).detail as { band?: string; fromModel?: string; toModel?: string } | undefined;
      if (!d || !d.toModel || !vaultPath) return;
      // Match the engine's normalization: an empty domain is the General bucket.
      const engineDomain = domain || "general";
      invoke("route_learn_record", {
        vault: vaultPath,
        domain: engineDomain,
        band: d.band ?? "moderate",
        fromModel: d.fromModel ?? "",
        toModel: d.toModel,
      }).catch(() => { /* best-effort: learning never breaks chat */ });
    };
    window.addEventListener("prevail:route-override", onOverride as EventListener);
    return () => window.removeEventListener("prevail:route-override", onOverride as EventListener);
  }, [domain, vaultPath]);
  // Incognito now toggles from the Modes menu; keep this panel's state + glow in sync.
  useEffect(() => {
    const sync = () => setIncognito(incognitoActive("chat"));
    window.addEventListener("prevail:incognito-changed", sync);
    return () => window.removeEventListener("prevail:incognito-changed", sync);
  }, []);
  // The user's Ideal State (vault/ideal-state.md) - their constitution, always
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
  // Omega (vault/omega.md) - the app-wide LEARNED layer, injected just below the
  // Ideal State. Empty until the user has distilled/authored one (no boilerplate).
  const [omegaMd, setOmegaMd] = useState<string>("");
  useEffect(() => {
    if (!vaultPath) return;
    const load = () => invoke<string>("read_omega", { vault: vaultPath }).then(setOmegaMd).catch(() => setOmegaMd(""));
    void load();
    window.addEventListener("prevail:omega-changed", load);
    return () => window.removeEventListener("prevail:omega-changed", load);
  }, [vaultPath]);
  // The user's profile / identity (vault/user.md, falling back to profile.md) -
  // who they are. Auto-injected into every turn so the model always has the
  // person's real context without a manual $attach. (Founder feedback: profile +
  // ideal state should come automatically.)
  const [userMd, setUserMd] = useState<string>("");
  useEffect(() => {
    if (!vaultPath) { setUserMd(""); return; }
    invoke<string>("read_user_md", { vault: vaultPath }).then(setUserMd).catch(() => setUserMd(""));
  }, [vaultPath]);
  // Distilled long-term memory for this domain - prepended to prompts like
  // user.md so the assistant remembers across sessions (self-learning loop).
  const [memoryMd, setMemoryMd] = useState<string>("");
  useEffect(() => {
    if (!vaultPath) { setMemoryMd(""); return; }
    invoke<string>("read_memory_md", { vault: vaultPath, domain: domain ?? null })
      .then(setMemoryMd)
      .catch(() => setMemoryMd(""));
  }, [vaultPath, domain, chatViewNonce]);
  // Domain context column - a persistent right column showing state.md,
  // decisions, journal, recent logs, skills. Collapsible; state persisted.
  // Items can be "used in chat" to inject as prompt context.
  const [contextOpen, setContextOpen] = useState<boolean>(() => lsGet("prevail.contextOpen") === "1");
  useEffect(() => { lsSet("prevail.contextOpen", contextOpen ? "1" : "0"); }, [contextOpen]);
  const [primedContext, setPrimedContext] = useState<{ label: string; body: string }[]>([]);
  // Identity bindings of ATTACHED apps, keyed by their primedContext label
  // ("app: Gmail Personal" -> { id, account }). An app instance bound to an
  // account (manifest.account) carries that identity into the turn - the
  // generic "an app = a connector + an identity" contract. Entries whose label
  // is no longer in primedContext are simply ignored at send time, so removing
  // the chip detaches the identity too.
  const attachedBindingsRef = useRef<Record<string, { id: string; account: string }>>({});
  // B2: surface attach failures on-screen instead of swallowing them, so a
  // silent "$domain didn't attach" becomes a visible, diagnosable message.
  const [attachErr, setAttachErr] = useState<string | null>(null);
  // G3: incognito for chat - a plain model with NO user context injected.
  // Effective state = global master OR the chat-specific flag; the toggle flips
  // the chat flag. When the global master is on, chat stays incognito and the
  // per-surface toggle is locked on.
  // Incognito is toggled from the Modes menu now; this panel reflects it (glow +
  // ghost badge) and the send path reads incognitoActive("chat") fresh each turn.
  const [incognito, setIncognito] = useState(() => incognitoActive("chat"));
  const globalIncognito = getPref(PREF.incognito, "0") === "1";
  function injectContext(body: string, label: string) {
    setAttachErr(null);
    setPrimedContext((cur) => {
      if (cur.some((c) => c.label === label)) return cur;
      return [...cur, { label, body }];
    });
  }
  // The icon for an attached-context chip, matched to what it actually is - a
  // domain (its domain icon), an app (its brand logo), or a skill (sparkles).
  // primedContext stores only a label, so we read its prefix - the same prefixes
  // the attach paths write: "auto:" / "extra:" -> domain, "app:" / "auto-app:" ->
  // app, "app-skill:" -> skill. Anything else falls back to a generic book.
  function ctxChipIcon(label: string) {
    if (label.startsWith("app-skill:")) return <Sparkles className="h-3 w-3" />;
    const appTitle = label.startsWith("auto-app:") ? label.slice("auto-app:".length).replace(/\s+skill\s*$/i, "").trim()
      : label.startsWith("app:") ? label.slice("app:".length).trim()
      : null;
    if (appTitle) return <AppRowLogo app={{ title: appTitle }} logos={logos} size={14} fallback="letter" />;
    const dom = label.match(/^(?:auto|extra(?:\s*\([^)]*\))?):\s*([^/]+)/);
    if (dom) { const I = domainIcon(dom[1].trim().toLowerCase()); return I ? <I className="h-3 w-3" /> : <Layers className="h-3 w-3" />; }
    return <BookOpen className="h-3 w-3" />;
  }
  // Per-domain preferences popover - explicit view of overrides saved
  // for this domain with reset controls. Implicit auto-save still
  // happens in pickers; this only surfaces + clears the result.
  // Skills attached to the next send. Decoupled from the textarea so
  // editing the prompt text doesn't affect them, and the user removes
  // them from the pills below - not by editing prompt text.
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
  // S1: only reset the domain tab to "chat" when the domain GENUINELY changes
  // (a real domain switch), not on mount. Resetting on mount clobbered the
  // Insights button when arriving from another tab - App set domainTab="insights",
  // then ChatPanel mounted and immediately reset it to "chat", so the first click
  // appeared to do nothing and a second was needed.
  const prevDomainRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (prevDomainRef.current !== undefined && prevDomainRef.current !== domain) {
      setDomainTab("chat");
    }
    prevDomainRef.current = domain;
    const pref = loadPreferredSkills(domain);
    setPreferredSkills(pref);
    setAttachedSkills(pref);
    // General (empty domain) reads the vault root, where its context lives, so it
    // gets the same Context view as a regular domain.
    if (!vaultPath) { setDomainCtx(null); return; }
    let mounted = true;
    invoke<DomainContextBundle>("domain_context", { vault: vaultPath, domain })
      .then((c) => { if (mounted) setDomainCtx(c); })
      .catch(() => { if (mounted) setDomainCtx(null); });
    return () => { mounted = false; };
  }, [domain, vaultPath]);
  // Re-pull the domain bundle (e.g. after creating a skill) without a remount.
  const refreshDomainCtx = useCallback(() => {
    if (!vaultPath) return;
    invoke<DomainContextBundle>("domain_context", { vault: vaultPath, domain })
      .then(setDomainCtx)
      .catch(() => {});
  }, [domain, vaultPath]);
  // Domain "Soul": this domain's own Ideal State (its target), layered under the
  // global ideal state. Surfaced as a dedicated Soul tab in the domain detail
  // shell, reusing the same read_domain_ideal / write_domain_ideal contract that
  // DomainPrefsPanel uses so edits stay consistent everywhere.
  const [domainSoul, setDomainSoul] = useState<string>("");
  const [soulDraft, setSoulDraft] = useState<string>("");
  const [editSoul, setEditSoul] = useState(false);
  const [soulSaving, setSoulSaving] = useState(false);
  useEffect(() => {
    if (!vaultPath) { setDomainSoul(""); return; }
    let mounted = true;
    invoke<string>("read_domain_ideal", { vault: vaultPath, domain: domain || "general" })
      .then((s) => { if (mounted) setDomainSoul(s || ""); })
      .catch(() => { if (mounted) setDomainSoul(""); });
    setEditSoul(false);
    return () => { mounted = false; };
  }, [domain, vaultPath]);
  const saveDomainSoul = useCallback(async () => {
    setSoulSaving(true);
    try {
      await invoke("write_domain_ideal", { vault: vaultPath, domain: domain || "general", body: soulDraft });
      setDomainSoul(soulDraft);
      setEditSoul(false);
    } catch (e) { console.error("write domain soul", e); }
    finally { setSoulSaving(false); }
  }, [vaultPath, domain, soulDraft]);
  // IDEAL-AI: draft this domain's ideal state from its real context, for review.
  // Reuses the same domain_draft_ideal command + provider/model defaults as the
  // Preferences panel; the draft opens the editor so the user reviews and Saves
  // (which persists via write_domain_ideal, identical to a hand-written note).
  const [soulDrafting, setSoulDrafting] = useState(false);
  const [soulDraftErr, setSoulDraftErr] = useState<string | null>(null);
  const draftDomainSoul = useCallback(async () => {
    setSoulDrafting(true);
    setSoulDraftErr(null);
    try {
      const provider = getPref(PREF.memoryProvider, "claude");
      // Don't hand a claude model id to a non-claude CLI (see distillNow).
      const storedModel = getPref(PREF.distillModel, "");
      const model = provider === "claude"
        ? (storedModel || "claude-haiku-4-5")
        : (storedModel && !storedModel.startsWith("claude") ? storedModel : "");
      const text = await invoke<string>("domain_draft_ideal", { vault: vaultPath, domain: domain || "general", provider, model });
      if (text?.trim()) { setSoulDraft(text.trim()); setEditSoul(true); }
      else setSoulDraftErr("The draft came back empty. Try again or write your own.");
    } catch (e) { setSoulDraftErr(String(e)); }
    finally { setSoulDrafting(false); }
  }, [vaultPath, domain]);
  // Loops preview for the Welcome dashboard - active standing loops for this
  // domain. Read cheaply from _loops.json; refreshed on domain switch.
  type LoopPreview = { id: string; name: string; purpose: string; active: boolean };
  const [domainLoops, setDomainLoops] = useState<LoopPreview[] | null>(null);
  useEffect(() => {
    if (!domainPath) { setDomainLoops(null); return; }
    let mounted = true;
    readLoops(domainPath)
      .then((doc) => { if (mounted) setDomainLoops(doc.loops.map((l) => ({ id: l.id, name: l.name, purpose: l.purpose, active: l.status === "active" && l.enabled }))); })
      .catch(() => { if (mounted) setDomainLoops([]); });
    return () => { mounted = false; };
  }, [domainPath, domain]);
  // I7: "Save as skill" - the composer dispatches this with the typed prompt;
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
    // Instant from cache when a recent score exists - no engine spawn.
    const key = `${vaultPath}:${domain}`;
    const cached = _scoreCache.get(key);
    if (cached && Date.now() - cached.at < SCORE_CACHE_TTL_MS) {
      setCtxScore(cached.score);
      return;
    }
    let mounted = true;
    setCtxScoreLoading(true);
    invoke<ContextScore>("engine_score", { vault: vaultPath, domain, audit: false })
      .then((s) => { if (mounted) setCtxScore(s); _scoreCache.set(key, { at: Date.now(), score: s }); })
      .catch((e) => { if (mounted) setCtxScoreError(String(e)); })
      .finally(() => { if (mounted) setCtxScoreLoading(false); });
    return () => { mounted = false; };
  }, [domain, vaultPath]);
  const rescanContextScore = useCallback(() => {
    if (!domain || !vaultPath) return;
    // Idempotent: never launch a second audit while one is in flight (the audit
    // just recomputes + rewrites the score, so re-running is otherwise harmless).
    if (ctxScoreRescanning) return;
    setCtxScoreRescanning(true);
    setCtxScoreError(null);
    // Register a background process so the audit is visible from any screen and
    // the user can navigate away and come back while it runs. The Tauri command
    // is async (runs the engine off the main thread), so the UI never freezes.
    const proc = `score-audit-${domain}-${Date.now()}`;
    startProcess(proc, "audit", `Auditing ${titleCase(domain)} context`, domain);
    invoke<ContextScore>("engine_score_audit", { vault: vaultPath, domain })
      // Update the module-level cache even if this panel has since unmounted, so
      // returning to the domain shows the fresh score.
      .then((s) => { setCtxScore(s); _scoreCache.set(`${vaultPath}:${domain}`, { at: Date.now(), score: s }); })
      .catch((e) => setCtxScoreError(String(e)))
      .finally(() => { setCtxScoreRescanning(false); endProcess(proc); });
  }, [domain, vaultPath, ctxScoreRescanning]);
  // Aggregate "Life Readiness" - averaged across all domains. Loaded on
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
    // Per-domain opt-out - when prevail.domain.<name>.autoState === "0"
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
  // App SKILL auto-attach: when an APP is open, pull its own SKILL.md
  // (<vault>/data/apps/<id>/SKILL.md) and prime it as context so the model knows
  // how to use that app - its tools, the gateway it's fronted by, what data it
  // holds. Per-app preference (prevail.app.<id>.autoSkill, default on); the pill
  // is removable for a single turn and the toggle below controls the default.
  // Labelled "auto-app:" so the domain-state auto-prime above leaves it intact
  // ("auto-app:" does not start with "auto:").
  const [appAutoSkill, setAppAutoSkill] = useState<boolean>(() => (appId ? lsGet(`prevail.app.${appId}.autoSkill`) !== "0" : true));
  const [appHasSkill, setAppHasSkill] = useState(false);
  useEffect(() => { setAppAutoSkill(appId ? lsGet(`prevail.app.${appId}.autoSkill`) !== "0" : true); }, [appId]);
  useEffect(() => {
    if (!isApp || !appId || !vaultPath) {
      setAppHasSkill(false);
      setPrimedContext((cur) => cur.filter((x) => !x.label.startsWith("auto-app:")));
      return;
    }
    let mounted = true;
    invoke<string>("read_skill", { path: `${vaultPath}/data/apps/${appId}` })
      .then((body) => {
        if (!mounted) return;
        const has = !!body.trim();
        setAppHasSkill(has);
        setPrimedContext((cur) => {
          const cleared = cur.filter((x) => !x.label.startsWith("auto-app:"));
          return has && appAutoSkill ? [...cleared, { label: `auto-app: ${titleCase(appId)} skill`, body }] : cleared;
        });
      })
      .catch(() => {
        if (!mounted) return;
        setAppHasSkill(false);
        setPrimedContext((cur) => cur.filter((x) => !x.label.startsWith("auto-app:")));
      });
    return () => { mounted = false; };
  }, [isApp, appId, vaultPath, appAutoSkill]);
  const toggleAppAutoSkill = useCallback(() => {
    if (!appId) return;
    setAppAutoSkill((cur) => { const next = !cur; lsSet(`prevail.app.${appId}.autoSkill`, next ? "1" : "0"); return next; });
  }, [appId]);
  // The app's SECONDARY skills (files under data/apps/<id>/skills/) - the
  // primary SKILL.md is auto-attached above; these are the per-action how-tos
  // the user can attach as extra context. Fetched once per app, then offered as
  // suggestion chips in the composer's attach row.
  const [appSkillFiles, setAppSkillFiles] = useState<{ id: string; name: string; path: string; summary: string; body: string; primary: boolean }[]>([]);
  useEffect(() => {
    if (!isApp || !appId) { setAppSkillFiles([]); return; }
    let mounted = true;
    invoke<{ id: string; name: string; path: string; summary: string; body: string; primary: boolean }[]>("engine_app_skill_files", { id: appId })
      .then((r) => { if (mounted) setAppSkillFiles(Array.isArray(r) ? r : []); })
      .catch(() => { if (mounted) setAppSkillFiles([]); });
    return () => { mounted = false; };
  }, [isApp, appId]);
  // The Google account selector lives in ONE place: the multi-select account chip
  // in the composer (see chatviews.tsx, persisted at prevail.domain.<d>.googleAccounts
  // and threaded to the connector at send time). The older single-select dropdown
  // + "auto-google-account:" context note were a redundant second selector and
  // have been removed.
  // Attach / detach one secondary skill as removable context. Labelled
  // "app-skill: <name>" (distinct from the auto-attached "auto-app:" primary and
  // from the "auto:" domain-state prime), so each layer is independent.
  const toggleSkillAttach = useCallback((s: { name: string; body: string }) => {
    const label = `app-skill: ${s.name}`;
    setPrimedContext((cur) => cur.some((c) => c.label === label)
      ? cur.filter((c) => c.label !== label)
      : [...cur, { label, body: s.body }]);
  }, []);
  const [attachments, setAttachments] = useState<string[]>([]);
  // X7 (plan mode): when on, the model must lay out an editable plan and wait for
  // approval before acting or giving a final answer. Predictability for anything
  // consequential; off by default.
  const [planMode, setPlanMode] = useState(false);
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
  // Local recall history - arrow-up cycles backward, arrow-down forward.
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
  // Apps cache powers the `$` context-mention popover (alongside domains).
  const [appsCache, setAppsCache] = useState<EngineApp[]>([]);
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
  // menu and the suggested-skills row (both domain-scoped) have a cache.
  useEffect(() => {
    if (!domain || !vaultPath) {
      setSkillsCache([]);
      return;
    }
    invoke<SkillEntry[]>("scan_skills", { vault: vaultPath })
      .then((s) => setSkillsCache(s.filter((sk) => sk.domain === domain)))
      .catch(() => setSkillsCache([]));
  }, [domain, vaultPath]);
  // ALL skills across the vault - powers the `/` slash autocomplete, which must
  // offer skills even on the home screen / a general chat where no domain is
  // selected (the domain-scoped `skillsCache` above is empty there).
  const [allSkills, setAllSkills] = useState<SkillEntry[]>([]);
  useEffect(() => {
    if (!vaultPath) { setAllSkills([]); return; }
    // Only ENABLED skills feed /skills + auto-attach; disabled ones are hidden.
    invoke<SkillEntry[]>("scan_skills", { vault: vaultPath }).then((s) => setAllSkills(s.filter((x) => x.enabled !== false))).catch(() => setAllSkills([]));
  }, [vaultPath]);
  // Brand logos for app rows/chips in the `$` mention popover - same source the
  // Apps panel uses. Without this the chat composer can only show monograms.
  const [logos, setLogos] = useState<Record<string, BrandLogo>>({});
  useEffect(() => { invoke<Record<string, BrandLogo>>("ingestion_connector_logos").then(setLogos).catch(() => {}); }, []);
  // Pre-fetch apps so the `$` mention can offer them as context alongside
  // domains. Refreshed when the vault changes or apps are added/removed.
  useEffect(() => {
    if (!vaultPath) { setAppsCache([]); return; }
    const load = () => invoke<EngineApp[]>("engine_apps_list").then(setAppsCache).catch(() => setAppsCache([]));
    void load();
    window.addEventListener("prevail:apps-changed", load);
    return () => window.removeEventListener("prevail:apps-changed", load);
  }, [vaultPath]);
  // Slash autocomplete - detect `/<word>` at the caret position and
  // expose the filtered skills + a completer for the textarea below.
  const taRef = useRef<HTMLTextAreaElement>(null);
  // Auto-grow the composer with its content, like Claude/ChatGPT: measure the
  // rendered content height and expand up to a comfortable cap (~10 lines),
  // after which the textarea scrolls internally. Height resets naturally when
  // the input clears (send / escape) because the effect re-measures on every
  // value change. Cap is fixed px (not vh) so the composer never eats the
  // conversation on short windows.
  const TA_MAX_PX = 240;
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto"; // shrink-to-fit first so deletions collapse
    const next = Math.min(ta.scrollHeight, TA_MAX_PX);
    ta.style.height = `${next}px`;
    ta.style.overflowY = ta.scrollHeight > TA_MAX_PX ? "auto" : "hidden";
  }, [input]);
  // B2 (Monday feedback): the `/` and `$` popovers must read the caret to know
  // what the user is typing. Reading `taRef.current.selectionStart` inside a
  // useMemo is a render-phase DOM read - for append-at-end typing the browser
  // has already moved the caret, but mid-string edits (or a stale ref) can read
  // the WRONG position, so the popover silently fails to match and Enter "does
  // nothing." Track the caret in state instead, updated from the very events
  // that move it, so the matchers always see a correct, committed position.
  const [caretPos, setCaretPos] = useState<number>(0);
  const syncCaret = useCallback((el: HTMLTextAreaElement | null) => {
    if (el) setCaretPos(el.selectionStart ?? el.value.length);
  }, []);
  const slashMatch = useMemo(() => {
    const caret = Math.min(caretPos, input.length);
    const before = input.slice(0, caret);
    // Match the trailing /<word> right at the caret.
    const m = before.match(/(^|\s)\/([a-zA-Z0-9_-]*)$/);
    if (!m) return null;
    const start = caret - m[2].length - 1; // index of the `/`
    return { token: m[2], start, end: caret };
  }, [input, caretPos]);
  const slashCandidates = useMemo(() => {
    if (!slashMatch) return [];
    const q = slashMatch.token.toLowerCase();
    const matched = allSkills.filter((s) => s.name.toLowerCase().includes(q));
    // Current-domain skills first (most relevant), then the rest of the vault.
    const rank = (s: SkillEntry) => (domain && s.domain === domain ? 0 : 1);
    return [...matched].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).slice(0, 8);
  }, [slashMatch, allSkills, domain]);
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
    setCaretPos(head.length); // collapse the match so the popover closes
    insertSkillSlash(name);
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(head.length, head.length);
    });
  }
  // `$<word>` context mention - the mirror of `/` for skills. Detect a
  // trailing `$word` at the caret and offer matching domains + apps; picking
  // one attaches its context (state.md for a domain, identity card for an app)
  // as a chip, exactly like dragging it in, then strips the `$token`.
  type DollarItem = { kind: "domain" | "app"; id: string; label: string; sub?: string };
  const dollarMatch = useMemo(() => {
    const caret = Math.min(caretPos, input.length);
    const before = input.slice(0, caret);
    const m = before.match(/(^|\s)\$([a-zA-Z0-9_-]*)$/);
    if (!m) return null;
    const start = caret - m[2].length - 1; // index of the `$`
    return { token: m[2], start, end: caret };
  }, [input, caretPos]);
  const dollarCandidates = useMemo<DollarItem[]>(() => {
    if (!dollarMatch) return [];
    const q = dollarMatch.token.toLowerCase();
    const doms: DollarItem[] = domains
      .map((d) => ({ kind: "domain" as const, id: d.name, label: titleCase(d.name) }))
      .filter((d) => d.id.toLowerCase().includes(q) || d.label.toLowerCase().includes(q));
    const apps: DollarItem[] = appsCache
      .map((a) => ({ kind: "app" as const, id: a.id, label: a.title, sub: a.integration }))
      .filter((a) => a.id.toLowerCase().includes(q) || a.label.toLowerCase().includes(q));
    // Apps FIRST so they're never starved out by the long domain list (there are
    // many domains; a 6-item cap that listed domains first hid every app).
    return [...apps, ...doms].slice(0, 8);
  }, [dollarMatch, domains, appsCache]);
  const [dollarIdx, setDollarIdx] = useState(0);
  useEffect(() => { setDollarIdx(0); }, [dollarMatch?.token]);
  function applyDollarCompletion(item: DollarItem | undefined) {
    if (!dollarMatch || !item) return;
    const head = input.slice(0, dollarMatch.start).replace(/\s$/, "");
    const tail = input.slice(dollarMatch.end);
    const next = `${head}${head && tail && !tail.startsWith(" ") ? " " : ""}${tail}`;
    setInput(next);
    setCaretPos(head.length); // collapse the match so the popover closes
    if (item.kind === "domain") void attachDomainAsContext(item.id, "light");
    else void attachAppAsContext(item.id);
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
  // P2: register a "chat" process while a reply is streaming so the sidebar shows
  // it as a live process even while the user navigates away.
  const streamingNow = messages.some((mm) => mm.streaming);
  useEffect(() => {
    const id = `chat:${domain ?? "general"}`;
    if (streamingNow) startProcess(id, "chat", `Chat · ${domain ? titleCase(domain) : "General"}`, domain);
    else endProcess(id);
    return () => endProcess(id);
  }, [streamingNow, domain]);
  // Compaction: summarize the running conversation into a dense brief, then start
  // a fresh chat seeded with that summary - continuity preserved, tokens reclaimed.
  // The summary is stashed in localStorage so it survives the new-chat remount.
  const COMPACT_KEY = `prevail.compact.${domain ?? "_root"}`;
  const [compacting, setCompacting] = useState(false);
  const compactConversation = useCallback(async () => {
    if (messages.length === 0) return;
    setCompacting(true);
    try {
      const text = messages
        .map((mm) => `${mm.role === "user" ? "User" : "Assistant"}: ${mm.content}`)
        .join("\n\n")
        .slice(-40000);
      const activeModel = selectedCli ? (modelByCli[selectedCli] ?? null) : null;
      const summary = await invoke<string>("summarize_conversation", { cli: selectedCli ?? "claude", model: activeModel, text });
      if (summary && summary.trim()) {
        lsSet(COMPACT_KEY, summary.trim());
        window.dispatchEvent(new Event("prevail:new-chat"));
      }
    } catch (e) {
      console.error("compact conversation", e);
    } finally {
      setCompacting(false);
    }
  }, [messages, selectedCli, modelByCli, COMPACT_KEY]);
  // After a compaction's new-chat reset, seed the summary as attached context so
  // the fresh conversation keeps the gist. Runs on the remount (chatViewNonce).
  useEffect(() => {
    const pending = lsGet(COMPACT_KEY);
    if (pending && pending.trim()) {
      setPrimedContext((cur) => [{ label: "Summary so far", body: pending }, ...cur.filter((c) => c.label !== "Summary so far")]);
      lsSet(COMPACT_KEY, "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatViewNonce, COMPACT_KEY]);
  // Token accounting for the context meter + auto-compaction (shared so both use
  // the same numbers).
  // Is the Google app in this chat's context? The account chip only appears once
  // Google is actually attached (its context labels start with "app: Google" /
  // "auto-app: Google"), keeping the composer clean otherwise. Also true when the
  // open app itself IS Google.
  const googleInContext = useMemo(() => {
    if ((appId ?? "").toLowerCase().includes("google")) return true;
    return primedContext.some((c) => /(^|\b)(auto-)?app:\s*google/i.test(c.label));
  }, [primedContext, appId]);
  // The Google identity RESOLVED BY BINDING: the open app's own account binding
  // (app chat) or the binding of an attached Google app (domain chat). A bound
  // app instance IS one identity, so no per-chat pick is needed; an explicit
  // chip pick still overrides at send. Recomputed when attachments change.
  const boundGoogleAccount = useMemo(() => {
    if (isApp) return appAccount ?? null;
    return primedContext
      .map((c) => attachedBindingsRef.current[c.label])
      .find((b) => b && /google|gmail/i.test(b.id))?.account ?? null;
  }, [isApp, appAccount, primedContext]);
  // The connected Google accounts on this machine, loaded once the Google app is
  // in this chat's context. Used at send() to INHERIT the app's authenticated
  // account when the user hasn't explicitly picked one in Modes, so a domain chat
  // authenticates as the app's own chat would (see inheritedGoogleAccount). We
  // cache it here (loaded only when Google is attached) so the profile probe
  // never runs on the hot send path for a non-Google chat.
  const [googleConnectedAccounts, setGoogleConnectedAccounts] = useState<string[]>([]);
  useEffect(() => {
    if (!googleInContext) { setGoogleConnectedAccounts([]); return; }
    let alive = true;
    invoke<Array<{ label?: string; status?: string }>>("google_profiles")
      .then((ps) => {
        if (!alive) return;
        const connected = (ps ?? [])
          .filter((p) => p && p.status === "connected" && !!p.label)
          .map((p) => String(p.label));
        setGoogleConnectedAccounts(connected);
      })
      .catch(() => { if (alive) setGoogleConnectedAccounts([]); });
    return () => { alive = false; };
  }, [googleInContext]);
  const conversationTokens = useMemo(() => messages.reduce((a, mm) => a + estimateTokens(mm.content), 0), [messages]);
  const attachedTokens = useMemo(
    () =>
      primedContext.reduce((a, c) => a + estimateTokens(c.body), 0)
      // Attached skills inline their full SKILL.md body into the prompt (capped
      // ~4000 chars each ≈ ~1000 tokens), so count them or the meter under-reads
      // and auto-compact can stay dormant while the real prompt is large.
      + attachedSkills.length * 1000,
    [primedContext, attachedSkills],
  );
  const ctxWindowTokens = useMemo(
    () => contextWindowFor(selectedCli, selectedCli ? (modelByCli[selectedCli] ?? null) : null),
    [selectedCli, modelByCli],
  );
  // AUTO-COMPACTION: when the window crosses ~85% and the turn is idle, summarize
  // & continue on its own so responses don't degrade from an overfull context.
  // Self-limiting - compaction resets the conversation, dropping the fill below
  // the threshold. Off-switchable from the meter (PREF.autoCompact).
  const [autoCompacted, setAutoCompacted] = useState(false);
  useEffect(() => {
    if (getPref(PREF.autoCompact, "1") !== "1") return;
    if (compacting) return;
    if (messages.length < 3) return;                  // need a real conversation
    if (messages.some((mm) => mm.streaming)) return;  // never mid-response
    if ((conversationTokens + attachedTokens) / Math.max(1, ctxWindowTokens) < 0.85) return;
    setAutoCompacted(true);
    window.setTimeout(() => setAutoCompacted(false), 6000);
    void compactConversation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, conversationTokens, attachedTokens, ctxWindowTokens]);
  // Use a ref for the active thread path so async saves don't capture
  // a stale closure value. Without this, every streaming chunk after
  // the first save still saw activeThreadPath=null and created a new
  // file - hence the duplicates the user reported.
  const activeThreadRef = useRef<string | null>(activeThreadPath);
  useEffect(() => { activeThreadRef.current = activeThreadPath; }, [activeThreadPath]);
  // C2 (Monday feedback): surface the active thread name in the canvas so it's
  // never ambiguous which thread you're typing into. Derived from the loaded
  // thread meta, falling back to the path slug.
  const [threadTitle, setThreadTitle] = useState<string>("");
  useEffect(() => {
    if (tDomain && activeThreadPath && activeThreadPath.includes(`/${tDomain}/`)) {
      lsSet(`prevail.domain.${tDomain}.lastThread`, activeThreadPath);
    }
  }, [tDomain, activeThreadPath]);
  // When the auto-save effect adopts a new path mid-stream we stamp
  // the path here. The load-on-change effect below uses this to skip
  // reloading from disk - the in-memory messages are already ahead of
  // what was saved (more chunks have arrived). Reloading would
  // overwrite them and the assistant placeholder loses streaming:true,
  // which is the original cause of the "(empty reply)" symptom.
  const selfSetPathRef = useRef<string | null>(null);
  // The thread path whose turns are currently shown. Lets the load effect tell a
  // real navigation (path changed) from a re-pick of the same thread (only the
  // nonce changed), so it can reload on re-pick yet skip a disk reload that would
  // wipe a live stream.
  const displayedPathRef = useRef<string | null>(null);
  // Current messages, read by the load effect without subscribing to them (so
  // the effect doesn't re-run on every streamed chunk).
  const messagesRef = useRef(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  // Any thread pick returns to the chat view - even re-clicking the active
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
    // even if Preferences was open - otherwise the click appears to do nothing.
    setDomainTab("chat");
    if (!activeThreadPath) { setMessages([]); setThreadTitle(""); displayedPathRef.current = null; return; }
    if (selfSetPathRef.current === activeThreadPath) {
      selfSetPathRef.current = null;
      displayedPathRef.current = activeThreadPath;
      return;
    }
    // Re-picking the SAME thread bumps chatViewNonce but not activeThreadPath, so
    // without depending on the nonce the load effect never re-fired and the chat
    // stayed blank (the "first thread shows blank until you make a second one"
    // bug). We now also key on chatViewNonce. BUT a re-pick of the already-shown
    // thread must not reload from disk while a reply is streaming - the in-memory
    // transcript is ahead of disk and reloading would wipe the live assistant
    // bubble ("(empty reply)"). A real navigation (path changed) always loads.
    if (activeThreadPath === displayedPathRef.current && messagesRef.current.some((m) => m.streaming)) {
      return;
    }
    let cancelled = false;
    invoke<{ meta: ThreadMeta; turns: ThreadTurn[] }>("load_thread", { path: activeThreadPath })
      .then((t) => {
        if (cancelled) return;
        displayedPathRef.current = activeThreadPath;
        setThreadTitle(t.meta?.title?.trim() || "Untitled");
        setMessages(t.turns.map((tn) => ({
          role: tn.role,
          cli: tn.cli ?? undefined,
          content: tn.content,
          ts: Date.now(),
        })));
      })
      .catch((e) => console.error("load_thread", e));
    return () => { cancelled = true; };
  }, [activeThreadPath, chatViewNonce]);
  // Auto-save the thread on every message change (debounced). Reads
  // the ref so each save reuses the existing slug once one exists.
  const saveTimer = useRef<number | null>(null);
  const savePendingRef = useRef<boolean>(false);
  // Extra guard: once a save with slug=null has been DISPATCHED, block
  // any further slug=null dispatches until activeThreadRef is set.
  // savePendingRef alone wasn't enough in practice - duplicates kept
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
  // panel persists across domain switches - so without this, only the first-ever
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

  // P4.7 Phase 3 - capture real chat usage. We snapshot the turn's meta
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
      })
        // S2: nudge the Usage panel to refresh now that a new record landed, so it
        // populates ~realtime instead of only on a thread/domain switch.
        .then(() => window.dispatchEvent(new CustomEvent("prevail:usage-updated")))
        .catch((e) => console.error("usage_append failed", e));

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
    // Harnesses are catalog-only, never a chat runtime. If nothing is selected —
    // OR a stale/"Start chat" selection points at a harness (which would dispatch
    // to "unknown cli") — fall back to a real CLI.
    const cliOnly = available.filter((c) => !isHarnessRuntime(c.id));
    if ((!selectedCli || isHarnessRuntime(selectedCli)) && cliOnly.length > 0) {
      setSelectedCli(cliOnly[0].id);
    }
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
      // Shared renderer for engine-produced ChatEvent streams. Bound to BOTH
      // engine-chat (advisory reply) and engine-agent (Act mode) channels, so an
      // Act run renders in the same bubble - including its Prevail-verified
      // "what I actually did" footer, which arrives in the final assistant event.
      const onEngineLine = (e: { payload: { session: string; stream?: string; data: ChatEvent | string } }) => {
          if (e.payload.session !== sessionRef.current) return;
          if (!mounted) return;
          // stderr lines arrive as raw strings - capture them on the
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
              // Incremental text chunk - append to the streaming bubble.
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
              // Token / cost accounting - stash on the streaming bubble.
              setMessages((m) => {
                const last = m[m.length - 1];
                if (last && last.streaming) {
                  return [...m.slice(0, -1), { ...last, usage: ev.usage }];
                }
                return m;
              });
              break;
            }
            case "route": {
              // Auto model routing: the engine chose a concrete model. Stash the
              // decision (for the routing chip) and update the bubble's model +
              // cli label from "auto" to what actually ran.
              if (ev.route) {
                const r = ev.route;
                setMessages((m) => {
                  const last = m[m.length - 1];
                  if (last && last.streaming) {
                    return [...m.slice(0, -1), { ...last, route: r, model: r.model || last.model, cli: r.cli || last.cli }];
                  }
                  return m;
                });
              }
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
            case "tool": {
              // Ground-truth tool activity - the REAL tools the model invoked, on
              // BOTH the chat and Act/agent streams. Rendered as a live checklist
              // under the bubble so the user sees WHAT a long job is doing. The
              // engine sends a structured `step` (id + label + running/done/failed);
              // older/agent events send only `text`, which we fold in as a
              // one-shot completed step so nothing regresses.
              const step = ev.step;
              const note = stripAnsi(ev.text ?? "").trim();
              // A plan update (from the model's TodoWrite) renders as the Plan
              // header; replace any prior plan with the latest revision.
              if (ev.plan && ev.plan.length) {
                const nextPlan = ev.plan;
                setMessages((m) => {
                  const last = m[m.length - 1];
                  if (!last || !last.streaming) return m;
                  return [...m.slice(0, -1), { ...last, plan: nextPlan }];
                });
                break;
              }
              if (!step && !note) break;
              setMessages((m) => {
                const last = m[m.length - 1];
                if (!last || !last.streaming) return m;
                const steps = [...(last.steps ?? [])];
                if (step && step.id) {
                  const i = steps.findIndex((s) => s.id === step.id);
                  if (step.status === "running") {
                    if (i === -1) steps.push({ id: step.id, label: step.label || note || "Working", status: "running", startedAt: Date.now(), detail: step.detail });
                    else steps[i] = { ...steps[i], label: step.label || steps[i].label, detail: step.detail ?? steps[i].detail };
                  } else if (i !== -1) {
                    // A failed result's detail is the error snippet - it replaces
                    // the call-time detail; a success keeps what was shown.
                    steps[i] = { ...steps[i], status: step.status, endedAt: Date.now(), label: step.label || steps[i].label, detail: step.detail ?? steps[i].detail };
                  } else {
                    // A result with no prior running step (rare): show it already finished.
                    steps.push({ id: step.id, label: step.label || note || "Working", status: step.status, startedAt: Date.now(), endedAt: Date.now(), detail: step.detail });
                  }
                } else {
                  // Legacy text-only tool note (agent path): a completed step.
                  steps.push({ id: `note-${steps.length}`, label: note, status: "done", startedAt: Date.now(), endedAt: Date.now() });
                }
                return [...m.slice(0, -1), { ...last, steps }];
              });
              break;
            }
            case "done":
              // 'done' on the stream closes the turn; the dedicated
              // engine-chat:done event below flips streaming off.
              break;
            default:
              // Unknown event type - tolerate per the schema's forward-
              // compat requirement. No-op.
              break;
          }
      };
      const u3 = await listen<{ session: string; stream?: string; data: ChatEvent | string }>("engine-chat:line", onEngineLine);
      const u5 = await listen<{ session: string; stream?: string; data: ChatEvent | string }>("engine-agent:line", onEngineLine);
      const onEngineDone = (e: { payload: { session: string; code: number } }) => {
          if (!mounted) return;
          onStreamEnd(e.payload.session);
          // Capture usage for engine-path turns - pull the token/cost
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
      };
      const u4 = await listen<{ session: string; code: number }>("engine-chat:done", onEngineDone);
      const u6 = await listen<{ session: string; code: number }>("engine-agent:done", onEngineDone);
      unlistenRefs.current = [u1, u2, u3, u4, u5, u6];
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

  // Bubble action handlers - shared across both renderers (in-domain
  // and no-domain). Copy uses the Clipboard API; Retry rewinds the
  // transcript to before the last user turn and resends; Edit pops
  // the user message back into the composer for revision.
  const copyToClipboard = useCallback(async (text: string) => {
    try { await navigator.clipboard.writeText(text); } catch (e) { console.error(e); }
  }, []);
  // F2: capture a chat turn into the rest of the app. "Task" adds it to the
  // board (in the active domain, or General); "Note" saves it to Notes. Both
  // confirm with a toast so the action is visible without leaving the chat.
  const makeTaskFromMessage = useCallback(async (text: string) => {
    const body = text.trim();
    if (!body) return;
    // A task is a one-liner; use the first line and keep it reasonable.
    const line = body.split("\n").find((l) => l.trim()) ?? body;
    const taskText = line.trim().slice(0, 240);
    const dom = tDomain || domain || "general";
    try {
      await invoke("tasks_add", { vault: vaultPath, domain: dom, text: taskText, source: "chat" });
      window.dispatchEvent(new Event("prevail:tasks-changed"));
      toast.success(`Added to your ${dom === "general" ? "board" : dom + " board"}.`);
    } catch (e) { toast.error(`Could not add the task: ${String(e)}`); }
  }, [vaultPath, tDomain, domain]);
  const saveMessageAsNote = useCallback(async (text: string) => {
    const body = text.trim();
    if (!body) return;
    try {
      await addNote(vaultPath, { body, source: "note" });
      toast.success("Saved to your notes.");
    } catch (e) { toast.error(`Could not save the note: ${String(e)}`); }
  }, [vaultPath]);
  // X10: pin a reply into the domain's layered memory (_memory.md) so it grounds
  // every future answer in this domain, alongside the daemon-distilled memory.
  const pinMessageToMemory = useCallback(async (text: string) => {
    const body = text.trim();
    if (!body) return;
    const dom = tDomain || domain || "general";
    try {
      await invoke("append_memory_md", { vault: vaultPath, domain: dom, note: body });
      window.dispatchEvent(new Event("prevail:context-changed"));
      toast.success(`Pinned to ${dom === "general" ? "your" : dom + "'s"} memory.`);
    } catch (e) { toast.error(`Could not pin to memory: ${String(e)}`); }
  }, [vaultPath, tDomain, domain]);
  // X5: distill a reply into a reusable skill file in this domain, so Prevail can
  // replay the procedure later instead of re-reasoning it.
  const makeSkillFromChat = useCallback(async (text: string) => {
    const body = text.trim();
    if (!body) return;
    const dom = tDomain || domain || "general";
    const firstLine = body.split("\n").map((l) => l.replace(/^#+\s*|[*_`]/g, "").trim()).find((l) => l.length > 0) ?? "skill";
    const name = firstLine.length > 48 ? firstLine.slice(0, 45).trimEnd() : firstLine;
    try {
      await invoke<string>("skill_create", { vault: vaultPath, domain: dom, name, body });
      window.dispatchEvent(new Event("prevail:context-changed"));
      toast.success(`Saved "${name}" as a skill.`);
    } catch (e) { toast.error(`Could not save the skill: ${String(e)}`); }
  }, [vaultPath, tDomain, domain]);
  // X9: turn a message's intent into a recurring automation (loop) in this
  // domain, seeded from the text, then jump to Automations to refine it.
  const makeLoopFromChat = useCallback(async (text: string) => {
    const intent = text.trim().replace(/\s+/g, " ");
    if (!intent || !domainPath) {
      if (!domainPath) toast.error("Open a domain first to create an automation.");
      return;
    }
    const name = intent.length > 48 ? intent.slice(0, 45).trimEnd() + "…" : intent;
    try {
      const doc = await readLoops(domainPath);
      const loop: Loop = {
        id: newLoopId(name),
        name,
        purpose: intent,
        type: "open",
        signals: [],
        condition: "always on",
        cadence: "weekly",
        autonomy: "suggest",
        evaluation: "The intent is being made real over time.",
        actions: [],
        status: "active",
        enabled: true,
        lastRunTs: null,
        createdTs: Date.now(),
      };
      await writeLoops(domainPath, { ...doc, loops: [loop, ...doc.loops] });
      window.dispatchEvent(new Event("prevail:loops-changed"));
      window.dispatchEvent(new CustomEvent("prevail:work-section", { detail: "automations" }));
      toast.success("Created an automation. Opening it to refine…");
    } catch (e) { toast.error(`Could not create the automation: ${String(e)}`); }
  }, [domainPath]);
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
    // Local-only (global Bunker OR this domain's privacy pin) forces a local
    // provider - swap away from any cloud CLI so a stale/cloud selection can't
    // leak. The picker already hides cloud models here; this is the guard.
    if (localOnly && !isLocalCli(chatCli)) {
      const local = preferredLocalCli(clis);
      if (!local) {
        const why = isBunkerOn() ? "Bunker Mode is on" : "This domain is set to local-only";
        setMessages((m) => [...m, { role: "user", content: input.trim(), ts: Date.now() }, { role: "assistant", content: `${why}, so replies stay on this device, but no local model provider (Ollama) was detected. Install or start Ollama, or change the setting in Settings → Privacy.`, ts: Date.now(), cli: chatCli }]);
        setInput("");
        return;
      }
      chatCli = local;
    }
    const chatModel = lsGet(`prevail.model.${chatCli}`) || null;
    // The "auto" router lives in the engine. On the native chat_send fallback
    // (no engine) there's nowhere to route, so treat "auto" as the provider
    // default rather than passing the literal "auto" to a raw CLI (which rejects
    // it). Non-breaking: any concrete model id is unchanged.
    const nativeModel = chatModel === "auto" ? null : chatModel;
    const visible = input.trim();
    const userMsg: ChatMessage = { role: "user", content: visible, ts: Date.now() };
    const replyMsg: ChatMessage = { role: "assistant", cli: chatCli, model: chatModel || undefined, framework: fwLens.framework ?? undefined, lens: fwLens.lens ?? undefined, content: "", ts: Date.now(), streaming: true };
    setMessages((m) => [...m, userMsg, replyMsg]);
    // Attach file paths to the prompt so the CLI can read them.
    const attachPreamble = attachments.length > 0
      ? `Attached files (read these as context):\n${attachments.map((p) => `- ${p}`).join("\n")}\n\n`
      : "";
    // X7: plan mode - ask for an editable plan first, no actions until approved.
    const planPreamble = planMode
      ? "PLAN MODE: Before doing anything or giving a final answer, lay out a short, numbered plan of how you would approach this, and STOP. Do not take any actions or produce the final result yet - wait for the user to review and approve or adjust the plan.\n\n"
      : "";
    // Items the user explicitly clicked "use in chat" on (state.md,
    // decisions.md, a session log, etc.) - included verbatim.
    const primedPreamble = primedContext.length > 0
      ? primedContext.map((c) => `--- ${c.label} ---\n${c.body.trim()}\n`).join("\n") + "\n"
      : "";
    // G3: Incognito mode -> a plain model, like vanilla ChatGPT. When on, NONE of
    // the user's context is injected: no ideal state, profile, omega, memory, or
    // skills. (Explicit per-message attachments the user added are still honored.)
    // Active when the global master OR the chat-specific flag is on.
    const incognito = incognitoActive("chat");
    const userPreamble = incognito ? "" : buildIdealStatePreamble(idealMd);
    // The person's profile/identity - auto-injected so the model always knows who
    // it's helping (no manual attach). Sits just under the Ideal State.
    // G1: instruct the model to be SPECIFIC - name the user's actual accounts,
    // institutions, cards, and items from this profile rather than generic
    // placeholders; if a needed specific isn't known, ask which one instead of
    // guessing or saying something vague like "your checking account".
    const profilePreamble = (!incognito && userMd.trim())
      ? `# WHO YOU'RE HELPING - the user's profile. Use this as ground truth about them.\n`
        + `When you give advice or recommendations, BE SPECIFIC TO THEM: name their actual accounts, banks, cards, providers, and items from this profile (e.g. "your Chase checking and Amex Gold", not "your checking and a credit card"). If a specific you need is not in the profile, ask which one rather than guessing or staying generic.\n`
        + `${userMd.trim().slice(0, 2500)}\n\n`
      : "";
    // Omega: app-wide learned context, just below the Ideal State, above memory.
    const omegaPreamble = incognito ? "" : buildOmegaPreamble(omegaMd);
    // Self-learning: prepend the distilled long-term memory for this domain.
    const memoryPreamble = (!incognito && getPref(PREF.persistentMemory, "1") === "1" && memoryMd.trim())
      ? `--- Long-term memory (${domain ?? "General"}) ---\n${memoryMd.trim().slice(0, Number(getPref(PREF.memoryBudgetChars, "4000")))}\n\n`
      : "";
    // Load the attached skills' actual SKILL.md bodies so the model gets their
    // instructions, not just a reference to a name it can't see.
    const skillsPreamble = await buildSkillsPreamble(attachedSkills, allSkills, domain ?? null);
    // Usage intelligence: tick the ledger for every skill riding this send
    // (fire-and-forget - accounting never delays or breaks the turn). Powers
    // the Skills page's popularity ranking + archive-the-bloat suggestions.
    for (const name of attachedSkills) {
      const sk = allSkills.find((s) => s.name === name && (s.domain === domain || !allSkills.some((x) => x.name === name && x.domain === domain)));
      if (sk) void invoke("engine_skill_used", { domain: sk.domain, skill: sk.name, source: "chat" }).catch(() => {});
    }
    // Build multi-turn context from prior messages. We pass it as a
    // single text payload because the CLIs spawn fresh each turn and
    // have no shared session. Cap at ~40K characters (~10K tokens) and
    // drop the oldest turns to fit, keeping at least the most recent.
    const history = buildChatContext(messages, 40000);
    const promptText = fwLens.buildPrompt(
      history
        ? `${planPreamble}${userPreamble}${profilePreamble}${omegaPreamble}${memoryPreamble}${attachPreamble}${primedPreamble}${skillsPreamble}You are mid-conversation. Below is the prior turn history; use it as context but do NOT repeat it back to the user.\n\n--- PRIOR TURNS ---\n${history}\n--- END PRIOR TURNS ---\n\nUser's next message: ${visible}`
        : `${planPreamble}${userPreamble}${profilePreamble}${omegaPreamble}${memoryPreamble}${attachPreamble}${primedPreamble}${skillsPreamble}${visible}`
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
    // sends - BEFORE the async model call - so a chat is never lost even on
    // a crash/quit mid-reply. Captures the exact prompt sent + every
    // preference in effect, so a future better model can replay it. The
    // matching raw reply is appended on completion (persistUsage).
    // The web-access decision for THIS turn: off in Bunker mode, else the
    // per-domain "Web access" toggle. The default MUST match the Modes UI
    // (chatviews reads it with fallback `true`) - otherwise an untouched toggle
    // shows ON in the UI while the engine is told "deny", and the turn is wrongly
    // refused. Passed to the engine so it actually enforces the lockdown.
    const webAllowed = isBunkerOn() ? false : getDomainToggle(domain, "web", true);
    const prefs = {
      framework: fwLens.framework ?? null,
      lens: fwLens.lens ?? null,
      localOnly: localOnly,
      web: webAllowed,
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
    // by soul.md / reads _state.md - VAULT-SPEC-v2 stages 3-4), so the engine
    // path grounds replies in the domain's real state again. Falls back to the
    // native chat_send path when the CLI isn't present.
    const ENGINE_CHAT_ENABLED = true;
    // Engine-only providers (no spawnable binary): OpenRouter is an HTTP gateway;
    // LM Studio / MLX are local HTTP servers the engine reaches via the ollama
    // provider path. They have no native chat_send path, so they must always go
    // through the engine — including in the no-domain General space, which the
    // engine now serves as a first-class "general" domain.
    const ENGINE_ONLY = new Set(["openrouter", "lmstudio", "mlx"]);
    // Use the engine when we're in a domain, OR when the chosen provider can only
    // run through the engine (so General + OpenRouter/LM Studio/MLX works).
    const useEngine = ENGINE_CHAT_ENABLED && engineAvailable && (!!domain || (!!chatCli && ENGINE_ONLY.has(chatCli)));
    // The engine treats General as the "general" domain (general_dir), so a
    // null/empty domain maps to that here.
    const engineDomain = domain || "general";
    // Act mode: this domain routes sends through the AGENT runtime (real,
    // broker-gated tools + a Prevail-verified action ledger) instead of an
    // advisory text reply. Requires the engine; off in Bunker Mode; if the
    // engine isn't available we fall through to normal chat so a turn is never
    // silently dropped.
    const actMode = !!domain && !isBunkerOn() && engineAvailable && getDomainToggle(domain, "act", false);
    // The user's Google-account chip selection (composer Modes). Threaded to the
    // engine as an AUTHORITATIVE default target account so the google_workspace
    // connector acts on the picked account even if the model omits an `account:`
    // tool-arg (the prompt note below is now belt-and-braces, not the only
    // signal). Comma-joined for multiple; empty selection => default account.
    let pickedGoogleAccounts: string[] = [];
    try {
      const parsed = JSON.parse(getPref(`prevail.domain.${domain}.googleAccounts`, "[]")) as string[];
      if (Array.isArray(parsed)) pickedGoogleAccounts = parsed.filter((s) => typeof s === "string" && s.trim());
    } catch { /* no valid selection, act on the default account */ }
    // If the Google app is ATTACHED to this chat but the user hasn't explicitly
    // picked an account in Modes, INHERIT the app's authenticated identity so
    // the chat authenticates as the app's own chat would. Precedence: explicit
    // chip pick > the attached app instance's own account binding
    // (manifest.account - attaching a bound app IS choosing that identity) >
    // the single connected account > unset (the engine refuses ambiguity).
    // The binding comes from the open app itself (app chat) or from whichever
    // attached Google app in this conversation carries one (domain chat) - see
    // boundGoogleAccount above.
    const googleAccountArg = inheritedGoogleAccount(pickedGoogleAccounts, googleConnectedAccounts, googleInContext, boundGoogleAccount);
    if (chatCli && ENGINE_ONLY.has(chatCli) && !useEngine) {
      const label = chatCli === "openrouter" ? "OpenRouter" : chatCli === "lmstudio" ? "LM Studio" : "oMLX";
      setMessages((m) => [...m.slice(0, -1), { role: "assistant", content: `${label} runs through the engine, which isn't available right now. Make sure the Prevail engine is installed, then try again.`, ts: Date.now(), cli: chatCli, model: chatModel ?? undefined }]);
      onStreamEnd(sessionRef.current);
      return;
    }
    try {
      if (actMode) {
        // Act mode → the agent runtime. It streams the SAME ChatEvent NDJSON on
        // engine-agent:* (rendered by onEngineLine/onEngineDone), so the reply
        // and its Prevail-verified action footer land in this bubble. We pass a
        // focused goal (the user's message plus anything they explicitly
        // attached); the agent grounds itself in the domain and calls Prevail's
        // vault-scoped tools (create_skill / create_loop / google_workspace).
        // If the user picked specific Google account(s) in Modes, tell the agent
        // which profile(s) to act for so google_workspace targets the right
        // inbox(es) and labels results by account (multi-profile in one send).
        const gAccNote = pickedGoogleAccounts.length > 0
          ? `\n\n[Google accounts to act for: ${pickedGoogleAccounts.join(", ")}. For each Google/gmail/calendar/drive action, pass account:"<label>" to the google_workspace tool, and label any results by account.]`
          : "";
        const agentGoal = `${attachPreamble}${primedPreamble}${skillsPreamble}${visible}${gAccNote}`.trim();
        await invoke("engine_agent_run", {
          session: sessionRef.current,
          vault: vaultPath,
          domain: engineDomain,
          goal: agentGoal,
          cli: chatCli || null,
          model: chatModel,
          autonomy: "auto",
          // Authoritative default account for the google_workspace connector.
          googleAccount: googleAccountArg,
        });
      } else if (useEngine) {
        await invoke("engine_chat", {
          session: sessionRef.current,
          vault: vaultPath,
          domain: engineDomain,
          message: promptText,
          cli: chatCli || null,
          model: chatModel,
          localOnly,
          web: webAllowed,
          // Economy / Balanced / Quality bias for the Auto router. Only consulted
          // by the engine when model === "auto"; harmless otherwise.
          routeBias: chatModel === "auto" ? getPref("prevail.route.bias", "balanced") : null,
          // Layer 4 cascade escalation (opt-in, default off). Only consulted by the
          // engine when model === "auto"; harmless otherwise.
          routeCascade: chatModel === "auto" ? getPref("prevail.route.cascade", "0") === "1" : null,
          // Authoritative default account for the google_workspace connector.
          googleAccount: googleAccountArg,
        });
      } else {
        await invoke("chat_send", {
          args: {
            cli: chatCli,
            model: nativeModel,
            prompt: promptText,
            session_id: sessionRef.current,
            timeout_sec: (() => { const n = parseInt(getPref(PREF.llmPromptTimeoutSec, "300"), 10); return Number.isFinite(n) && n > 0 ? n : null; })(),
            web: webAllowed,
          },
        });
      }
    } catch (e) {
      // If the engine path failed to even spawn, fall back to the native
      // path once so a transient engine issue doesn't drop the turn - but only
      // for providers with a real spawnable binary (engine-only providers like
      // LM Studio / MLX / OpenRouter have none, so the native path can't serve
      // them and would just echo "unknown cli").
      if (useEngine && chatCli && !ENGINE_ONLY.has(chatCli)) {
        try {
          await invoke("chat_send", {
            args: {
              cli: chatCli,
              model: nativeModel,
              prompt: promptText,
              session_id: sessionRef.current,
              timeout_sec: (() => { const n = parseInt(getPref(PREF.llmPromptTimeoutSec, "300"), 10); return Number.isFinite(n) && n > 0 ? n : null; })(),
            },
          });
          return;
        } catch { /* fall through to error rendering */ }
      }
      setMessages((m) => [...m.slice(0, -1), { role: "assistant", content: `(error spawning ${chatCli}: ${e})`, ts: Date.now(), cli: chatCli, model: chatModel ?? undefined }]);
      onStreamEnd(sessionRef.current);
    }
  }

  // Quick-action seed prompts - currently surfaced via DomainHome,
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
    } catch (err) { console.error("attach domain", err); setAttachErr(`Couldn't attach ${titleCase(name)}: ${err}`); }
  }, [vaultPath, injectContext]);
  // Drag an app in as context - the mirror of attachDomainAsContext. An app
  // isn't a folder of prose; what's useful to the model is what the app IS and
  // the freshness of the data it feeds, so we attach a compact identity card
  // (connector, status, the domains it refreshes, schedule, last sync).
  const attachAppAsContext = useCallback(async (id: string) => {
    if (!id) return;
    try {
      const all = await invoke<EngineApp[]>("engine_apps_list", { vault: vaultPath });
      const app = all.find((a) => a.id === id);
      if (!app) return;
      const head = [
        `# App: ${app.title}${app.account?.label ? ` (${app.account.label})` : ""}`,
        `Connector: ${app.integration} · status: ${app.status}`,
        app.domains.length
          ? `Feeds these domains: ${app.domains.map(titleCase).join(", ")}`
          : "Not bound to any domain yet.",
        app.refresh?.every ? `Syncs every ${app.refresh.every}.` : "Manual sync only.",
        `Last synced ${relTime(app.lastSuccessTs)}.`,
      ].join("\n");
      // Attach the app's LOCAL saved data from the vault, not a live browse. For
      // browser-automation (and every other) connector, what the agent can chat
      // about is whatever the sync captured into the vault - we read the most
      // recent saved files here, within a budget, and never touch the live app.
      let dataBlock = "";
      try {
        const files = await invoke<{ path: string; name: string; bytes: number }[]>("app_data_files", { vault: vaultPath, appId: id });
        const TEXT = /\.(md|txt|json|ndjson|csv|tsv|ya?ml|log)$/i;
        const textFiles = (files ?? []).filter((f) => TEXT.test(f.name)).slice(0, 6);
        const BUDGET = 8000;
        let used = 0;
        const chunks: string[] = [];
        for (const f of textFiles) {
          if (used >= BUDGET) break;
          const raw = await invoke<string>("read_text_file", { path: f.path }).catch(() => "");
          if (!raw.trim()) continue;
          const slice = raw.slice(0, Math.min(2500, BUDGET - used));
          used += slice.length;
          chunks.push(`### ${f.name}\n${slice}${raw.length > slice.length ? "\n…(truncated)" : ""}`);
        }
        dataBlock = chunks.length
          ? `\n\nSaved local data (read from your vault, not a live browse):\n${chunks.join("\n\n")}`
          : `\n\nNo local data is saved for this app yet. I read what its sync has captured into your vault - I do not browse the app live - so connect or sync it to pull data in.`;
      } catch { /* data read is best-effort; the identity card still attaches */ }
      // Record the app's identity binding under its context label so the send
      // path can carry it into the turn (any connector type; consumed today by
      // the google_workspace account routing, visible in the card for all).
      if (app.account?.label) {
        attachedBindingsRef.current[`app: ${app.title}`] = { id: app.id, account: app.account.label };
      }
      injectContext(head + dataBlock, `app: ${app.title}`);
    } catch (err) { console.error("attach app", err); setAttachErr(`Couldn't attach app: ${err}`); }
  }, [injectContext, vaultPath]);
  // Test/drag hooks - exposed on window so the sidebar's manual drag (WebKit's
  // HTML5 DnD is unreliable in WKWebView) can attach a domain or app on drop.
  // Call window.__prevailAttach('tax') / __prevailAttachApp('gmail') in DevTools.
  // B1: keep the latest attach callbacks in refs and register the window hooks
  // ONCE on mount. Registering them in an effect keyed on the callbacks meant the
  // cleanup deleted the hooks every time those callbacks changed identity - a
  // teardown race that left the sidebar's drag-drop with no hook to call.
  const attachDomainRef = useRef(attachDomainAsContext);
  const attachAppRef = useRef(attachAppAsContext);
  useEffect(() => { attachDomainRef.current = attachDomainAsContext; attachAppRef.current = attachAppAsContext; });
  // Claim the global drag-attach hook ONLY while this is the active surface, so a
  // dropped app/domain lands here and not in the hidden council panel (both stay
  // mounted). Re-claims whenever `active` flips true; no cleanup-delete so the
  // other surface's re-claim (on its activation) is the single source of truth.
  useEffect(() => {
    if (!active) return;
    const w = window as unknown as {
      __prevailAttach?: (n: string, mode?: "light" | "full" | "folder") => void;
      __prevailAttachApp?: (id: string) => void;
    };
    w.__prevailAttach = (n, mode) => void attachDomainRef.current(n, mode ?? "light");
    w.__prevailAttachApp = (id) => void attachAppRef.current(id);
  }, [active]);

  // Domain detail shell (mirrors AppDetail): a header + horizontal pill tab bar,
  // one panel shown at a time. Active when a real domain is open and we're not on
  // the plain conversation ("chat"). The tab bodies below reuse the SAME existing
  // domain components (LoopsPanel, BoardPanel, InsightsPanel, the context bundle,
  // DomainPrefsPanel, DomainAppsTab) - this only reorganizes their presentation.
  // General is a first-class domain too: it carries no `domain` slug (empty), but
  // its data lives in the general bucket (data/domains/general on a v4 vault, else
  // the vault root) exactly as its chat + preferences already read. So the detail
  // shell treats it as a domain. `dkey`/`dlabel`/`dblurb` give every tab body a
  // safe key + display name whether or not a real domain slug is present.
  const dkey = domain || "general";
  const dlabel = domain ? titleCase(domain) : "General";
  const dblurb = domain ? domainBlurb(domain) : "Your catch-all workspace for anything not tied to a specific domain.";
  // Active for any domain including General (no app, and we're off the plain
  // conversation). General has no `domain` slug but is still a domain.
  const inDomainDetail = !isApp && domainTab !== "chat";
  // The unified domain tab set. Domain-appropriate: it drops the app-only facets
  // (Connections, Runs, catalog Domains-mapping) and keeps the domain-unique views
  // (Insights, Work). Usage is folded into the Insights tab as a section.
  const DOMAIN_TABS: { id: DomainTab; label: string; icon: typeof Home; count?: number }[] = [
    { id: "welcome", label: "Welcome", icon: Home },
    { id: "soul", label: "Ideal State", icon: Sparkles },
    { id: "journal", label: "Journal", icon: BookOpen },
    { id: "skills", label: "Skills", icon: Boxes, count: domainCtx?.skills.length || undefined },
    { id: "loops", label: "Loops", icon: Repeat },
    { id: "work", label: "Work", icon: Briefcase },
    { id: "insights", label: "Insights", icon: Lightbulb },
    ...(domain ? [{ id: "apps" as const, label: "Apps", icon: Plug }] : []),
    { id: "prefs", label: "Settings", icon: SettingsIcon },
    { id: "chat", label: "Chat", icon: MessageSquare },
  ];
  // The context bundle exposes the raw journal/state/decisions/logs; the Journal
  // tab surfaces them. `context`/`state`/`decisions`/`logs` remain valid domainTab
  // values (reached from the context drawer) and fall through to their own bodies.
  const detailHeader = inDomainDetail && (
    <>
      <div className="flex flex-wrap items-start gap-4 border-b border-border-subtle bg-surface px-6 pb-4 pt-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
          {(() => { const I = domainIcon(dkey); return I ? <I className="h-6 w-6" /> : <span className="text-lg">◆</span>; })()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="truncate text-2xl font-bold tracking-tight text-text-primary">{dlabel}</h2>
            <ContextScoreBadge score={ctxScore} onClick={() => setDomainTab("insights")} />
          </div>
          <div className="mt-1.5 truncate text-[13px] text-text-muted">{dblurb}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={() => setDomainTab("chat")}
            title="Back to the conversation"
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-background hover:bg-accent-hover"
          >
            <MessageSquare className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="border-b border-border-subtle bg-surface px-6">
        <div className="flex flex-wrap items-center gap-1 py-2.5">
          {DOMAIN_TABS.map((t) => {
            const Icon = t.icon;
            const active = domainTab === t.id
              || (t.id === "journal" && (domainTab === "state" || domainTab === "decisions" || domainTab === "logs" || domainTab === "context"));
            return (
              <button
                key={t.id}
                onClick={() => setDomainTab(t.id)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${active ? "bg-accent text-background shadow-sm" : "text-text-muted hover:bg-surface-warm hover:text-text-secondary"}`}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
                {t.count !== undefined && <span className={`rounded-full px-1.5 py-px font-mono text-[10px] ${active ? "bg-background/20 text-background" : "bg-surface-warm text-text-muted"}`}>{t.count}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );

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
      {/* Header - just the domain identity now. Insights / Preferences /
          archive moved up to the top tab bar; the score badge opens the
          context view. When no domain is active there's no header at all -
          the empty state owns the canvas. */}
      {inDomainDetail ? detailHeader : domain && !isApp && (
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
              onClick={() => setDomainTab("welcome")}
            />
          </div>
        </div>
      )}

      {/* C2 (Monday feedback): always show which thread is active in the canvas. */}
      {activeThreadPath && threadTitle && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border-subtle bg-surface-warm/40 px-4 py-1.5">
          <FileText className="h-3 w-3 shrink-0 text-text-muted" />
          <span className="truncate font-mono text-[11px] text-text-secondary" title={threadTitle}>{threadTitle}</span>
        </div>
      )}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {messages.length === 0 && !domain && domainTab === "chat" && (
          <div className="flex h-full flex-col items-center justify-center px-6 py-8">
            <PrevailLogo size={64} src="/logo-512.png" />
            <h2 className="mt-6 font-display text-4xl font-bold tracking-tight sm:text-5xl">
              What should we work on?
            </h2>
            <p className="mt-3 max-w-md text-balance text-center text-sm text-text-muted">
              An AI that learns you, gets sharper, and surfaces what you'd have missed.
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

            {/* HOME-1: the Briefing - proactive digest (top recommendations +
                recent intents). Off by default for a minimal landing; opt in
                from Settings -> General. */}
            {getPref(PREF.showHomeBriefing, "0") === "1" && <HomeBriefing vaultPath={vaultPath} />}


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
              onMakeTask={makeTaskFromMessage}
              onSaveNote={saveMessageAsNote}
              onPinMemory={pinMessageToMemory}
              onMakeLoop={makeLoopFromChat}
              onMakeSkill={makeSkillFromChat}
            />
          </div>
        )}
        {domainTab !== "chat" && (
          <div className="w-full px-6 py-6">
            {/* WELCOME - a full-screen domain dashboard: a hero row with the
                clickable Context Score, then a responsive grid of rich, clickable
                cards (what it is + ideal state, context health breakdown, key
                metrics, recent activity, active loops, apps feeding it). Every
                card routes to its tab; the score opens its Insights breakdown. */}
            {domainTab === "welcome" && (() => {
              const skillsN = domainCtx?.skills.length ?? 0;
              const sessionsN = domainCtx?.recent_logs.length ?? 0;
              const loopsAll = domainLoops ?? [];
              const loopsActive = loopsAll.filter((l) => l.active);
              const appsFeeding = appsCache.filter((a) => domain != null && a.domains.includes(domain));
              const journalN = domainCtx?.journal ? domainCtx.journal.trim().split(/\n#{1,3}\s/).filter(Boolean).length : 0;
              const score = ctxScore?.score ?? null;
              const scoreCol = score != null ? scoreColor(score) : "var(--color-text-muted)";
              const idealFirstLine = domainSoul.trim().split(/\n+/).map((s) => s.replace(/^#+\s*/, "").trim()).find((s) => s.length > 0) ?? "";
              const bd = ctxScore?.breakdown;
              const missing = ctxScore?.missing ?? [];
              const openScore = () => setDomainTab("insights");
              const sevColor = (s: string) => s === "critical" ? "var(--color-err)" : s === "warn" ? "var(--color-warn)" : "var(--color-text-muted)";
              return (
                <div className="space-y-4">
                  {/* HERO ROW - identity on the left, clickable Context Score ring on the right. */}
                  <div className="flex flex-col items-stretch gap-4 rounded-2xl border border-border-subtle bg-surface/50 p-5 md:flex-row md:items-center">
                    <div className="flex min-w-0 flex-1 items-center gap-4">
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                        {(() => { const I = domainIcon(dkey); return I ? <I className="h-7 w-7" /> : <span className="text-2xl">◆</span>; })()}
                      </div>
                      <div className="min-w-0">
                        <h2 className="truncate text-xl font-bold tracking-tight text-text-primary">{dlabel}</h2>
                        <p className="mt-1 text-[13px] leading-relaxed text-text-secondary">{dblurb}</p>
                      </div>
                    </div>
                    {/* Context Score - CLICKABLE: opens the Insights breakdown. Plus a re-scan affordance. */}
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        onClick={openScore}
                        title="Open the context score breakdown"
                        className="group flex items-center gap-3 rounded-xl border border-border-subtle bg-background/60 px-4 py-3 transition-colors hover:border-accent-border hover:bg-surface-warm/60"
                      >
                        <div className="relative h-14 w-14 shrink-0">
                          <svg viewBox="0 0 36 36" className="h-14 w-14 -rotate-90">
                            <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--color-surface-strong)" strokeWidth="3.5" />
                            <circle cx="18" cy="18" r="15.5" fill="none" stroke={scoreCol} strokeWidth="3.5" strokeLinecap="round"
                              strokeDasharray={`${((score ?? 0) / 100) * 97.4} 97.4`} />
                          </svg>
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className="font-mono text-sm font-bold" style={{ color: scoreCol }}>{score != null ? score : "·"}</span>
                          </div>
                        </div>
                        <div className="text-left">
                          <div className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-text-muted">Context score</div>
                          <div className="text-[13px] font-semibold text-text-primary">{score != null ? (score >= 80 ? "Strong" : score >= 60 ? "Solid" : score >= 40 ? "Thin" : "Sparse") : (ctxScoreLoading ? "Scoring…" : "Not scored")}</div>
                          <div className="mt-0.5 inline-flex items-center gap-0.5 text-[10px] text-text-muted opacity-0 transition-opacity group-hover:opacity-100">View breakdown <ArrowUpRight className="h-3 w-3" /></div>
                        </div>
                      </button>
                      <button
                        onClick={rescanContextScore}
                        disabled={ctxScoreRescanning}
                        title="Re-scan the context score"
                        className="flex h-10 w-10 items-center justify-center rounded-xl border border-border-subtle text-text-muted transition-colors hover:border-accent-border hover:text-accent disabled:opacity-50"
                      >
                        <RefreshCw className={`h-4 w-4 ${ctxScoreRescanning ? "animate-spin" : ""}`} />
                      </button>
                    </div>
                  </div>

                  {ctxScoreError && <div className="rounded-lg border border-border-subtle bg-surface/50 px-4 py-2 text-[12px] text-warn">Score error: {ctxScoreError}</div>}

                  {/* KEY METRICS - clickable stat tiles, each routing to its tab. */}
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                    <StatTile icon={Boxes} label="Skills" value={skillsN} onClick={() => setDomainTab("skills")} />
                    <StatTile icon={FileText} label="Sessions" value={sessionsN} onClick={() => setDomainTab("journal")} />
                    <StatTile icon={Repeat} label="Active loops" value={loopsActive.length} onClick={() => setDomainTab("loops")} />
                    <StatTile icon={Briefcase} label="Work" value={<Briefcase className="h-6 w-6 text-text-secondary" />} hint="Open board" onClick={() => setDomainTab("work")} />
                    <StatTile icon={Plug} label="Apps" value={appsFeeding.length} onClick={() => setDomainTab("apps")} />
                    <StatTile icon={BookOpen} label="Journal" value={journalN} onClick={() => setDomainTab("journal")} />
                  </div>

                  {/* MAIN GRID - fills the screen with rich, clickable cards. */}
                  <div className="grid gap-4 lg:grid-cols-3">
                    {/* What this domain is / why it matters -> Ideal State. */}
                    <button
                      onClick={() => setDomainTab("soul")}
                      className="group flex flex-col rounded-2xl border border-border-subtle bg-surface/50 p-5 text-left transition-colors hover:border-accent-border hover:bg-surface-warm/40"
                    >
                      <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary"><Target className="h-4 w-4 text-accent" /> What this is · why it matters</h3>
                      <p className="mt-2 text-[13px] leading-relaxed text-text-secondary">{dblurb}</p>
                      {idealFirstLine ? (
                        <div className="mt-3 rounded-lg border border-border-subtle bg-background/50 p-3">
                          <div className="font-mono text-[10px] uppercase tracking-wider text-text-muted">Ideal state</div>
                          <p className="mt-1 line-clamp-3 text-[12px] leading-relaxed text-text-secondary">{idealFirstLine}</p>
                        </div>
                      ) : (
                        <div className="mt-3 rounded-lg border border-dashed border-border bg-background/40 p-3">
                          <div className="flex items-center gap-1.5 text-[12px] font-medium text-accent"><Sparkles className="h-3.5 w-3.5" /> Set the ideal state</div>
                          <p className="mt-0.5 text-[11px] text-text-muted">Describe what a thriving {dlabel} looks like. Your AI reads it as standing direction.</p>
                        </div>
                      )}
                      <span className="mt-auto pt-3 inline-flex items-center gap-0.5 text-[11px] font-medium text-text-muted opacity-0 transition-opacity group-hover:opacity-100">Open Ideal State <ArrowUpRight className="h-3 w-3" /></span>
                    </button>

                    {/* Context health -> Insights. The score dimensions + what to improve. */}
                    <button
                      onClick={openScore}
                      className="group flex flex-col rounded-2xl border border-border-subtle bg-surface/50 p-5 text-left transition-colors hover:border-accent-border hover:bg-surface-warm/40"
                    >
                      <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary"><Activity className="h-4 w-4 text-accent" /> Context health</h3>
                      {bd ? (
                        <div className="mt-3 space-y-2.5">
                          <ScoreDimRow label="Coverage" dim={bd.coverage} />
                          <ScoreDimRow label="Density" dim={bd.density} />
                          <ScoreDimRow label="Freshness" dim={bd.freshness} />
                          <ScoreDimRow label="Structure" dim={bd.structure} />
                          <ScoreDimRow label="Activity" dim={bd.activity} />
                        </div>
                      ) : (
                        <p className="mt-3 text-[12px] text-text-muted">{ctxScoreLoading ? "Scoring this domain…" : "Re-scan to compute the context breakdown."}</p>
                      )}
                      {missing.length > 0 && (
                        <div className="mt-4">
                          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-text-muted">What to improve</div>
                          <ul className="space-y-1">
                            {missing.slice(0, 3).map((m, i) => (
                              <li key={i} className="flex items-start gap-1.5 text-[12px] text-text-secondary">
                                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: sevColor(m.severity) }} />
                                <span className="min-w-0">{m.label}</span>
                              </li>
                            ))}
                          </ul>
                          {missing.length > 3 && <div className="mt-1 text-[11px] text-text-muted">+{missing.length - 3} more</div>}
                        </div>
                      )}
                      <span className="mt-auto pt-3 inline-flex items-center gap-0.5 text-[11px] font-medium text-text-muted opacity-0 transition-opacity group-hover:opacity-100">Open Insights <ArrowUpRight className="h-3 w-3" /></span>
                    </button>

                    {/* Active loops -> Loops. */}
                    <button
                      onClick={() => setDomainTab("loops")}
                      className="group flex flex-col rounded-2xl border border-border-subtle bg-surface/50 p-5 text-left transition-colors hover:border-accent-border hover:bg-surface-warm/40"
                    >
                      <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary"><Repeat className="h-4 w-4 text-accent" /> Active loops{loopsActive.length > 0 && <span className="rounded-full bg-surface-warm px-1.5 py-0.5 font-mono text-[10px] text-text-muted">{loopsActive.length}</span>}</h3>
                      {loopsActive.length > 0 ? (
                        <ul className="mt-3 space-y-2">
                          {loopsActive.slice(0, 4).map((l) => (
                            <li key={l.id} className="rounded-lg border border-border-subtle bg-background/50 px-3 py-2">
                              <div className="truncate text-[13px] font-medium text-text-primary">{l.name}</div>
                              {l.purpose && <div className="mt-0.5 line-clamp-1 text-[11px] text-text-muted">{l.purpose}</div>}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="mt-3 rounded-lg border border-dashed border-border bg-background/40 p-3 text-[12px] text-text-muted">No standing loops yet. Loops keep this domain moving on their own.</div>
                      )}
                      <span className="mt-auto pt-3 inline-flex items-center gap-0.5 text-[11px] font-medium text-text-muted opacity-0 transition-opacity group-hover:opacity-100">Open Loops <ArrowUpRight className="h-3 w-3" /></span>
                    </button>

                    {/* Recent activity -> Journal. */}
                    <button
                      onClick={() => setDomainTab("journal")}
                      className="group flex flex-col rounded-2xl border border-border-subtle bg-surface/50 p-5 text-left transition-colors hover:border-accent-border hover:bg-surface-warm/40 lg:col-span-2"
                    >
                      <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary"><FileText className="h-4 w-4 text-accent" /> Recent activity</h3>
                      {sessionsN > 0 ? (
                        <ul className="mt-3 space-y-2">
                          {domainCtx!.recent_logs.slice(0, 4).map((l) => (
                            <li key={l.path} className="rounded-lg border border-border-subtle bg-background/50 px-3 py-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className="truncate text-[13px] font-medium text-text-primary">{l.name.replace(/\.md$/, "")}</span>
                                <span className="shrink-0 font-mono text-[10px] text-text-muted">{relTime(l.mtime_secs * 1000)}</span>
                              </div>
                              {l.preview && <div className="mt-0.5 line-clamp-1 text-[11px] text-text-muted">{l.preview}</div>}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="mt-3 rounded-lg border border-dashed border-border bg-background/40 p-3 text-[12px] text-text-muted">No sessions yet. Start a chat in {dlabel} and it will build a journal here.</div>
                      )}
                      <span className="mt-auto pt-3 inline-flex items-center gap-0.5 text-[11px] font-medium text-text-muted opacity-0 transition-opacity group-hover:opacity-100">Open Journal <ArrowUpRight className="h-3 w-3" /></span>
                    </button>

                    {/* Apps feeding this domain -> Apps. */}
                    <button
                      onClick={() => setDomainTab("apps")}
                      className="group flex flex-col rounded-2xl border border-border-subtle bg-surface/50 p-5 text-left transition-colors hover:border-accent-border hover:bg-surface-warm/40"
                    >
                      <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary"><Plug className="h-4 w-4 text-accent" /> Apps feeding this{appsFeeding.length > 0 && <span className="rounded-full bg-surface-warm px-1.5 py-0.5 font-mono text-[10px] text-text-muted">{appsFeeding.length}</span>}</h3>
                      {appsFeeding.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {appsFeeding.slice(0, 8).map((a) => (
                            <div key={a.id} className="flex items-center gap-1.5 rounded-lg border border-border-subtle bg-background/50 px-2 py-1.5" title={a.title}>
                              <AppRowLogo app={{ title: a.title }} logos={logos} size={16} fallback="letter" />
                              <span className="max-w-[80px] truncate text-[11px] text-text-secondary">{a.title}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-3 rounded-lg border border-dashed border-border bg-background/40 p-3 text-[12px] text-text-muted">No apps feed {dlabel} yet. Connect apps to enrich its context automatically.</div>
                      )}
                      <span className="mt-auto pt-3 inline-flex items-center gap-0.5 text-[11px] font-medium text-text-muted opacity-0 transition-opacity group-hover:opacity-100">Open Apps <ArrowUpRight className="h-3 w-3" /></span>
                    </button>
                  </div>
                </div>
              );
            })()}
            {/* SOUL - this domain's own Ideal State (its target). A full-screen
                two-column layout: the editor + Generate with AI on the left, a
                "what a good ideal state covers" guide on the right. Reuses the same
                read_domain_ideal / write_domain_ideal contract as DomainPrefsPanel;
                Generate calls domain_draft_ideal (same command the Prefs panel uses). */}
            {domainTab === "soul" && (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                {/* LEFT: the editable Ideal State note + Generate with AI. */}
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col rounded-2xl border border-border-subtle bg-surface/50 p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary"><Target className="h-4 w-4 text-accent" /> Ideal State</h3>
                      <div className="flex items-center gap-1.5">
                        <button onClick={draftDomainSoul} disabled={soulDrafting} title="Research this domain and draft an ideal state" className="inline-flex items-center gap-1.5 rounded-md border border-accent-border bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent hover:bg-accent/10 disabled:opacity-50">
                          {soulDrafting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} {soulDrafting ? "Generating…" : "Generate with AI"}
                        </button>
                        {!editSoul && <button onClick={() => { setSoulDraft(domainSoul); setEditSoul(true); }} title="Edit ideal state" className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-text-muted hover:border-accent-border hover:text-accent"><Pencil className="h-3.5 w-3.5" /></button>}
                      </div>
                    </div>
                    <p className="mt-1.5 text-[12px] leading-relaxed text-text-muted">This domain's ideal state: the target your AI steers toward. It layers under your global ideal state and is injected into every turn in {dlabel}.</p>
                    {soulDraftErr && <p className="mt-2 text-[12px] text-err">{soulDraftErr}</p>}
                    {editSoul ? (
                      <div className="mt-3 flex flex-col">
                        <textarea autoFocus rows={14} value={soulDraft} onChange={(e) => setSoulDraft(e.target.value)}
                          placeholder={`What a thriving ${dlabel} looks like for you: the purpose, where things are now, the target, the metrics you track, the habits that get you there, and what to avoid.`}
                          className="w-full resize-none rounded-md border border-border bg-background px-2.5 py-2 text-[13px] leading-relaxed text-text-primary placeholder:text-text-muted/60 focus:border-accent-border focus:outline-none" />
                        <div className="mt-2 flex items-center gap-2">
                          <button onClick={saveDomainSoul} disabled={soulSaving} className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-background hover:bg-accent-hover disabled:opacity-50">{soulSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Save</button>
                          <button onClick={() => setEditSoul(false)} className="rounded-md border border-border px-2.5 py-1 text-xs text-text-muted hover:text-text-secondary">Cancel</button>
                        </div>
                      </div>
                    ) : domainSoul.trim() ? (
                      <div className="mt-3"><Markdown source={domainSoul} compact /></div>
                    ) : (
                      <div className="mt-3 flex flex-col items-start justify-center rounded-lg border border-dashed border-border bg-background/40 px-4 py-6 text-left">
                        <span className="text-[13px] text-text-secondary">Set the ideal state for {dlabel}.</span>
                        <span className="mt-0.5 text-[12px] text-text-muted">Describe its ideal state; your AI reads this as standing direction. Use Generate with AI to draft it from this domain's context, or write your own.</span>
                        <div className="mt-3 flex items-center gap-2">
                          <button onClick={draftDomainSoul} disabled={soulDrafting} className="inline-flex items-center gap-1.5 rounded-md border border-accent-border bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent hover:bg-accent/10 disabled:opacity-50">{soulDrafting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} {soulDrafting ? "Generating…" : "Generate with AI"}</button>
                          <button onClick={() => { setSoulDraft(""); setEditSoul(true); }} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-text-secondary hover:border-accent-border hover:text-accent"><Pencil className="h-3.5 w-3.5" /> Write my own</button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                {/* RIGHT: the helpful guide that fills the space. */}
                <div className="flex flex-col gap-4">
                  <div className="rounded-2xl border border-border-subtle bg-surface/50 p-5">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary"><ListChecks className="h-4 w-4 text-accent" /> What a good ideal state covers</h3>
                    <ul className="mt-3 space-y-3">
                      {([
                        { icon: Compass, label: "Purpose", hint: "Why this domain matters to you" },
                        { icon: Activity, label: "Current reality", hint: "Where things stand today, honestly" },
                        { icon: Target, label: "Target", hint: "What ideal looks like if it went well" },
                        { icon: TrendingUp, label: "Metrics you track", hint: "How you know you are on course" },
                        { icon: Repeat, label: "Habits and routines", hint: "The standing behaviors that get you there" },
                        { icon: ShieldAlert, label: "What to avoid", hint: "The traps and anti-patterns to steer clear of" },
                      ] as { icon: typeof Home; label: string; hint: string }[]).map((row) => {
                        const RowIcon = row.icon;
                        return (
                          <li key={row.label} className="flex items-start gap-3">
                            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent ring-1 ring-accent-border/40"><RowIcon className="h-3.5 w-3.5" /></span>
                            <div className="min-w-0">
                              <div className="text-[13px] font-medium text-text-primary">{row.label}</div>
                              <div className="text-[12px] leading-snug text-text-muted">{row.hint}</div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                  <div className="rounded-2xl border border-border-subtle bg-surface/50 p-5">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary"><ClipboardList className="h-4 w-4 text-accent" /> How this is used</h3>
                    <p className="mt-2 text-[13px] leading-relaxed text-text-secondary">{dblurb}</p>
                    <p className="mt-2 text-[12px] leading-relaxed text-text-muted">Your ideal state is prepended to every conversation in {dlabel} and steers what your AI proposes, the loops it runs, and how it scores this domain's context. Keep it current as things change.</p>
                  </div>
                </div>
              </div>
            )}
            {domain && domainTab === "context" && (
              <ContextScorePanel
                score={ctxScore}
                loading={ctxScoreLoading}
                rescanning={ctxScoreRescanning}
                error={ctxScoreError}
                onRescan={rescanContextScore}
                vaultPath={vaultPath}
              />
            )}
            {domainTab === "insights" && (
              <div className="space-y-8">
                <InsightsPanel
                  vaultPath={vaultPath}
                  domain={domain ?? ""}
                  onSeed={(t) => { setInput(t); setDomainTab("chat"); }}
                />
                {/* Usage folded into Insights: queries, tokens, and cost for this domain. */}
                <div>
                  <div className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-text-secondary"><Activity className="h-3.5 w-3.5 text-accent" /> Usage</div>
                  <UsageDashboard vault={vaultPath} domain={domain ?? null} nonce={chatViewNonce} />
                </div>
              </div>
            )}
            {domainTab === "usage" && (
              <UsageDashboard vault={vaultPath} domain={domain ?? null} nonce={chatViewNonce} />
            )}
            {domainTab === "apps" && domain && (
              <DomainAppsTab domain={domain} vaultPath={vaultPath} />
            )}
            {domainTab === "loops" && domainPath && (
              <LoopsPanel domain={domain || "general"} vaultPath={vaultPath} domainPath={domainPath} />
            )}
            {domainTab === "work" && (
              <BoardPanel vaultPath={vaultPath} initialDomain={domain || "general"} />
            )}
            {!domainCtx && (domainTab === "journal" || domainTab === "state" || domainTab === "decisions" || domainTab === "logs" || domainTab === "skills") && <div className="text-sm text-text-muted">loading…</div>}
            {domainCtx && domainTab === "state" && (domainCtx.state ? <Markdown source={domainCtx.state} compact /> : <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-sm text-text-muted">no <code className="text-accent">state.md</code> in this domain.</div>)}
            {domainCtx && domainTab === "decisions" && (domainCtx.decisions ? <Markdown source={domainCtx.decisions} compact /> : <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-sm text-text-muted">no <code className="text-accent">decisions.md</code> yet.</div>)}
            {/* JOURNAL - the domain's running context: journal + state snapshot +
                distilled decisions + recent session logs, reusing the same context
                bundle the context drawer reads. */}
            {domainCtx && domainTab === "journal" && (
              <div className="space-y-6">
                <div>
                  <div className="mb-2 flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-text-secondary"><BookOpen className="h-3.5 w-3.5 text-accent" /> Journal</div>
                  {domainCtx.journal ? <Markdown source={domainCtx.journal} compact /> : <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-sm text-text-muted">no journal entries yet.</div>}
                </div>
                {domainCtx.state && (
                  <div>
                    <div className="mb-2 flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-text-secondary"><Layers className="h-3.5 w-3.5 text-accent" /> State</div>
                    <Markdown source={domainCtx.state} compact />
                  </div>
                )}
                {domainCtx.decisions && (
                  <div>
                    <div className="mb-2 flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-text-secondary"><Scale className="h-3.5 w-3.5 text-accent" /> Decisions</div>
                    <Markdown source={domainCtx.decisions} compact />
                  </div>
                )}
                {domainCtx.recent_logs.length > 0 && (
                  <div>
                    <div className="mb-2 flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-text-secondary"><FileText className="h-3.5 w-3.5 text-accent" /> Recent sessions</div>
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
                  </div>
                )}
              </div>
            )}
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
            {domainCtx && domainTab === "skills" && (
              <>
                <NewSkillForm
                  vaultPath={vaultPath}
                  domain={dkey}
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
        {!domain && domainTab === "chat" && messages.length > 0 && (
          <div className="mx-auto w-full max-w-3xl px-6 py-8">
            <MessageList
              messages={messages}
              resetKey={chatViewNonce}
              onCopy={copyToClipboard}
              onRetry={retryFromHere}
              onEdit={editFromHere}
              onMakeTask={makeTaskFromMessage}
              onSaveNote={saveMessageAsNote}
              onPinMemory={pinMessageToMemory}
              onMakeLoop={makeLoopFromChat}
              onMakeSkill={makeSkillFromChat}
            />
          </div>
        )}
      </div>

      {/* Codex-style composer - full width to match Council. The reply
          transcript above stays in a centered max-w-3xl column for
          readability; only the composer goes edge-to-edge. */}
      <div data-tour="composer" className="shrink-0 px-6 pb-6 pt-2">
        <div className={`relative rounded-2xl border bg-surface p-3 transition-shadow ${
          (incognito || globalIncognito)
            ? "border-accent ring-2 ring-accent/40 shadow-[0_0_24px_-4px] shadow-accent/40"
            : "border-border shadow-sm"
        }`}>
          {/* Incognito affordance: a ghost badge over the top-left edge + the glow
              above, so it's unmistakable the turn sends none of your context. */}
          {(incognito || globalIncognito) && (
            <span className="absolute -top-2.5 left-3 z-10 inline-flex items-center gap-1 rounded-full border border-accent bg-surface px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-accent shadow-sm">
              <Ghost className="h-3 w-3" /> Incognito
            </span>
          )}
          {/* One row: context pills on the left, the context-window meter on the
              right - so attached context + the gauge share a line instead of
              stacking and eating vertical space. */}
          <div className="mb-1.5 flex items-center justify-between gap-2 px-1">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              {/* Incognito moved into Modes; when on, the composer shows a ghost
                  badge + glow (below) instead of a pill here. */}
              {primedContext.map((c, i) => (
                <span
                  key={c.label}
                  className="inline-flex items-center gap-1 rounded-full border border-accent-border bg-accent-soft py-0.5 pl-2 pr-1 font-mono text-[11px] text-accent"
                  title={c.body.slice(0, 200)}
                >
                  {ctxChipIcon(c.label)}
                  {c.label}
                  <button
                    onClick={() => setPrimedContext((cur) => cur.filter((_, j) => j !== i))}
                    className="ml-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full text-text-muted hover:bg-surface-warm hover:text-err"
                    title="Remove from context"
                  >×</button>
                </span>
              ))}
              {/* App-skill auto-attach toggle: only when an app with its own
                  SKILL.md is open. Controls whether its skill is auto-added as
                  context on every turn (per-app default), independent of the
                  removable pill above. */}
              {isApp && appId && appHasSkill && (
                <button
                  onClick={toggleAppAutoSkill}
                  title={appAutoSkill ? "This app's skill is auto-attached as context. Click to stop auto-attaching it." : "Auto-attach this app's skill as context so the model knows how to use it."}
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-colors ${appAutoSkill ? "border-accent-border bg-accent-soft text-accent" : "border-border text-text-muted hover:text-accent"}`}
                >
                  <Sparkles className="h-3 w-3" /> {appAutoSkill ? "App skill on" : "App skill off"}
                </button>
              )}
              {/* Suggested app skills: each secondary skill the app ships, offered
                  as a one-click attach. Once attached it shows as a removable
                  context pill above, so we only suggest the not-yet-attached ones. */}
              {isApp && appId && appSkillFiles
                .filter((s) => !s.primary && !primedContext.some((c) => c.label === `app-skill: ${s.name}`))
                .map((s) => (
                  <button
                    key={s.id}
                    onClick={() => toggleSkillAttach(s)}
                    title={s.summary ? `${s.summary}\n\nClick to attach as context.` : `Attach ${s.name} as context`}
                    className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-muted transition-colors hover:border-accent-border hover:text-accent"
                  >
                    <BookOpen className="h-3 w-3" /> + {s.name}
                  </button>
                ))}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {(autoCompacted || compacting) && (
                <span className="font-mono text-[10px] text-accent">{compacting ? "compacting…" : "auto-compacted ✓"}</span>
              )}
              <ContextMeter
                conversationTokens={conversationTokens}
                attachedTokens={attachedTokens}
                draftTokens={estimateTokens(input)}
                windowTokens={ctxWindowTokens}
                onReset={() => window.dispatchEvent(new Event("prevail:new-chat"))}
                onCompact={messages.length > 1 ? compactConversation : undefined}
                compacting={compacting}
                autoCompact={getPref(PREF.autoCompact, "1") === "1"}
                onToggleAutoCompact={(v) => setPref(PREF.autoCompact, v ? "1" : "0")}
              />
            </div>
          </div>
          {/* B2: visible attach error (replaces the old silent console.error). */}
          {attachErr && (
            <div className="mb-2 mx-1 flex items-start gap-2 rounded-md border border-warn/40 bg-warn/10 px-2.5 py-1.5 text-xs text-warn">
              <span className="flex-1">{attachErr}</span>
              <button onClick={() => setAttachErr(null)} className="shrink-0 text-warn/70 hover:text-warn">×</button>
            </div>
          )}
          {/* Slash-command popover for skills. Shown whenever a `/` is typed —
              including an empty state — so it never looks broken. */}
          {slashMatch && (
            <div className="absolute bottom-full left-3 z-40 mb-1 w-80 overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
              <div className="border-b border-border-subtle bg-surface-warm px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-text-muted">
                Skills · enter to insert
              </div>
              {slashCandidates.length === 0 ? (
                <div className="px-3 py-2 text-[11px] text-text-muted">No skills in this vault yet. Add one in a domain's <span className="font-mono">_skills/</span> folder.</div>
              ) : slashCandidates.map((s, i) => (
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
          {/* Context-mention popover for `$<domain|app>` */}
          {dollarMatch && dollarCandidates.length > 0 && (
            <div className="absolute bottom-full left-3 z-40 mb-1 w-80 overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
              <div className="border-b border-border-subtle bg-surface-warm px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-text-muted">
                Add context · enter to attach
              </div>
              {dollarCandidates.map((c, i) => (
                <button
                  key={`${c.kind}:${c.id}`}
                  onMouseDown={(e) => { e.preventDefault(); applyDollarCompletion(c); }}
                  className={`flex w-full items-start gap-2 px-3 py-1.5 text-left ${
                    i === dollarIdx ? "bg-accent-soft" : "hover:bg-surface-warm"
                  }`}
                >
                  {c.kind === "domain"
                    ? (() => { const I = domainIcon(c.id); return I
                        ? <I className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted" />
                        : <Layers className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted" />; })()
                    : <AppRowLogo app={{ id: c.id, title: c.label }} logos={logos} size={18} fallback="letter" />}
                  <div className="min-w-0">
                    <div className={`font-mono text-xs ${i === dollarIdx ? "text-accent" : "text-text-primary"}`}>
                      ${c.id}
                    </div>
                    <div className="line-clamp-1 text-[10px] text-text-muted">
                      {c.kind === "domain" ? "domain · attaches state.md" : `app · ${c.sub ?? "context card"}`}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={taRef}
            value={input}
            onChange={(e) => { setInput(e.target.value); setCaretPos(e.target.selectionStart ?? e.target.value.length); setHistIdx(-1); }}
            onSelect={(e) => syncCaret(e.currentTarget)}
            onKeyUp={(e) => syncCaret(e.currentTarget)}
            onClick={(e) => syncCaret(e.currentTarget)}
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
              // F3: a pasted image is saved to the vault and attached, so
              // screenshots can go into chat (vision-capable runtimes read the
              // file). Normalizes macOS's image/tiff clipboard flavor to PNG -
              // the old path rejected tiff, which made pasting look unsupported.
              const { paths, errors } = await savePastedImages(e, vaultPath);
              if (paths.length) {
                setAttachments((cur) => [...cur, ...paths.filter((p) => !cur.includes(p))]);
                toast.success(paths.length === 1 ? "Image attached." : `${paths.length} images attached.`);
              }
              for (const err of errors) { console.error("paste image", err); toast.error(`Could not attach the image: ${err}`); }
              if (paths.length || errors.length) return;
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
              // If the `$` context-mention popover is open, route nav keys to it.
              if (dollarMatch && dollarCandidates.length > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setDollarIdx((i) => (i + 1) % dollarCandidates.length);
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setDollarIdx((i) => (i - 1 + dollarCandidates.length) % dollarCandidates.length);
                  return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  applyDollarCompletion(dollarCandidates[dollarIdx]);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
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
              // Arrow-up / arrow-down recall - only when the textarea
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
            placeholder={history.length > 0 ? "ask anything · enter to send · ↑ history · / skills · $ context" : "ask anything · enter to send · / skills · $ context · shift+enter for newline"}
            rows={2}
            className="w-full resize-none bg-transparent px-2 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
          />
          {/* Domain imports - chips for files in this domain's
              imports/ folder. Click to toggle attach. Auto-fetched
              when the domain changes. */}
          {domainImports.length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5 px-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
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
          {/* Attached skills - separate from textarea text. Removing
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
          {/* Suggested skills - match the prompt's words against skill
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
                <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">suggested</span>
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
              {attachments.map((p, i) => {
                const isImage = /\.(png|jpe?g|gif|webp)$/i.test(p);
                return (
                <span key={i} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background py-0.5 pl-2 pr-1 font-mono text-[11px] text-text-secondary">
                  {isImage ? <ImageIcon className="h-3 w-3 text-ai" /> : <Folder className="h-3 w-3 text-text-muted" />}
                  {p.split("/").pop()}
                  <button
                    onClick={() => setAttachments((cur) => cur.filter((_, j) => j !== i))}
                    className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-text-muted hover:bg-surface-warm hover:text-err"
                    aria-label="Remove attachment"
                    title="Remove attachment"
                  ><X className="h-3 w-3" /></button>
                </span>
                );
              })}
            </div>
          )}
          {/* Single inline toolbar: + then the per-domain toggles,
              then a spacer, then model picker / council / send. */}
          {/* G2: the council roster lives in the COUNCIL panel, not here - this is
              single-model Chat, so showing the full council was confusing. */}
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
            <DomainStatusBar domain={domain} fwLens={fwLens} googleInContext={googleInContext} googleBound={boundGoogleAccount} />
            {/* X7: plan-mode toggle - ask for a plan before acting. */}
            <button
              onClick={() => setPlanMode((v) => !v)}
              title={planMode ? "Plan mode on: the AI will propose a plan and wait before acting" : "Plan mode: get an editable plan before the AI acts"}
              aria-pressed={planMode}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${planMode ? "border-accent bg-accent font-semibold text-background shadow-sm" : "border-border bg-background text-text-muted hover:text-accent"}`}
            >
              <ListChecks className="h-3.5 w-3.5" /> {planMode ? "Plan on" : "Plan"}
            </button>
            <div className="flex-1" />

            {/* Model picker pill - Codex-style. Click opens cascading
                provider→model menu. */}
            <div className="relative" ref={modelMenuRef}>
              <button
                onClick={() => setModelMenuOpen((v) => !v)}
                className="flex items-center gap-1.5 rounded-full border border-border bg-background px-2 py-1 transition-colors hover:bg-surface-warm"
                title="Pick runtime (model + how it runs)"
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
                    Runtime
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {clis.filter((c) => !isHarnessRuntime(c.id)).filter((c) => !localOnly || isLocalCli(c.id)).map((c) => {
                      const cliModels = modelsFor(c.id);
                      if (cliModels.length === 0) return null;
                      const curated = curatedFor(c.id);
                      const searchable = cliModels.length > curated.length;
                      const q = (modelSearch[c.id] ?? "").trim().toLowerCase();
                      const shown = q
                        ? cliModels.filter((m) => `${m.id} ${m.label ?? ""}`.toLowerCase().includes(q)).slice(0, 50)
                        : (searchable ? curated : cliModels);
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
                          {searchable && c.available && (
                            <input
                              value={modelSearch[c.id] ?? ""}
                              onChange={(e) => setModelSearch((s) => ({ ...s, [c.id]: e.target.value }))}
                              placeholder={`Search all ${cliModels.length} ${c.label} models…`}
                              className="mx-3 my-1 w-[calc(100%-1.5rem)] rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] focus:border-accent-border focus:outline-none"
                            />
                          )}
                          {shown.length === 0 && <div className="px-4 py-1.5 font-mono text-[11px] text-text-muted">No models match "{q}".</div>}
                          {shown.map((m) => {
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
                          {!q && searchable && c.available && (
                            <div className="px-4 py-1 font-mono text-[10px] text-text-muted">+{cliModels.length - shown.length} more · search to pick any model</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {/* Domain default management - only shown when in a
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
      <ContextCanvas />
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
