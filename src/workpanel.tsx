// Work mode — the operational hub. The 2026 redesign pulls every operational
// surface OUT of the busy Settings/Editor page into one place (mirroring
// Cursor's Work vs Editor split):
//   • Board:       Work board, Insights, Spark            (Phase 1)
//   • Automations: Automations (the cross-domain LoopBoard), Calendar (Phase 2)
//   • Notes:       brain-dump / searchable notes          (Phase 3)
// Editor keeps configuration (models, connections, settings).
import { useEffect, useState } from "react";
import { ArrowLeft, Briefcase, CalendarDays, ChevronLeft, ChevronRight, Dices, FileText, Repeat, Sparkles } from "lucide-react";
import { lsGet, lsSet } from "./storage";
import { PrevailLogo } from "./PrevailLogo";
import { BoardPanel } from "./boardpanel";
import { RecommendationsPanel } from "./recommendationspanel";
import { SparkPanel } from "./spark";
import { LoopBoard } from "./loopboard";
import { CalendarView } from "./calendarview";
import { NotesPanel } from "./notespanel";
import type { CliInfo } from "./types";

export type WorkSection = "tasks" | "recommendations" | "spark" | "automations" | "calendar" | "notes";
export const WORK_SECTIONS: WorkSection[] = ["tasks", "recommendations", "spark", "automations", "calendar", "notes"];
// Old Settings section names that now live in Work mode (deep-link compatibility):
// "loopboard" was the LoopBoard's id under Settings; it is now "automations".
const SECTION_ALIASES: Record<string, WorkSection> = { loopboard: "automations" };
export function normalizeWorkSection(s: string): WorkSection | null {
  if ((WORK_SECTIONS as string[]).includes(s)) return s as WorkSection;
  return SECTION_ALIASES[s] ?? null;
}
export function isWorkSection(s: string): boolean {
  return normalizeWorkSection(s) !== null;
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
    (jumpTo?.section && normalizeWorkSection(jumpTo.section)) || "tasks",
  );
  useEffect(() => {
    const norm = jumpTo?.section && normalizeWorkSection(jumpTo.section);
    if (norm) setSection(norm);
  }, [jumpTo?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  const [navCollapsed, setNavCollapsed] = useState(() => lsGet("prevail.work.navCollapsed") === "1");
  const toggleNav = () => setNavCollapsed((v) => { const n = !v; lsSet("prevail.work.navCollapsed", n ? "1" : "0"); return n; });

  const navGroups: Array<{ heading: string; items: Array<{ id: WorkSection; label: string; icon: typeof Briefcase }> }> = [
    { heading: "Board", items: [
      { id: "tasks", label: "Work board", icon: Briefcase },
      { id: "recommendations", label: "Insights", icon: Sparkles },
      { id: "spark", label: "Spark", icon: Dices },
    ]},
    { heading: "Automations", items: [
      { id: "automations", label: "Automations", icon: Repeat },
      { id: "calendar", label: "Calendar", icon: CalendarDays },
    ]},
    { heading: "Notes", items: [
      { id: "notes", label: "Notes", icon: FileText },
    ]},
  ];

  return (
    <div className="flex min-h-0 flex-1">
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
          {navGroups.map((group) => (
            <div key={group.heading} className="mb-1.5">
              {!navCollapsed && (
                <div className="mb-0.5 mt-2 px-3 font-mono text-[9px] uppercase tracking-[0.18em] text-text-muted/70">{group.heading}</div>
              )}
              {group.items.map((it) => {
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
          ))}
        </div>
      </aside>

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="w-full px-8 py-10">
          {section === "tasks" && <BoardPanel vaultPath={vaultPath} />}
          {section === "recommendations" && <RecommendationsPanel vaultPath={vaultPath} />}
          {section === "spark" && <SparkPanel vaultPath={vaultPath} clis={clis} />}
          {section === "automations" && <LoopBoard vaultPath={vaultPath} />}
          {section === "calendar" && <CalendarView vaultPath={vaultPath} />}
          {section === "notes" && <NotesPanel vaultPath={vaultPath} />}
        </div>
      </div>
    </div>
  );
}
