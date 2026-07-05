// Intents workbench — turns the raw "what you asked" firehose into something
// you can actually USE: recurring-theme rollup (the automation signal), live
// grouping, composable filters, a pinned reuse library, and one-click reuse
// (re-run the prompt, copy it, or make a task from it). Deterministic + local;
// the LLM distiller above it stays the semantic layer.
import { useMemo, useState } from "react";
import { invoke } from "./bridge";
import { Pin, PinOff, Repeat2, Copy, Check, ListPlus, Search, Layers3, Clock, Boxes, ChevronRight } from "lucide-react";

export type IntentRow = {
  message?: string; prompt?: string; cli?: string; model?: string; model_id?: string;
  ts?: number; domain?: string; surface?: string; source?: string; host?: string;
};

const SURFACE_LABEL: Record<string, string> = {
  chat: "Prevail chat", "app-chat": "App chat", council: "Council", benchmark: "Arena",
  loop: "Loop", agent: "Agent", claude: "Claude Code", codex: "Codex", gemini: "Gemini", prevail: "Prevail",
};
const surfLabel = (s?: string) => (s ? SURFACE_LABEL[s.toLowerCase()] ?? s : "other");
const titleCase = (s: string) => s.replace(/(^|[\s-])\w/g, (m) => m.toUpperCase());

// Cluster key for "recurring": lowercase, collapse whitespace, drop trailing
// punctuation. Exact-normalized so we never falsely merge distinct questions.
function normKey(msg: string): string {
  return msg.toLowerCase().replace(/\s+/g, " ").replace(/[?.!,;:]+$/g, "").trim();
}

const RANGES = [
  { id: "7d", label: "7d", days: 7 }, { id: "30d", label: "30d", days: 30 },
  { id: "90d", label: "90d", days: 90 }, { id: "all", label: "All", days: null },
] as const;

const PIN_KEY = "prevail.intents.pinned";

export function IntentsWorkbench({ vaultPath, intents }: { vaultPath: string; intents: IntentRow[] }) {
  // Zoom ladder, high -> low: domains (aims) > recurring (themes) > timeline (all).
  const [view, setView] = useState<"domains" | "recurring" | "timeline">("domains");
  const [q, setQ] = useState("");
  const [domain, setDomain] = useState("all");
  const [surface, setSurface] = useState("all");
  const [range, setRange] = useState<string>("all");
  const [groupBy, setGroupBy] = useState<"none" | "domain" | "surface" | "day">("domain");
  const [pins, setPins] = useState<Set<string>>(() => { try { return new Set(JSON.parse(localStorage.getItem(PIN_KEY) || "[]")); } catch { return new Set(); } });
  const [copied, setCopied] = useState<string | null>(null);
  const [tasked, setTasked] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState(20);

  const savePins = (next: Set<string>) => { setPins(next); try { localStorage.setItem(PIN_KEY, JSON.stringify([...next])); } catch { /* ignore */ } };
  const togglePin = (k: string) => { const n = new Set(pins); n.has(k) ? n.delete(k) : n.add(k); savePins(n); };

  // Facet options from the data.
  const domains = useMemo(() => [...new Set(intents.map((i) => i.domain || "general"))].sort(), [intents]);
  const surfaces = useMemo(() => [...new Set(intents.map((i) => (i.surface || "other").toLowerCase()))].sort(), [intents]);

  // Composable filter.
  const filtered = useMemo(() => {
    const days = RANGES.find((r) => r.id === range)?.days ?? null;
    const cutoff = days ? Date.now() - days * 86400_000 : 0;
    const qq = q.trim().toLowerCase();
    return intents.filter((i) => {
      if ((i.ts ?? 0) < cutoff) return false;
      if (domain !== "all" && (i.domain || "general") !== domain) return false;
      if (surface !== "all" && (i.surface || "other").toLowerCase() !== surface) return false;
      if (qq && !String(i.message ?? "").toLowerCase().includes(qq)) return false;
      return true;
    });
  }, [intents, range, domain, surface, q]);

  // Recurring rollup: cluster by normalized message, keep repeats (count > 1),
  // ranked by frequency then recency. THIS is the automation signal.
  const recurring = useMemo(() => {
    const m = new Map<string, { key: string; text: string; count: number; last: number; domains: Set<string>; surfaces: Set<string>; sample: IntentRow }>();
    for (const i of filtered) {
      const msg = String(i.message ?? "").trim();
      if (!msg) continue;
      const k = normKey(msg);
      if (k.length < 4) continue;
      const e = m.get(k) ?? { key: k, text: msg, count: 0, last: 0, domains: new Set<string>(), surfaces: new Set<string>(), sample: i };
      e.count++; e.last = Math.max(e.last, i.ts ?? 0);
      e.domains.add(i.domain || "general"); e.surfaces.add((i.surface || "other").toLowerCase());
      if ((i.ts ?? 0) >= (e.sample.ts ?? 0)) e.sample = i;
      m.set(k, e);
    }
    return [...m.values()].filter((e) => e.count > 1).sort((a, b) => b.count - a.count || b.last - a.last);
  }, [filtered]);

  // Highest level: roll everything up to domains (aims). The fewest rows - one
  // per domain - with how many questions and recurring themes nest under it, so
  // you can zoom out past individual intents. Drill down to see them.
  const domainRollup = useMemo(() => {
    const m = new Map<string, { domain: string; total: number; last: number; clusters: Map<string, number>; surfaces: Set<string> }>();
    for (const i of filtered) {
      const d = i.domain || "general";
      const e = m.get(d) ?? { domain: d, total: 0, last: 0, clusters: new Map<string, number>(), surfaces: new Set<string>() };
      e.total++; e.last = Math.max(e.last, i.ts ?? 0); e.surfaces.add((i.surface || "other").toLowerCase());
      const msg = String(i.message ?? "").trim();
      if (msg) { const k = normKey(msg); e.clusters.set(k, (e.clusters.get(k) ?? 0) + 1); }
      m.set(d, e);
    }
    return [...m.values()].map((e) => ({
      domain: e.domain, total: e.total, last: e.last, surfaces: e.surfaces,
      recurringCount: [...e.clusters.values()].filter((c) => c > 1).length,
      top: [...e.clusters.entries()].filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]).slice(0, 3),
    })).sort((a, b) => b.total - a.total);
  }, [filtered]);

  const drillTo = (dom: string) => { setDomain(dom); setView("recurring"); };

  // Timeline groups.
  const groups = useMemo(() => {
    const key = (i: IntentRow) => groupBy === "domain" ? (i.domain || "general")
      : groupBy === "surface" ? surfLabel(i.surface)
      : groupBy === "day" ? new Date(i.ts ?? 0).toLocaleDateString("sv-SE")
      : "";
    const rows = [...filtered].sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
    if (groupBy === "none") return [{ head: "", items: rows }];
    const m = new Map<string, IntentRow[]>();
    for (const r of rows) { const k = key(r); (m.get(k) ?? m.set(k, []).get(k)!).push(r); }
    return [...m.entries()].sort((a, b) => (b[1][0]?.ts ?? 0) - (a[1][0]?.ts ?? 0)).map(([head, items]) => ({ head, items }));
  }, [filtered, groupBy]);

  // Pinned rows (resolve keys back to a representative row).
  const pinnedRows = useMemo(() => {
    const byKey = new Map<string, IntentRow>();
    for (const i of intents) { const k = normKey(String(i.message ?? "")); if (k && (!byKey.has(k) || (i.ts ?? 0) > (byKey.get(k)!.ts ?? 0))) byKey.set(k, i); }
    return [...pins].map((k) => byKey.get(k)).filter(Boolean) as IntentRow[];
  }, [intents, pins]);

  // Reuse: prefill the composer with the prompt and jump to chat (App handles nav).
  const reuse = (row: IntentRow) => {
    const seed = String(row.prompt || row.message || "").trim();
    if (!seed) return;
    try { localStorage.setItem("prevail.compose.pending", seed); } catch { /* ignore */ }
    if (row.domain) window.dispatchEvent(new CustomEvent("prevail:open-domain", { detail: row.domain }));
    window.dispatchEvent(new CustomEvent("prevail:compose-seed", { detail: seed }));
  };
  const copy = (row: IntentRow, k: string) => { void navigator.clipboard.writeText(String(row.message ?? "")); setCopied(k); setTimeout(() => setCopied((c) => (c === k ? null : c)), 1400); };
  const makeTask = async (row: IntentRow, k: string) => {
    try { await invoke("tasks_add", { vault: vaultPath, domain: row.domain || "general", text: String(row.message ?? "").slice(0, 200), source: "intent" }); setTasked((s) => new Set(s).add(k)); window.dispatchEvent(new CustomEvent("prevail:tasks-changed")); }
    catch (e) { console.error("tasks_add from intent", e); }
  };

  const activeFilters = (domain !== "all" ? 1 : 0) + (surface !== "all" ? 1 : 0) + (range !== "all" ? 1 : 0) + (q.trim() ? 1 : 0);

  // A compact reuse action bar shown on each row / card.
  const Actions = ({ row, k }: { row: IntentRow; k: string }) => (
    <div className="flex shrink-0 items-center gap-1">
      <IconBtn title="Reuse — prefill a new chat with this" onClick={() => reuse(row)}><Repeat2 className="h-3.5 w-3.5" /></IconBtn>
      <IconBtn title={copied === k ? "Copied" : "Copy the question"} onClick={() => copy(row, k)}>{copied === k ? <Check className="h-3.5 w-3.5 text-ok" /> : <Copy className="h-3.5 w-3.5" />}</IconBtn>
      <IconBtn title={tasked.has(k) ? "Added as task" : "Make a task from this"} onClick={() => makeTask(row, k)} active={tasked.has(k)}><ListPlus className="h-3.5 w-3.5" /></IconBtn>
      <IconBtn title={pins.has(normKey(String(row.message ?? ""))) ? "Unpin" : "Pin for reuse"} onClick={() => togglePin(normKey(String(row.message ?? "")))} active={pins.has(normKey(String(row.message ?? "")))}>
        {pins.has(normKey(String(row.message ?? ""))) ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
      </IconBtn>
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
          <input value={q} onChange={(e) => { setQ(e.target.value); setShown(20); }} placeholder="Search what you asked…"
            className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-border focus:outline-none" />
        </div>
        <select value={domain} onChange={(e) => setDomain(e.target.value)} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-text-secondary">
          <option value="all">All domains</option>{domains.map((d) => <option key={d} value={d}>{titleCase(d)}</option>)}
        </select>
        <select value={surface} onChange={(e) => setSurface(e.target.value)} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-text-secondary">
          <option value="all">All activities</option>{surfaces.map((s) => <option key={s} value={s}>{surfLabel(s)}</option>)}
        </select>
        <div className="inline-flex overflow-hidden rounded-lg border border-border">
          {RANGES.map((r) => <button key={r.id} onClick={() => setRange(r.id)} className={`px-2.5 py-1.5 text-xs ${range === r.id ? "bg-accent-soft text-accent" : "bg-surface text-text-secondary hover:bg-surface-strong"}`}>{r.label}</button>)}
        </div>
        {activeFilters > 0 && <button onClick={() => { setQ(""); setDomain("all"); setSurface("all"); setRange("all"); }} className="text-[11px] text-text-muted underline underline-offset-2 hover:text-accent">clear</button>}
      </div>

      {/* Pinned reuse library */}
      {pinnedRows.length > 0 && (
        <div className="rounded-xl border border-accent-border bg-accent-soft/30 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-accent"><Pin className="h-3.5 w-3.5" /> Pinned · your reuse library</div>
          <div className="flex flex-col gap-1.5">
            {pinnedRows.map((row) => { const k = `pin:${normKey(String(row.message ?? ""))}`; return (
              <div key={k} className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5">
                <button onClick={() => reuse(row)} className="min-w-0 flex-1 truncate text-left text-[13px] text-text-primary hover:text-accent" title="Reuse">{String(row.message ?? "")}</button>
                <Actions row={row} k={k} />
              </div>
            ); })}
          </div>
        </div>
      )}

      {/* Zoom ladder: highest (fewest, coarsest) -> lowest (every question). */}
      <div className="flex items-center gap-2">
        <span className="hidden font-mono text-[10px] uppercase tracking-wide text-text-muted sm:inline">zoom</span>
        <div className="inline-flex overflow-hidden rounded-lg border border-border">
          <button onClick={() => setView("domains")} title="Highest level: roll up to domains" className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium ${view === "domains" ? "bg-accent text-background" : "bg-surface text-text-secondary hover:bg-surface-strong"}`}><Boxes className="h-3.5 w-3.5" /> Domains</button>
          <button onClick={() => setView("recurring")} title="Mid level: recurring themes" className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium ${view === "recurring" ? "bg-accent text-background" : "bg-surface text-text-secondary hover:bg-surface-strong"}`}><Repeat2 className="h-3.5 w-3.5" /> Recurring</button>
          <button onClick={() => setView("timeline")} title="Lowest level: every question" className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium ${view === "timeline" ? "bg-accent text-background" : "bg-surface text-text-secondary hover:bg-surface-strong"}`}><Clock className="h-3.5 w-3.5" /> All</button>
        </div>
        {view === "timeline" && (
          <div className="ml-auto flex items-center gap-1.5 text-[11px] text-text-muted">
            <Layers3 className="h-3.5 w-3.5" /> group
            <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as typeof groupBy)} className="rounded-md border border-border bg-surface px-1.5 py-1 text-xs text-text-primary">
              <option value="none">none</option><option value="domain">domain</option><option value="surface">activity</option><option value="day">day</option>
            </select>
          </div>
        )}
      </div>

      {/* DOMAINS (highest) */}
      {view === "domains" && (
        domainRollup.length === 0 ? <Empty text={intents.length ? "Nothing matches the current filters." : "No intents captured yet."} /> : (
          <div className="flex flex-col gap-2">
            <p className="text-[11px] text-text-muted">Every question rolled up to its life domain - the highest level. Click a domain to zoom in on its recurring themes.</p>
            {domainRollup.map((d) => (
              <button key={d.domain} onClick={() => drillTo(d.domain)} className="group rounded-xl border border-border bg-surface p-3 text-left hover:border-accent-border">
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent"><Boxes className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="font-display text-base font-semibold tracking-tight text-text-primary">{titleCase(d.domain)}</span>
                      <span className="font-mono text-[11px] tabular-nums text-text-muted">{d.total} question{d.total === 1 ? "" : "s"}{d.recurringCount ? ` · ${d.recurringCount} recurring` : ""}</span>
                    </div>
                    {d.top.length > 0 && (
                      <div className="mt-1 truncate text-[12px] text-text-secondary">
                        {d.top.map(([k, c], i) => <span key={k}>{i > 0 ? " · " : ""}<span className="font-mono text-[10px] text-accent">{c}×</span> {k}</span>)}
                      </div>
                    )}
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-text-muted group-hover:text-accent" />
                </div>
              </button>
            ))}
          </div>
        )
      )}

      {/* RECURRING */}
      {view === "recurring" && (
        recurring.length === 0 ? (
          <Empty text={filtered.length ? "No repeated questions in this slice yet. When you ask something more than once, it shows here as an automation candidate." : "Nothing matches the current filters."} />
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-[11px] text-text-muted">Questions you've asked more than once — the strongest signal to reuse, pin, or turn into a routine.</p>
            {recurring.slice(0, shown).map((e) => { const k = `rec:${e.key}`; return (
              <div key={k} className="rounded-xl border border-border bg-surface p-3">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 shrink-0 rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-accent" title={`Asked ${e.count} times`}>{e.count}×</span>
                  <button onClick={() => reuse(e.sample)} className="min-w-0 flex-1 text-left text-[13px] leading-snug text-text-primary hover:text-accent" title="Reuse">{e.text}</button>
                  <Actions row={e.sample} k={k} />
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-9 font-mono text-[10px] text-text-muted">
                  {[...e.domains].slice(0, 3).map((d) => <span key={d} className="rounded bg-surface-warm px-1.5 py-0.5">{titleCase(d)}</span>)}
                  {[...e.surfaces].slice(0, 3).map((s) => <span key={s} className="rounded border border-ai/30 bg-ai/5 px-1.5 py-0.5 text-ai">{surfLabel(s)}</span>)}
                  <span className="ml-auto">last {e.last ? new Date(e.last).toLocaleDateString() : ""}</span>
                </div>
              </div>
            ); })}
            {recurring.length > shown && <LoadMore onClick={() => setShown((n) => n + 20)} n={Math.min(20, recurring.length - shown)} of={`${shown} of ${recurring.length}`} />}
          </div>
        )
      )}

      {/* TIMELINE */}
      {view === "timeline" && (
        filtered.length === 0 ? <Empty text={intents.length ? "Nothing matches the current filters." : "No intents captured yet. Every question you ask is logged here."} /> : (
          <div className="flex flex-col gap-3">
            {groups.map((g) => (
              <div key={g.head || "all"}>
                {g.head && <div className="mb-1.5 flex items-center gap-2 px-1"><span className="text-xs font-semibold text-text-primary">{groupBy === "domain" ? titleCase(g.head) : g.head}</span><span className="font-mono text-[10px] text-text-muted">{g.items.length}</span></div>}
                <div className="overflow-hidden rounded-xl border border-border">
                  {g.items.slice(0, view === "timeline" ? shown : g.items.length).map((it, i) => { const k = `${g.head}:${i}:${it.ts}`; const ext = !!it.surface && !["chat", "app-chat", "prevail"].includes((it.surface || "").toLowerCase());
                    return (
                    <div key={k} className="flex items-start gap-3 border-b border-border-subtle px-3 py-2 last:border-0 hover:bg-surface-warm">
                      <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] ${ext ? "border border-ai/30 bg-ai/5 text-ai" : "bg-surface-warm text-text-muted"}`}>{ext ? surfLabel(it.surface) : titleCase(it.domain || "general")}</span>
                      <div className="min-w-0 flex-1">
                        <div className="line-clamp-2 text-[13px] text-text-primary">{String(it.message ?? "(no text)")}</div>
                        <div className="mt-0.5 font-mono text-[10px] text-text-muted">{[it.model_id || it.model, it.ts ? new Date(it.ts).toLocaleString("sv-SE") : "", it.host].filter(Boolean).join(" · ")}</div>
                      </div>
                      <Actions row={it} k={k} />
                    </div>
                  ); })}
                </div>
              </div>
            ))}
            {groupBy === "none" && filtered.length > shown && <LoadMore onClick={() => setShown((n) => n + 20)} n={Math.min(20, filtered.length - shown)} of={`${shown} of ${filtered.length}`} />}
          </div>
        )
      )}
    </div>
  );
}

function IconBtn({ children, title, onClick, active }: { children: React.ReactNode; title: string; onClick: () => void; active?: boolean }) {
  return <button onClick={onClick} title={title} className={`rounded-md border p-1.5 ${active ? "border-accent-border bg-accent-soft text-accent" : "border-border text-text-muted hover:border-accent-border hover:text-accent"}`}>{children}</button>;
}
function Empty({ text }: { text: string }) { return <div className="rounded-xl border border-dashed border-border-subtle p-6 text-sm text-text-muted">{text}</div>; }
function LoadMore({ onClick, n, of }: { onClick: () => void; n: number; of: string }) { return <button onClick={onClick} className="rounded-lg border border-border-subtle py-2 text-center text-sm text-text-secondary hover:bg-surface-warm hover:text-accent">Load {n} more · {of}</button>; }
