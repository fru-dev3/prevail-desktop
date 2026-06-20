// The Settings page shell, extracted from App.tsx. Owns the section router /
// left-nav and composes every Settings section from its own module.
import { useEffect, useState } from "react";
import { Activity, ArrowLeft, Briefcase, Compass, Dices, Folder, Github, Globe, Layers, Lightbulb, MessagesSquare, Plug, Repeat, Scale, Settings as SettingsIcon, Shield, ShieldCheck, Sigma, Sparkles, Swords, Target, Wrench, Zap } from "lucide-react";
import { invoke } from "./bridge";
import { LS, lsGet } from "./storage";
import { useAppearance } from "./hooks";
import { SettingsHeader } from "./sectionutil";
import { PrevailLogo } from "./PrevailLogo";
import { BenchScheduleCard } from "./cards";
import { FrameworksSection, RemoteSection, ShortcutsSection } from "./settings1";
import { DaemonsSection, IntentsSection, MemoryContextSection, SkillsSection } from "./settings2";
import { BoardPanel } from "./boardpanel";
import { AppsPanel } from "./appspanel";
import { RecommendationsPanel } from "./recommendationspanel";
import { SystemActivity } from "./activitypanel";
import { LoopBoard } from "./loopboard";
import { SparkPanel } from "./spark";
import { OmegaSection } from "./omega";
import { CollapsibleSection } from "./collapsible";
import { GeneralSection, IdealStateSection, SafetySection } from "./settings4";
import { AboutSection, GatewayLogsCard, GatewaySection, McpSection } from "./settings5";
import { CouncilSettingsSection, PrivacyConnectivitySection } from "./settings6";
import { ModelsSection } from "./settings7";
import { AppearanceSection, WorkspaceSection } from "./settings8";
import { BenchmarkPanel } from "./benchpanel";
import type { CliInfo } from "./types";

export function SettingsPanel({
  appearance,
  vaultPath,
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
  type Section = "general" | "models" | "benchmark" | "privacy" | "connectors" | "configuration" | "ideal-state" | "omega" | "memory" | "intents" | "tasks" | "decisions" | "daemons" | "safety" | "council" | "gateway" | "mcp" | "remote" | "workspace" | "vault" | "demo" | "appearance" | "frameworks" | "skills" | "shortcuts" | "about" | "recommendations" | "activity" | "loopboard" | "spark";
  const [section, setSection] = useState<Section>(jumpTo?.section ? (jumpTo.section as Section) : "general");
  // Allow callers (e.g. the Demo ribbon's "Switch to Production" link) to jump
  // straight to a section. The nonce makes repeat jumps to the same section fire.
  useEffect(() => {
    if (jumpTo?.section) setSection(jumpTo.section as Section);
  }, [jumpTo?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  // Value is consumed by sections via the deep-link event; only the setter is
  // read here, so the state value itself is intentionally left unbound.
  const [, setSettingsDeepLink] = useState<string | null>(null);
  // In-settings deep links (e.g. a model row's "runs" button jumping to the
  // Benchmark cockpit) dispatch this event rather than threading props.
  // Format: "section" or "section:detail" - detail is passed to the section.
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

  // Grouped settings nav - the flat 19-item list was hard to scan and mixed
  // unrelated concerns (e.g. General vs Defaults overlap). Organized into
  // labeled sections so related settings sit together and the redundancy reads
  // as intentional structure.
  type NavItem = { id: Section; label: string; icon: typeof Folder };
  // Grouped by function, not feature soup: how the AI thinks (Intelligence),
  // how it runs itself (Memory & Automation), what it reaches (Connections),
  // the guardrails (Privacy & Safety), where data lives (Vault), and the app.
  const navGroups: Array<{ heading: string; items: NavItem[] }> = [
    // Work is the first thing you see: bring your work up when you open the app.
    // The pipeline reads top to bottom - Board (committed tasks, you + AI), Insights
    // (AI proposals you add to the board), Workspace (files). Decisions is NOT a
    // separate page: it folds into the Board as a "Needs you" view + the top-bar pill.
    { heading: "Work", items: [
      { id: "tasks", label: "Work", icon: Briefcase },
      { id: "loopboard", label: "Loops", icon: Repeat },
      { id: "recommendations", label: "Insights", icon: Sparkles },
      { id: "spark", label: "Spark", icon: Dices },
      { id: "workspace", label: "Workspace", icon: Folder },
    ]},
    // What shapes the work: Ideals (you author) -> Intents (your goals, distilled)
    // -> Routines (standing loops that drive toward them).
    { heading: "Context & Memory", items: [
      { id: "ideal-state", label: "Ideals", icon: Compass },
      { id: "intents", label: "Intents", icon: Lightbulb },
      { id: "daemons", label: "Daemons", icon: Zap },
      { id: "activity", label: "Activity", icon: Activity },
    ]},
    { heading: "Intelligence", items: [
      { id: "models", label: "Runtimes", icon: Layers },
      { id: "council", label: "Council", icon: Scale },
      { id: "frameworks", label: "Frameworks", icon: Lightbulb },
      { id: "skills", label: "Skills", icon: Sparkles },
      { id: "benchmark", label: "Arena", icon: Swords },
    ]},
    { heading: "Connections", items: [
      { id: "connectors", label: "Apps", icon: Plug },
      { id: "gateway", label: "Gateway", icon: MessagesSquare },
      { id: "mcp", label: "MCP", icon: Wrench },
      // A5 (Monday feedback): the WebUI/localhost toggle was orphaned (no nav
      // entry). Surface it under Connections where it's expected.
      { id: "remote", label: "WebUI", icon: Globe },
    ]},
    { heading: "Privacy & Safety", items: [
      { id: "privacy", label: "Privacy", icon: ShieldCheck },
      { id: "safety", label: "Safety", icon: Shield },
    ]},
    { heading: "App", items: [
      { id: "general", label: "General", icon: SettingsIcon },
      { id: "about", label: "About", icon: Github },
    ]},
  ];

  // Live-bridge counter - used to light up the Gateway row in the nav
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

  // Proactive recommendation count - a badge so the user notices suggestions
  // without digging into the section. Refreshed on a slow cadence.
  const [recCount, setRecCount] = useState(0);
  useEffect(() => {
    let alive = true;
    // The badge counts only ACTIVE recommendations: total minus the ones the user
    // dismissed (dismissal is client-side in localStorage, so the engine still
    // returns them). Recompute on the recs-changed event so "Dismiss all" updates
    // the badge immediately, not just on the next poll.
    const poll = () => invoke<{ recommendations?: { id?: string }[] }>("engine_recommendations", { vault: vaultPath })
      .then((r) => {
        if (!alive) return;
        const recs = Array.isArray(r?.recommendations) ? r.recommendations : [];
        let dismissed = new Set<string>();
        try { dismissed = new Set(JSON.parse(localStorage.getItem("prevail.recs.dismissed") || "[]")); } catch { /* ignore */ }
        setRecCount(recs.filter((x) => !x.id || !dismissed.has(x.id)).length);
      })
      .catch(() => {});
    void poll();
    const id = window.setInterval(poll, 60000);
    const onChanged = () => poll();
    window.addEventListener("prevail:recs-changed", onChanged);
    return () => { alive = false; window.clearInterval(id); window.removeEventListener("prevail:recs-changed", onChanged); };
  }, [vaultPath]);

  // MCP live indicator - read from localStorage; McpCard writes the same key.
  const [mcpLive, setMcpLive] = useState(() => lsGet(LS.mcpEnabled) === "1");
  useEffect(() => {
    const id = window.setInterval(() => setMcpLive(lsGet(LS.mcpEnabled) === "1"), 2000);
    return () => window.clearInterval(id);
  }, []);

  return (
    // min-h-0 + flex-1 so the panel fills the space ABOVE the app footer ribbon
    // instead of taking the full screen height and pushing the ribbon off-screen.
    <div className="flex min-h-0 flex-1">
      {/* Sidebar nav - Codex-style with Back to app at top */}
      <aside className="flex h-full min-h-0 w-56 shrink-0 flex-col overflow-hidden border-r border-border-subtle bg-surface-warm">
        {/* Branded banner - mirrors the home sidebar header (dark, logo + serif
            wordmark), with the Back button underneath. pt-9 clears the macOS
            traffic-light controls so nothing is hidden under them. Draggable. */}
        {/* Inverted BACKGROUND vs the home header (dark): a prominent bluish
            banner so it's unmistakable you're in Settings, not on home. */}
        <div data-tauri-drag-region className="shrink-0 border-b border-black/20 bg-gradient-to-br from-[#5fa4bd] via-[#558fa6] to-[#467a8f] px-4 pb-3 pt-3">
          <div className="flex items-center gap-2.5">
            <span className="shrink-0 overflow-hidden rounded-lg ring-1 ring-white/40"><PrevailLogo size={26} animated={false} /></span>
            {/* White letters on the bluish banner, with "AI" in black so it pops. */}
            <span className="flex min-w-0 flex-1 items-center justify-between font-display text-2xl font-bold text-white [text-shadow:0_1px_4px_rgba(0,0,0,0.35)]" aria-label="Prevail">
              <span>P</span><span>R</span><span>E</span><span>V</span>
              <span className="text-black [text-shadow:none]">A</span><span className="text-black [text-shadow:none]">I</span>
              <span>L</span>
            </span>
          </div>
          {onBack && (
            <button
              onClick={onBack}
              className="mt-2 inline-flex items-center gap-1 px-1 text-xs font-medium text-white/70 transition-colors hover:text-white"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to app
            </button>
          )}
        </div>
        {/* Only the nav list scrolls; the branded banner above stays pinned. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 pt-3">
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
              const showRecCount = it.id === "recommendations" && recCount > 0;
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
                  {showRecCount && (
                    <span
                      className="inline-flex min-w-[16px] items-center justify-center rounded-full bg-accent px-1.5 py-0 font-mono text-[9px] font-bold text-background"
                      title={`${recCount} recommendation${recCount === 1 ? "" : "s"}`}
                    >
                      {recCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
        </div>
      </aside>

      {/* Main pane */}
      <div className="min-w-0 flex-1 overflow-y-auto">
        {/* Full width - settings use the whole pane, left-aligned, to match
            the rest of the app. Long prose inside sections caps itself
            (subtitles use max-w-2xl) so readability stays intact. */}
        <div className="w-full px-8 py-10">
          {section === "general" && <GeneralSection appearance={appearance} />}
          {section === "privacy" && <PrivacyConnectivitySection enabled={bunkerEnabled} onChange={onBunkerChange} />}
          {section === "models" && <ModelsSection clis={clis} onStartChatWith={onStartChatWith} onActivated={onRefreshClis} vaultPath={vaultPath} />}
          {section === "benchmark" && (
            <>
              <SettingsHeader
                title="Benchmark"
                icon={Target}
                subtitle="Your personal eval suite. Run any model against your own questions across every domain, see who leads where, and manage the question set: write, AI-draft from your data, import, export."
              />
              <div className="-mx-4 min-h-[60vh]">
                <BenchmarkPanel vaultPath={vaultPath} />
              </div>
              {/* K1 (Monday feedback): scheduled runs live at the BOTTOM, not the top. */}
              <div className="mt-8 border-t border-border-subtle pt-6">
                <BenchScheduleCard vault={vaultPath} />
              </div>
            </>
          )}
          {/* B2-24 / image #28: Ideals = page header + two big collapsible sections
              (Constitution, Omega). Big-header collapsibles so each reads above the
              sub-headers inside; Constitution open by default. */}
          {section === "ideal-state" && (
            <>
              <SettingsHeader
                title="Ideals"
                icon={Compass}
                subtitle="The vision and values everything optimizes for. Every chat, council, insight, plan, and routine reads these first and aligns to them."
              />
              <CollapsibleSection
                large
                icon={Compass}
                title="Constitution"
                subtitle="Your operating vision and principles — highest precedence everywhere."
                defaultOpen
                storageKey="prevail.settings.ideals.constitution"
              >
                <IdealStateSection vaultPath={vaultPath} headerless />
              </CollapsibleSection>
              <CollapsibleSection
                large
                icon={Sigma}
                title="Omega"
                subtitle="Cross-system shared context that travels with you."
                storageKey="prevail.settings.ideals.omega"
              >
                <OmegaSection vaultPath={vaultPath} headerless />
              </CollapsibleSection>
            </>
          )}
          {/* "omega" kept as a deep-link target (no nav item) — folded into Ideals. */}
          {section === "omega" && <OmegaSection vaultPath={vaultPath} />}
          {section === "memory" && <MemoryContextSection vaultPath={vaultPath} />}
          {section === "intents" && <IntentsSection vaultPath={vaultPath} />}
          {section === "tasks" && <BoardPanel vaultPath={vaultPath} />}
          {section === "recommendations" && <RecommendationsPanel vaultPath={vaultPath} />}
          {section === "spark" && <SparkPanel vaultPath={vaultPath} clis={clis} />}
          {/* B2-20 / image #29: Memory engine page deleted; Memory & Context now
              lives inside Routines as a peer collapsible group (in DaemonsSection),
              not a divider-separated section. */}
          {section === "daemons" && <DaemonsSection vaultPath={vaultPath} />}
          {section === "activity" && <SystemActivity vaultPath={vaultPath} />}
          {section === "loopboard" && <LoopBoard vaultPath={vaultPath} />}
          {section === "council" && <CouncilSettingsSection clis={clis} />}
          {section === "connectors" && <AppsPanel vaultPath={vaultPath} />}
          {section === "safety" && <SafetySection vaultPath={vaultPath} />}
          {section === "gateway" && <><GatewaySection /><GatewayLogsCard vaultPath={vaultPath} /></>}
          {section === "mcp" && <McpSection vaultPath={vaultPath} />}
          {section === "remote" && <RemoteSection />}
          {/* IA-1: "workspace" is the umbrella; "vault"/"demo" remain as
              deep-link aliases (e.g. the demo ribbon's jump) → same section. */}
          {(section === "workspace" || section === "vault" || section === "demo") && (
            <WorkspaceSection vaultPath={vaultPath} onSetupDomains={onSetupDomains} onVaultMoved={onVaultMoved} />
          )}
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
