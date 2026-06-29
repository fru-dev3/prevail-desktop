// Work mode — the operational hub. The 2026 redesign pulls every operational
// surface OUT of the busy Settings/Editor page into Work mode:
//   • Board:       Work board, Insights, Spark
//   • Automations: Automations (the cross-domain LoopBoard), Calendar
//   • Notes:       brain-dump / searchable notes
// Editor keeps configuration. There is NO separate Work nav column — the nav
// (WORK_NAV) lives in the shared app sidebar; this panel renders just the
// active section, driven by "prevail:work-section" (and the jumpTo prop).
import { useEffect, useState } from "react";
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
  jumpTo,
}: {
  vaultPath: string;
  clis: CliInfo[];
  jumpTo?: { section: string; n: number } | null;
}) {
  const [section, setSection] = useState<WorkSection>(
    (jumpTo?.section && normalizeWorkSection(jumpTo.section)) || "tasks",
  );
  useEffect(() => {
    const norm = jumpTo?.section && normalizeWorkSection(jumpTo.section);
    if (norm) setSection(norm);
  }, [jumpTo?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  // The shared sidebar drives section changes via this event.
  useEffect(() => {
    const onSection = (e: Event) => {
      const norm = normalizeWorkSection((e as CustomEvent<string>).detail || "");
      if (norm) setSection(norm);
    };
    window.addEventListener("prevail:work-section", onSection as EventListener);
    return () => window.removeEventListener("prevail:work-section", onSection as EventListener);
  }, []);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="w-full px-8 py-10">
        {section === "tasks" && <BoardPanel vaultPath={vaultPath} />}
        {section === "recommendations" && <RecommendationsPanel vaultPath={vaultPath} />}
        {section === "spark" && <SparkPanel vaultPath={vaultPath} clis={clis} />}
        {section === "automations" && <LoopBoard vaultPath={vaultPath} />}
        {section === "calendar" && <CalendarView vaultPath={vaultPath} />}
        {section === "notes" && <NotesPanel vaultPath={vaultPath} />}
      </div>
    </div>
  );
}
