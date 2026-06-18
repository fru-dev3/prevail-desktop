// The Settings page shell, extracted from App.tsx. Owns the section router /
// left-nav and composes every Settings section from its own module.
import { useEffect, useState } from "react";
import { ArrowLeft, Check, Compass, Folder, Github, Globe, Inbox, Layers, Lightbulb, MessagesSquare, Plug, Scale, Settings as SettingsIcon, Shield, ShieldCheck, Sigma, Sparkles, Target, Wrench, Zap } from "lucide-react";
import { invoke } from "./bridge";
import { LS, lsGet } from "./storage";
import { useAppearance } from "./hooks";
import { SettingsHeader } from "./sectionutil";
import { BenchScheduleCard } from "./cards";
import { FrameworksSection, IngestionSection, RemoteSection, ShortcutsSection } from "./settings1";
import { DaemonsSection, IntentsSection, MemoryContextSection, SkillsSection } from "./settings2";
import { BoardPanel } from "./boardpanel";
import { DecisionInbox } from "./decisioninbox";
import { ConnectorsSection } from "./settings3";
import { AppsPanel } from "./appspanel";
import { RecommendationsPanel } from "./recommendationspanel";
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
  type Section = "general" | "models" | "benchmark" | "privacy" | "connectors" | "configuration" | "ideal-state" | "omega" | "memory" | "intents" | "tasks" | "decisions" | "daemons" | "safety" | "council" | "gateway" | "mcp" | "remote" | "workspace" | "vault" | "demo" | "appearance" | "frameworks" | "skills" | "shortcuts" | "about" | "recommendations";
  const [section, setSection] = useState<Section>(jumpTo?.section ? (jumpTo.section as Section) : "general");
  // Allow callers (e.g. the Demo ribbon's "Switch to Production" link) to jump
  // straight to a section. The nonce makes repeat jumps to the same section fire.
  useEffect(() => {
    if (jumpTo?.section) setSection(jumpTo.section as Section);
  }, [jumpTo?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  const [settingsDeepLink, setSettingsDeepLink] = useState<string | null>(null);
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
    { heading: "Intelligence", items: [
      { id: "models", label: "Runtimes", icon: Layers },
      { id: "council", label: "Council", icon: Scale },
      { id: "frameworks", label: "Frameworks", icon: Lightbulb },
      { id: "skills", label: "Skills", icon: Sparkles },
      { id: "benchmark", label: "Benchmark", icon: Target },
    ]},
    // M1 (Monday feedback): "Context & Memory", in the founder-specified order -
    // Ideals (what the user inputs) → Omega (distilled) → Intents (what the user
    // is doing) → Recommendations (things for the user) → Routines. The old
    // "Configuration" (memory-engine knobs) + cross-domain Tasks move to the App
    // group so nothing is orphaned.
    // B2-24: Ideals now contains Ideal State + Omega (combined). B2-20: "Memory
    // engine" deleted (its Memory & Context view folds into Routines). B2-17:
    // Recommendations moves to the new "Work" group.
    { heading: "Context & Memory", items: [
      { id: "ideal-state", label: "Ideals", icon: Compass },
      { id: "intents", label: "Intents", icon: Lightbulb },
      { id: "daemons", label: "Routines", icon: Zap },
    ]},
    // B2-17: "Work" — what you're doing: Tasks, Workspace, Recommendations.
    { heading: "Work", items: [
      { id: "tasks", label: "Board", icon: Check },
      { id: "decisions", label: "Decisions", icon: Inbox },
      { id: "workspace", label: "Workspace", icon: Folder },
      { id: "recommendations", label: "Insights", icon: Sparkles }, // renamed from "Recommendations"
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
    const poll = () => invoke<{ recommendations?: unknown[] }>("engine_recommendations", { vault: vaultPath })
      .then((r) => { if (alive) setRecCount(Array.isArray(r?.recommendations) ? r.recommendations.length : 0); })
      .catch(() => {});
    void poll();
    const id = window.setInterval(poll, 60000);
    return () => { alive = false; window.clearInterval(id); };
  }, [vaultPath]);

  // Decision Inbox count - a badge so pending approvals / AI-finished reviews are
  // visible without opening the inbox. Refreshed on a slow cadence + on events.
  const [decCount, setDecCount] = useState(0);
  useEffect(() => {
    let alive = true;
    const poll = () => invoke<unknown[]>("decisions_pending", { vault: vaultPath })
      .then((d) => { if (alive) setDecCount(Array.isArray(d) ? d.length : 0); })
      .catch(() => {});
    void poll();
    const id = window.setInterval(poll, 60000);
    const onEvt = () => poll();
    window.addEventListener("prevail:tasks-changed", onEvt);
    window.addEventListener("prevail:loops-advanced", onEvt);
    return () => { alive = false; window.clearInterval(id); window.removeEventListener("prevail:tasks-changed", onEvt); window.removeEventListener("prevail:loops-advanced", onEvt); };
  }, [vaultPath]);

  // MCP live indicator - read from localStorage; McpCard writes the same key.
  const [mcpLive, setMcpLive] = useState(() => lsGet(LS.mcpEnabled) === "1");
  useEffect(() => {
    const id = window.setInterval(() => setMcpLive(lsGet(LS.mcpEnabled) === "1"), 2000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="flex h-full">
      {/* Sidebar nav - Codex-style with Back to app at top */}
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
              const showRecCount = it.id === "recommendations" && recCount > 0;
              const showDecCount = it.id === "decisions" && decCount > 0;
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
                  {showDecCount && (
                    <span
                      className="inline-flex min-w-[16px] items-center justify-center rounded-full bg-accent px-1.5 py-0 font-mono text-[9px] font-bold text-background"
                      title={`${decCount} decision${decCount === 1 ? "" : "s"} need you`}
                    >
                      {decCount}
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
          {section === "decisions" && <DecisionInbox vaultPath={vaultPath} />}
          {section === "recommendations" && <RecommendationsPanel vaultPath={vaultPath} />}
          {/* B2-20 / image #29: Memory engine page deleted; Memory & Context now
              lives inside Routines as a peer collapsible group (in DaemonsSection),
              not a divider-separated section. */}
          {section === "daemons" && <DaemonsSection vaultPath={vaultPath} />}
          {section === "council" && <CouncilSettingsSection clis={clis} />}
          {section === "connectors" && (
            <>
              <AppsPanel vaultPath={vaultPath} />
              <div className="mt-8">
                {/* APP-1: Advanced is the CATALOG + tiers only - connected apps
                    are shown once, above, in AppsPanel (catalogOnly suppresses the
                    duplicate connected list inside ConnectorsSection). */}
                <CollapsibleSection icon={Wrench} title="Browse the catalog" summary="1000+ apps & connection tiers"
                  subtitle="Browse the full connector catalog to add an app, and configure the raw MCP / Composio / browser / CLI tiers by hand.">
                  <ConnectorsSection vaultPath={vaultPath} focusAppId={settingsDeepLink ?? undefined} catalogOnly />
                  <div className="mt-6 border-t border-border-subtle pt-6">
                    <IngestionSection />
                  </div>
                </CollapsibleSection>
              </div>
            </>
          )}
          {section === "safety" && <SafetySection vaultPath={vaultPath} />}
          {section === "gateway" && <><GatewaySection /><GatewayLogsCard vaultPath={vaultPath} /></>}
          {section === "mcp" && <McpSection vaultPath={vaultPath} />}
          {section === "remote" && <RemoteSection />}
          {/* IA-1: "workspace" is the umbrella; "vault"/"demo" remain as
              deep-link aliases (e.g. the demo ribbon's jump) → same section. */}
          {(section === "workspace" || section === "vault" || section === "demo") && (
            <WorkspaceSection vaultPath={vaultPath} onChange={onChangeVault} onSetupDomains={onSetupDomains} onVaultMoved={onVaultMoved} />
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
