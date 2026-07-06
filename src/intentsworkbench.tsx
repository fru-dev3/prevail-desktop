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

type Theme = { title?: string; goal?: string; domains?: string[]; prompt_ts?: number[] };

export function IntentsWorkbench({ vaultPath, intents, themes = [] }: { vaultPath: string; intents: IntentRow[]; themes?: Theme[] }) {
  // Zoom ladder, high -> low: tree (domain > theme > recurring > prompt) > recurring > all.
  const [view, setView] = useState<"tree" | "recurring" | "timeline">("tree");
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

  // ── The nested tree (highest zoom): Domain > Theme > Recurring cluster >
  // individual prompts. Domains and clusters are exact/deterministic; the theme
  // rung is a best-effort keyword match of each prompt to the LLM-distilled
  // themes for that domain (themes don't store prompt pointers), with an "Other
  // questions" bucket for the unmatched. Domains with no distilled theme skip
  // the theme rung and nest clusters directly.
  const STOP = new Set("the a an and or of to for in on with your you my me is are what how do i we can should would could about get make find set this that".split(" "));
  const tokenize = (t: string) => [...new Set(t.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w)))];
  const clusterRows = (rows: IntentRow[]) => {
    const m = new Map<string, { key: string; text: string; count: number; last: number; rows: IntentRow[]; sample: IntentRow }>();
    for (const r of rows) {
      const msg = String(r.message ?? "").trim(); if (!msg) continue;
      const k = normKey(msg);
      const e = m.get(k) ?? { key: k, text: msg, count: 0, last: 0, rows: [], sample: r };
      e.count++; e.rows.push(r); e.last = Math.max(e.last, r.ts ?? 0);
      if ((r.ts ?? 0) >= (e.sample.ts ?? 0)) e.sample = r;
      m.set(k, e);
    }
    return [...m.values()].sort((a, b) => b.count - a.count || b.last - a.last);
  };
  const tree = useMemo(() => {
    const byDomain = new Map<string, IntentRow[]>();
    for (const i of filtered) { const d = i.domain || "general"; (byDomain.get(d) ?? byDomain.set(d, []).get(d)!).push(i); }
    const out: { domain: string; total: number; last: number; flat: boolean; themes: { title: string; count: number; clusters: ReturnType<typeof clusterRows> }[] }[] = [];
    for (const [dom, rows] of byDomain) {
      const dThemes = themes.filter((t) => (t.domains ?? []).some((x) => x.toLowerCase() === dom.toLowerCase()) && t.title);
      const kw = dThemes.map((t) => new Set(tokenize(`${t.title ?? ""} ${t.goal ?? ""}`)));
      // Exact linkage: the distiller stamps prompt_ts (timestamps of the prompts
      // that fed each theme). A prompt whose ts is claimed lands in that theme
      // deterministically; only prompts NOT stamped fall back to keyword match
      // (old distilled docs with no prompt_ts, or newly-added prompts).
      const tsToTheme = new Map<number, string>();
      for (const t of dThemes) for (const ts of (t.prompt_ts ?? [])) if (t.title) tsToTheme.set(ts, t.title);
      const buckets = new Map<string, IntentRow[]>();
      for (const t of dThemes) buckets.set(t.title!, []);
      buckets.set("Other questions", []);
      for (const r of rows) {
        let key: string | null = (r.ts != null && tsToTheme.has(r.ts)) ? tsToTheme.get(r.ts)! : null;
        if (!key) {
          const toks = tokenize(String(r.message ?? ""));
          let best = -1, bestScore = 0;
          kw.forEach((set, i) => { const sc = toks.reduce((n, w) => n + (set.has(w) ? 1 : 0), 0); if (sc > bestScore) { bestScore = sc; best = i; } });
          key = best >= 0 && bestScore >= 1 ? dThemes[best]!.title! : "Other questions";
        }
        (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(r);
      }
      const themeNodes = [...buckets.entries()].filter(([, rs]) => rs.length).map(([title, rs]) => ({ title, count: rs.length, clusters: clusterRows(rs) })).sort((a, b) => b.count - a.count);
      const flat = dThemes.length === 0;
      out.push({ domain: dom, total: rows.length, last: Math.max(0, ...rows.map((r) => r.ts ?? 0)), flat, themes: themeNodes });
    }
    return out.sort((a, b) => b.total - a.total);
  }, [filtered, themes]);

  // Expand state (one Set of composite keys) + lazy per-domain ideal-state.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExp = (k: string) => setExpanded((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const [ideals, setIdeals] = useState<Record<string, string>>({});
  const openDomain = (dom: string, key: string) => {
    toggleExp(key);
    if (ideals[dom] === undefined) {
      invoke<string>("read_domain_ideal", { vault: vaultPath, domain: dom }).then((t) => setIdeals((m) => ({ ...m, [dom]: (t || "").trim() }))).catch(() => setIdeals((m) => ({ ...m, [dom]: "" })));
    }
  };
  const idealLine = (md: string) => { const l = (md || "").replace(/^#.*$/gm, "").split("\n").map((x) => x.trim()).filter(Boolean); return l[0]?.slice(0, 160) ?? ""; };

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
          <button onClick={() => setView("tree")} title="Nested: domain > theme > recurring > question" className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium ${view === "tree" ? "bg-accent text-background" : "bg-surface text-text-secondary hover:bg-surface-strong"}`}><Boxes className="h-3.5 w-3.5" /> Tree</button>
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

      {/* TREE (highest): Domain > Theme > Recurring cluster > prompts */}
      {view === "tree" && (
        tree.length === 0 ? <Empty text={intents.length ? "Nothing matches the current filters." : "No intents captured yet."} /> : (
          <div className="flex flex-col gap-2">
            <p className="text-[11px] text-text-muted">The full hierarchy: each domain rolls up its themes; each theme its recurring questions; each cluster its individual prompts. Expand to drill down. Themes nest their prompts exactly when the distiller has stamped them, else by best-effort match.</p>
            {tree.map((d) => {
              const dk = `d:${d.domain}`; const dOpen = expanded.has(dk);
              return (
                <div key={dk} className="overflow-hidden rounded-xl border border-border bg-surface">
                  <button onClick={() => openDomain(d.domain, dk)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-warm">
                    <ChevronRight className={`h-4 w-4 shrink-0 text-text-muted transition-transform ${dOpen ? "rotate-90" : ""}`} />
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent"><Boxes className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="font-display text-base font-semibold tracking-tight text-text-primary">{titleCase(d.domain)}</span>
                      <span className="ml-2 font-mono text-[11px] tabular-nums text-text-muted">{d.total} question{d.total === 1 ? "" : "s"} · {d.themes.length} {d.flat ? "group" : "theme"}{d.themes.length === 1 ? "" : "s"}</span>
                    </span>
                  </button>
                  {dOpen && (
                    <div className="border-t border-border-subtle px-3 py-2 pl-9">
                      {ideals[d.domain] && idealLine(ideals[d.domain]) && (
                        <div className="mb-2 rounded-md border border-accent-border/40 bg-accent-soft/20 px-2.5 py-1.5 text-[12px] text-text-secondary"><span className="font-mono text-[9px] uppercase tracking-wide text-accent">Aim</span> · {idealLine(ideals[d.domain])}</div>
                      )}
                      {d.themes.map((t) => {
                        const tk = `t:${d.domain}:${t.title}`; const tOpen = expanded.has(tk) || d.flat;
                        const body = (
                          <div className={d.flat ? "" : "border-t border-border-subtle/60 pl-6"}>
                            {t.clusters.map((c) => {
                              const ck = `c:${d.domain}:${t.title}:${c.key}`; const cOpen = expanded.has(ck);
                              const recur = c.count > 1;
                              return (
                                <div key={ck} className="border-b border-border-subtle/40 last:border-0">
                                  <div className="flex items-center gap-2 py-1.5">
                                    <button onClick={() => recur && toggleExp(ck)} className={`flex min-w-0 flex-1 items-center gap-2 text-left ${recur ? "hover:text-accent" : ""}`}>
                                      {recur ? <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-text-muted transition-transform ${cOpen ? "rotate-90" : ""}`} /> : <span className="w-3.5 shrink-0" />}
                                      {recur && <span className="shrink-0 rounded-full bg-accent-soft px-1.5 font-mono text-[10px] font-semibold tabular-nums text-accent">{c.count}×</span>}
                                      <span className="truncate text-[13px] text-text-primary">{c.text}</span>
                                    </button>
                                    <Actions row={c.sample} k={ck} />
                                  </div>
                                  {recur && cOpen && (
                                    <div className="pb-1.5 pl-6">
                                      {c.rows.map((r, ri) => (
                                        <div key={ri} className="flex items-center gap-2 py-0.5 font-mono text-[10px] text-text-muted">
                                          <span className="w-1 shrink-0 rounded-full">·</span>
                                          <span>{r.ts ? new Date(r.ts).toLocaleString("sv-SE") : ""}</span>
                                          <span className="text-ai">{surfLabel(r.surface)}</span>
                                          {r.host && <span>{r.host}</span>}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        );
                        if (d.flat) return <div key={tk}>{body}</div>;
                        return (
                          <div key={tk} className="mb-1 rounded-lg">
                            <button onClick={() => toggleExp(tk)} className="flex w-full items-center gap-2 py-1.5 text-left hover:text-accent">
                              <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-text-muted transition-transform ${tOpen ? "rotate-90" : ""}`} />
                              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-surface-warm text-text-muted"><Repeat2 className="h-3 w-3" /></span>
                              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text-primary">{t.title}</span>
                              <span className="shrink-0 font-mono text-[10px] tabular-nums text-text-muted">{t.count}</span>
                            </button>
                            {tOpen && body}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
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
