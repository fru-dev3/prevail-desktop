// The primary single-model Chat panel, extracted from App.tsx: composer, message
// stream, per-domain context, agent picker, and the domain sub-views. Renders the
// shared chatviews + domainpanels.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { ArrowUpRight, BookOpen, Boxes, Check, FileText, Folder, Ghost, Layers, PanelRightOpen, Paperclip, Plus, Scale, Sparkles } from "lucide-react";
import { PrevailLogo } from "./PrevailLogo";
import { invoke, listen } from "./bridge";
import { MODELS, isHarnessRuntime } from "./constants";
import { relTime, scoreColor, titleCase } from "./format";
import { startProcess, endProcess } from "./processes";
import { ContextMeter, contextWindowFor, estimateTokens } from "./contextmeter";
import { domainBlurb, isLocalCli, looksLikeJudgmentCall, preferredLocalCli, stripAnsi } from "./helpers";
import { buildChatContext, buildIdealStatePreamble, buildOmegaPreamble, buildQuickActions, loadPreferredSkills, maybeRedact, maybeStripSycophancy, savePreferredSkills } from "./helpers2";
import { LS, PREF, getDomainToggle, getPref, incognitoActive, isBunkerOn, lsGet, lsSet, setPref } from "./storage";
import { Markdown } from "./Markdown";
import { ContextScoreBadge, NewSkillForm, SkillsList } from "./panels";
import { InsightsPanel, UsageDashboard } from "./panels2";
import { ContextScorePanel, DomainAppsTab } from "./panels3";
import { domainIcon } from "./icons";
import { useFrameworkLens } from "./hooks";
import { ProviderMark } from "./marks";
import { DomainHome, DomainStatusBar, MessageList } from "./chatviews";
import { LoopsPanel } from "./loopspanel";
import { BoardPanel } from "./boardpanel";
import { AgentPickerRail, ContextCanvas, DomainContextDrawer, DomainPrefsPanel } from "./domainpanels";
import { HomeBriefing } from "./recommendationspanel";
import { HomeBenchScheduledBadge } from "./cards";
import type { ChatEvent, ChatMessage, CliInfo, ContextScore, Domain, DomainContextBundle, DomainTab, EngineApp, LifeReadiness, SkillEntry, ThreadMeta, ThreadTurn } from "./types";
import type { UnlistenFn } from "./bridge";

// Per-domain cache of the cheap (no-audit) context score. engine_score spawns the
// engine binary; users switch domains often, so re-opening a domain within the TTL
// should be instant (no spawn). Rescans (audit) refresh it.
const _scoreCache = new Map<string, { at: number; score: ContextScore }>();
const SCORE_CACHE_TTL_MS = 30_000;

export function ChatPanel({
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
  domainTab,
  setDomainTab,
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
      if (typeof text === "string" && text) { setInput(text); setDomainTab("chat"); }
    };
    window.addEventListener("prevail:compose-seed", onSeed as EventListener);
    return () => window.removeEventListener("prevail:compose-seed", onSeed as EventListener);
  }, []);
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
    setCtxScoreRescanning(true);
    setCtxScoreError(null);
    invoke<ContextScore>("engine_score", { vault: vaultPath, domain, audit: true })
      .then((s) => { setCtxScore(s); _scoreCache.set(`${vaultPath}:${domain}`, { at: Date.now(), score: s }); })
      .catch((e) => setCtxScoreError(String(e)))
      .finally(() => setCtxScoreRescanning(false));
  }, [domain, vaultPath]);
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
    return [...doms, ...apps].slice(0, 6);
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
  const conversationTokens = useMemo(() => messages.reduce((a, mm) => a + estimateTokens(mm.content), 0), [messages]);
  const attachedTokens = useMemo(() => primedContext.reduce((a, c) => a + estimateTokens(c.body), 0), [primedContext]);
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
    if (!activeThreadPath) { setMessages([]); setThreadTitle(""); return; }
    if (selfSetPathRef.current === activeThreadPath) {
      selfSetPathRef.current = null;
      return;
    }
    let cancelled = false;
    invoke<{ meta: ThreadMeta; turns: ThreadTurn[] }>("load_thread", { path: activeThreadPath })
      .then((t) => {
        if (cancelled) return;
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
  }, [activeThreadPath]);
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
      const u3 = await listen<{ session: string; stream?: string; data: ChatEvent | string }>(
        "engine-chat:line",
        (e) => {
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
              // Unknown event type - tolerate per the schema's forward-
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

  // Bubble action handlers - shared across both renderers (in-domain
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
        ? `${userPreamble}${profilePreamble}${omegaPreamble}${memoryPreamble}${attachPreamble}${primedPreamble}${skillsPreamble}You are mid-conversation. Below is the prior turn history; use it as context but do NOT repeat it back to the user.\n\n--- PRIOR TURNS ---\n${history}\n--- END PRIOR TURNS ---\n\nUser's next message: ${visible}`
        : `${userPreamble}${profilePreamble}${omegaPreamble}${memoryPreamble}${attachPreamble}${primedPreamble}${skillsPreamble}${visible}`
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
    // by soul.md / reads _state.md - VAULT-SPEC-v2 stages 3-4), so the engine
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
      // path once so a transient engine issue doesn't drop the turn - but only
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
      const all = await invoke<EngineApp[]>("engine_apps_list");
      const app = all.find((a) => a.id === id);
      if (!app) return;
      const body = [
        `# App: ${app.title}${app.account?.label ? ` (${app.account.label})` : ""}`,
        `Connector: ${app.integration} · status: ${app.status}`,
        app.domains.length
          ? `Feeds these domains (data lands in vault/<domain>/): ${app.domains.map(titleCase).join(", ")}`
          : "Not bound to any domain yet.",
        app.refresh?.every ? `Syncs every ${app.refresh.every}.` : "Manual sync only.",
        `Last synced ${relTime(app.lastSuccessTs)}.`,
      ].join("\n");
      injectContext(body, `app: ${app.title}`);
    } catch (err) { console.error("attach app", err); setAttachErr(`Couldn't attach app: ${err}`); }
  }, [injectContext]);
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
  useEffect(() => {
    const w = window as unknown as {
      __prevailAttach?: (n: string, mode?: "light" | "full" | "folder") => void;
      __prevailAttachApp?: (id: string) => void;
    };
    w.__prevailAttach = (n, mode) => void attachDomainRef.current(n, mode ?? "light");
    w.__prevailAttachApp = (id) => void attachAppRef.current(id);
    return () => {
      try { delete w.__prevailAttach; delete w.__prevailAttachApp; } catch {}
    };
  }, []);
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
            <h2 className="mt-6 font-display text-5xl font-bold tracking-tight">
              What should we work on?
            </h2>
            <p className="mt-3 max-w-none whitespace-nowrap text-center text-sm text-text-muted">
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
            {/* BENCH-1: scheduled-benchmark awareness on the landing. */}
            <HomeBenchScheduledBadge />

            <AgentPickerRail
              clis={available}
              selected={selectedCli}
              onSelect={(id) => setSelectedCli(id)}
            />

            {/* HOME-1: the Briefing - proactive digest (top recommendations +
                recent intents) made first-class on the landing surface. */}
            <HomeBriefing vaultPath={vaultPath} />


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
                vaultPath={vaultPath}
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
            {domainTab === "loops" && domainPath && (
              <LoopsPanel domain={domain || "general"} vaultPath={vaultPath} domainPath={domainPath} />
            )}
            {domainTab === "work" && (
              <BoardPanel vaultPath={vaultPath} initialDomain={domain || "general"} />
            )}
            {!domainCtx && domainTab !== "prefs" && domainTab !== "context" && domainTab !== "insights" && domainTab !== "usage" && domainTab !== "apps" && domainTab !== "loops" && <div className="text-sm text-text-muted">loading…</div>}
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
        {!domain && domainTab === "chat" && messages.length > 0 && (
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
            <span className="absolute -top-2.5 left-3 z-10 inline-flex items-center gap-1 rounded-full border border-accent bg-surface px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-accent shadow-sm">
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
                    ? <Layers className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted" />
                    : <Boxes className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted" />}
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
            <DomainStatusBar domain={domain} fwLens={fwLens} />
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
                    {clis.filter((c) => !isHarnessRuntime(c.id)).filter((c) => !isBunkerOn() || isLocalCli(c.id)).map((c) => {
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
