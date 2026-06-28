// Work mode — the operational hub. Phase 1 of the 2026 redesign pulled these
// surfaces (Work board, Insights, Spark) OUT of the busy Settings/Editor page
// and gave them their own home, mirroring Cursor's Work vs Editor split.
// Loops/Automations stay in Editor for now; they get promoted into a dedicated
// Automations dashboard in Phase 2.
import { useEffect, useState } from "react";
import { ArrowLeft, Briefcase, ChevronLeft, ChevronRight, Dices, Sparkles } from "lucide-react";
import { lsGet, lsSet } from "./storage";
import { PrevailLogo } from "./PrevailLogo";
import { BoardPanel } from "./boardpanel";
import { RecommendationsPanel } from "./recommendationspanel";
import { SparkPanel } from "./spark";
import type { CliInfo } from "./types";

// Section ids deliberately match the old Settings section names ("tasks",
// "recommendations", "spark") so existing deep-links (prevail:open-settings)
// can be re-routed here unchanged.
export type WorkSection = "tasks" | "recommendations" | "spark";
export const WORK_SECTIONS: WorkSection[] = ["tasks", "recommendations", "spark"];
export function isWorkSection(s: string): s is WorkSection {
  return (WORK_SECTIONS as string[]).includes(s);
}

export function WorkPanel({
  vaultPath,
  clis,
  onBack,
  jumpTo,
}: {
  vaultPath: string;
  clis: CliInfo[];
  onBack?: () => void;
  jumpTo?: { section: string; n: number } | null;
}) {
  const [section, setSection] = useState<WorkSection>(
    jumpTo?.section && isWorkSection(jumpTo.section) ? jumpTo.section : "tasks",
  );
  // Repeat jumps to the same section still fire (the nonce changes).
  useEffect(() => {
    if (jumpTo?.section && isWorkSection(jumpTo.section)) setSection(jumpTo.section);
  }, [jumpTo?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  const [navCollapsed, setNavCollapsed] = useState(() => lsGet("prevail.work.navCollapsed") === "1");
  const toggleNav = () => setNavCollapsed((v) => { const n = !v; lsSet("prevail.work.navCollapsed", n ? "1" : "0"); return n; });

  const nav: Array<{ id: WorkSection; label: string; icon: typeof Briefcase }> = [
    { id: "tasks", label: "Work", icon: Briefcase },
    { id: "recommendations", label: "Insights", icon: Sparkles },
    { id: "spark", label: "Spark", icon: Dices },
  ];

  return (
    <div className="flex min-h-0 flex-1">
      {/* Left rail — mirrors the Editor (Settings) shell so the two modes feel
          like siblings. */}
      <aside
        className="flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-r border-border-subtle bg-surface-warm transition-[width] duration-150"
        style={{ width: navCollapsed ? 56 : 224 }}
      >
        <div data-tauri-drag-region className={`shrink-0 border-b border-black/20 bg-gradient-to-br from-[#5fa4bd] via-[#558fa6] to-[#467a8f] pb-3 pt-3 ${navCollapsed ? "px-2" : "px-4"}`}>
          {navCollapsed ? (
            <div className="flex flex-col items-center gap-2">
              <span className="overflow-hidden rounded-lg ring-1 ring-white/40"><PrevailLogo size={26} animated={false} /></span>
              <button onClick={toggleNav} title="Expand work nav" className="flex h-7 w-7 items-center justify-center rounded-md bg-white/15 text-white transition-colors hover:bg-white/30">
                <ChevronRight className="h-[18px] w-[18px]" strokeWidth={2} />
              </button>
              {onBack && (
                <button onClick={onBack} title="Back to app" className="flex h-7 w-7 items-center justify-center rounded-md text-white/80 transition-colors hover:bg-white/20 hover:text-white">
                  <ArrowLeft className="h-4 w-4" />
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2.5">
                <span className="shrink-0 overflow-hidden rounded-lg ring-1 ring-white/40"><PrevailLogo size={26} animated={false} /></span>
                <span className="flex min-w-0 flex-1 items-center gap-2 font-display text-xl font-bold text-white [text-shadow:0_1px_4px_rgba(0,0,0,0.35)]">
                  <Briefcase className="h-5 w-5 shrink-0" /> Work
                </span>
                <button onClick={toggleNav} title="Collapse work nav" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/12 text-white transition-colors hover:bg-white/25">
                  <ChevronLeft className="h-[18px] w-[18px]" strokeWidth={2} />
                </button>
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
            </>
          )}
        </div>
        <div className={`min-h-0 flex-1 overflow-y-auto pb-3 pt-3 ${navCollapsed ? "px-1.5" : "px-2"}`}>
          {nav.map((it) => {
            const Icon = it.icon;
            const active = section === it.id;
            return (
              <button
                key={it.id}
                onClick={() => setSection(it.id)}
                aria-current={active ? "page" : undefined}
                title={navCollapsed ? it.label : undefined}
                className={`flex w-full items-center rounded-md py-1.5 text-left text-sm transition-colors ${navCollapsed ? "justify-center px-0" : "gap-3 px-3"} ${
                  active
                    ? "bg-accent font-semibold text-background shadow-sm"
                    : "text-text-secondary hover:bg-surface-strong hover:text-text-primary"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!navCollapsed && <span className="flex-1">{it.label}</span>}
              </button>
            );
          })}
        </div>
      </aside>

      {/* Main pane */}
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="w-full px-8 py-10">
          {section === "tasks" && <BoardPanel vaultPath={vaultPath} />}
          {section === "recommendations" && <RecommendationsPanel vaultPath={vaultPath} />}
          {section === "spark" && <SparkPanel vaultPath={vaultPath} clis={clis} />}
        </div>
      </div>
    </div>
  );
}
