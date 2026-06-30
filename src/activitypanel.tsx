// System Activity (Settings -> Automation): one feed of everything Prevail does
// on its own. "Running now" is live (the in-memory process registry); the
// history below is the persistent ledger the engine appends to
// (_meta/activity.jsonl) - loop runs, executed approvals, tasks filed by loops,
// briefings, app syncs. Full transparency into the autonomous system, at scale.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, ChevronRight, ListPlus, Loader2, Mail, RefreshCw, RotateCw, Zap, Repeat, Bell, Workflow, CornerDownRight } from "lucide-react";
import { invoke } from "./bridge";
import { titleCase, relTime } from "./format";
import { useProcesses } from "./processes";
import { SettingsHeader } from "./sectionutil";

// These mirror the engine's activity-ledger producer types (cli activity.ts).
// Keep them in lockstep: any type the engine writes must be representable here,
// or the event falls through to the generic "other" label and can't be filtered.
type ActivityType = "loop_run" | "loop_exec" | "task_filed" | "briefing" | "sync" | "nudge" | "playbook" | "playbook_step" | "other";
interface ActivityEvent {
  ts: number;
  type: ActivityType;
  domain?: string;
  title: string;
  detail?: string;
  status?: "ok" | "error" | "pending";
  ref?: string;
  // The ledger (_meta/activity.jsonl) can carry richer per-event fields than the
  // typed core above: the loop/app/skill name behind the event, a summary,
  // outcome flags, error text, artifact lists/counts, and various ids. We don't
  // know them all ahead of time, so the drill-down reads whatever is present.
  [extra: string]: unknown;
}

// Core fields we render with friendly labels and in a deliberate order at the
// top of the drill-down. Anything else on the record is surfaced afterwards as
// "Additional detail" so no field is ever hidden from the user.
const KNOWN_FIELDS: { key: string; label: string }[] = [
  { key: "type", label: "Kind" },
  { key: "domain", label: "Domain" },
  { key: "title", label: "Title" },
  { key: "detail", label: "Detail" },
  { key: "status", label: "Outcome" },
  { key: "ref", label: "Reference" },
];

// Fields shown elsewhere in the row header / handled specially, so we skip them
// when listing the remaining "additional" record fields.
const SKIP_EXTRA = new Set(["ts", ...KNOWN_FIELDS.map((f) => f.key)]);

// Turn a snake_case / camelCase key into a readable label ("loop_name" ->
// "Loop name", "appId" -> "App id").
function fieldLabel(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  return spaced ? spaced[0].toUpperCase() + spaced.slice(1) : key;
}

// Present any value as a tidy string for the detail block. Objects/arrays are
// JSON-stringified so artifact lists and counts stay legible.
function fieldValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

// A small label / value row reused for every field in the drill-down.
function DetailRow({ label, value }: { label: string; value: string }) {
  const multiline = value.includes("\n");
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-2 py-1">
      <div className="font-mono text-[10px] uppercase tracking-wider text-text-muted">{label}</div>
      {multiline ? (
        <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-text-secondary">{value}</pre>
      ) : (
        <div className="break-words text-[12px] leading-relaxed text-text-secondary">{value}</div>
      )}
    </div>
  );
}

// The expanded panel for one activity: full timestamp plus every field the
// record carries, in a tidy key/value layout. Falls back to a friendly note
// when the record has nothing beyond what the row already showed.
function ActivityDetail({ event }: { event: ActivityEvent }) {
  const meta = TYPE_META[event.type] ?? TYPE_META.other;
  const when = new Date(event.ts);
  const whenStr = Number.isFinite(when.getTime()) ? when.toLocaleString() : String(event.ts);

  const knownRows = KNOWN_FIELDS
    .map((f) => ({ ...f, value: fieldValue(event[f.key]) }))
    .filter((f) => f.value !== "")
    .map((f) => ({
      label: f.label,
      value: f.key === "type" ? meta.label : f.key === "domain" ? titleCase(String(event.domain)) : f.value,
    }));

  const extraRows = Object.keys(event)
    .filter((k) => !SKIP_EXTRA.has(k))
    .map((k) => ({ label: fieldLabel(k), value: fieldValue(event[k]) }))
    .filter((r) => r.value !== "");

  // "When" always exists; if that is genuinely all we have, say so plainly.
  const hasMore = knownRows.length > 0 || extraRows.length > 0;

  return (
    <div className="mt-2 rounded-lg border border-border-subtle bg-surface px-3 py-2">
      <DetailRow label="When" value={whenStr} />
      {knownRows.map((r) => <DetailRow key={`k-${r.label}`} label={r.label} value={r.value} />)}
      {extraRows.length > 0 && (
        <>
          <div className="mt-2 mb-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-text-muted">Additional detail</div>
          {extraRows.map((r) => <DetailRow key={`x-${r.label}`} label={r.label} value={r.value} />)}
        </>
      )}
      {!hasMore && (
        <div className="mt-1 text-[12px] italic leading-relaxed text-text-muted">No further detail recorded for this event.</div>
      )}
    </div>
  );
}

const TYPE_META: Record<ActivityType, { label: string; icon: typeof Activity; tint: string }> = {
  loop_run:   { label: "Loop run",   icon: Repeat,   tint: "text-accent" },
  loop_exec:  { label: "Executed",   icon: Zap,      tint: "text-warn" },
  task_filed: { label: "Task filed", icon: ListPlus, tint: "text-ok" },
  briefing:   { label: "Briefing",   icon: Mail,     tint: "text-accent" },
  sync:       { label: "App sync",   icon: RotateCw, tint: "text-text-secondary" },
  nudge:      { label: "Nudge",      icon: Bell,     tint: "text-text-secondary" },
  playbook:      { label: "Playbook",      icon: Workflow,        tint: "text-accent" },
  playbook_step: { label: "Playbook step", icon: CornerDownRight, tint: "text-text-secondary" },
  other:      { label: "Event",      icon: Activity, tint: "text-text-muted" },
};

const FILTERS: { id: ActivityType | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "loop_run", label: "Loop runs" },
  { id: "loop_exec", label: "Executed" },
  { id: "task_filed", label: "Tasks" },
  { id: "briefing", label: "Briefings" },
  { id: "playbook", label: "Playbooks" },
  { id: "sync", label: "Syncs" },
];

// The Playbooks tab covers both the run-level "playbook" event and its
// per-step "playbook_step" children, so a single tab shows the whole run.
function matchesType(eventType: ActivityType, filter: ActivityType | "all"): boolean {
  if (filter === "all") return true;
  if (filter === "playbook") return eventType === "playbook" || eventType === "playbook_step";
  return eventType === filter;
}

export function SystemActivity({ vaultPath }: { vaultPath: string }) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<ActivityType | "all">("all");
  const [domainFilter, setDomainFilter] = useState<string>("all");
  // Which history row is drilled into (a stable id per row). Null = none open.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const live = useProcesses();

  const load = useCallback(async () => {
    try {
      const rows = await invoke<ActivityEvent[]>("activity_read", { vault: vaultPath, limit: 400 });
      setEvents(Array.isArray(rows) ? rows : []);
    } catch { setEvents([]); }
    finally { setLoading(false); }
  }, [vaultPath]);

  useEffect(() => {
    load();
    // Refresh when the system reports it did something, plus a slow poll so
    // background daemon activity shows up without a manual reload.
    const onChange = () => load();
    window.addEventListener("prevail:loops-advanced", onChange);
    window.addEventListener("prevail:tasks-changed", onChange);
    const iv = window.setInterval(load, 15000);
    return () => {
      window.removeEventListener("prevail:loops-advanced", onChange);
      window.removeEventListener("prevail:tasks-changed", onChange);
      window.clearInterval(iv);
    };
  }, [load]);

  const domains = useMemo(() => {
    const s = new Set<string>();
    for (const e of events) if (e.domain) s.add(e.domain);
    return [...s].sort();
  }, [events]);

  const shown = useMemo(() => events.filter((e) =>
    matchesType(e.type, typeFilter) &&
    (domainFilter === "all" || e.domain === domainFilter),
  ), [events, typeFilter, domainFilter]);

  return (
    <div className="w-full space-y-5">
      <SettingsHeader
        icon={Activity}
        title="Activity"
        subtitle="Everything Prevail does on its own, across every domain: loop runs, executed approvals, tasks filed, briefings, and app syncs. Full transparency into the autonomous system."
      />

      {/* Running now - the live, in-flight processes (not yet in history). */}
      <section>
        <div className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">Running now</div>
        {live.length === 0 ? (
          <div className="rounded-lg border border-border-subtle bg-surface px-3 py-2.5 text-xs text-text-muted">Nothing running right now.</div>
        ) : (
          <ul className="space-y-1.5">
            {live.map((p) => (
              <li key={p.id} className="flex items-center gap-2 rounded-lg border border-accent-border bg-accent-soft/20 px-3 py-2">
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />
                <span className="flex-1 truncate text-[13px] text-text-primary">{p.label}</span>
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-text-muted">{p.kind}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Filter toolbar: segmented type pills + domain select on the left, the
          event count and a minimal refresh control aligned to the right. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5">
          {FILTERS.map((f) => (
            <button key={f.id} onClick={() => setTypeFilter(f.id)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${typeFilter === f.id ? "bg-accent-soft text-accent shadow-sm" : "text-text-secondary hover:bg-surface-warm hover:text-text-primary"}`}>
              {f.label}
            </button>
          ))}
        </div>
        {domains.length > 0 && (
          <select value={domainFilter} onChange={(e) => setDomainFilter(e.target.value)}
            className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-text-secondary transition-colors hover:border-accent-border focus:border-accent-border focus:outline-none">
            <option value="all">All domains</option>
            {domains.map((d) => <option key={d} value={d}>{titleCase(d)}</option>)}
          </select>
        )}
        <div className="ml-auto flex items-center gap-2.5">
          <span className="font-mono text-[10px] tabular-nums text-text-muted">{shown.length} event{shown.length === 1 ? "" : "s"}</span>
          <button onClick={load} disabled={loading} title="Refresh" aria-label="Refresh"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-text-muted transition-colors hover:border-accent-border hover:text-accent disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* History feed */}
      <section>
        <div className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">History</div>
        {loading ? (
          <div className="text-sm text-text-muted">loading activity…</div>
        ) : shown.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-surface p-6 text-center text-sm text-text-secondary">
            No activity recorded yet. Loop runs, executed approvals, and briefings will appear here as they happen.
          </div>
        ) : (
          <ul className="space-y-0 border-l border-border-subtle pl-4">
            {shown.map((e, i) => {
              const m = TYPE_META[e.type] ?? TYPE_META.other;
              const Icon = m.icon;
              const id = `${e.ts}-${i}`;
              const open = expandedId === id;
              return (
                <li key={id} className="relative pb-3.5 last:pb-0">
                  <span className={`absolute -left-[21px] top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-surface ring-2 ring-surface ${e.status === "error" ? "text-err" : m.tint}`}>
                    <Icon className="h-3 w-3" />
                  </span>
                  <button type="button" aria-expanded={open}
                    onClick={() => setExpandedId(open ? null : id)}
                    className="group -mx-2 flex w-[calc(100%+1rem)] items-start gap-2 rounded-lg px-2 py-1 text-left transition-colors hover:bg-surface-warm">
                    <ChevronRight className={`mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted transition-transform group-hover:text-text-secondary ${open ? "rotate-90" : ""}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-text-muted">
                        <span className={m.tint}>{m.label}</span>
                        {e.domain && <span className="rounded bg-surface-warm px-1.5 py-0.5 text-text-secondary">{titleCase(e.domain)}</span>}
                        <span>{relTime(e.ts)}</span>
                        {e.status === "error" && <span className="text-err">failed</span>}
                        {e.status === "pending" && <span className="text-warn">needs setup</span>}
                      </div>
                      <div className="mt-0.5 text-[13px] leading-snug text-text-primary">{e.title}</div>
                      {e.detail && <div className="mt-0.5 text-[12px] leading-relaxed text-text-muted">{e.detail}</div>}
                    </div>
                  </button>
                  {open && <ActivityDetail event={e} />}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
