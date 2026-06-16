// The Benchmark UI cluster extracted from App.tsx: BenchmarkPanel (the page) and
// its BenchRunConfig / BenchResults / BenchMatrix / BenchQuestions children. The
// run registry + executor live in ./bench; this is the presentation layer.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { confirm as tauriConfirm, open, save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import { Activity, AlertTriangle, Archive, Check, ChevronRight, Circle, Crown, Download, FileText, Layers, Loader2, MessagesSquare, Plus, RotateCw, Scale, ShieldCheck, Sparkles, Target, Trash2, TrendingUp, Upload, X } from "lucide-react";
import { invoke, listen } from "./bridge";
import { MODELS, MODEL_SEP } from "./constants";
import { scoreColor, titleCase } from "./format";
import { isLocalCli } from "./helpers";
import { modelLabel, parseRunLabel } from "./helpers2";
import { isBunkerOn, lsGet, lsSet } from "./storage";
import { Sparkline } from "./ui";
import { BenchCrumbs, Field, ScoreBar, SubsectionHeader } from "./panels";
import { domainIcon } from "./icons";
import { CollapsibleSection } from "./collapsible";
import { BENCH_CLI_OPTIONS, benchBatches, benchNotify, cancelBenchBatch, executeBenchBatch, useBenchBatches } from "./bench";
import { ProviderMark } from "./marks";
import type { BenchBatch, BenchJob, BenchJobStatus, BenchQuestion, BenchmarkRun, Domain, MatrixRow, RunDetail } from "./types";
import type { UnlistenFn } from "./bridge";

export function BenchMatrix({
  matrix, allDomains, onPick,
}: {
  matrix: MatrixRow[];
  allDomains: string[];
  onPick: (runDir: string) => void;
}) {
  const bestPerDomain = useMemo(() => {
    const best: Record<string, number> = {};
    for (const d of allDomains) {
      let b = -1;
      for (const m of matrix) {
        const v = m.per_domain[d]?.judge_avg;
        if (v != null && v > b) b = v;
      }
      best[d] = b;
    }
    return best;
  }, [matrix, allDomains]);

  const rows = useMemo(
    () => [...matrix].sort((a, b) => (b.judge_avg ?? -1) - (a.judge_avg ?? -1)),
    [matrix],
  );

  if (allDomains.length === 0) return <div className="text-sm text-text-muted">No domain data yet.</div>;

  return (
    <div className="overflow-x-auto rounded-2xl border border-border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-surface">
            <th className="sticky left-0 bg-surface px-3 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-text-muted">Model</th>
            {allDomains.map((d) => (
              <th key={d} className="px-3 py-2 text-center font-mono text-[10px] uppercase tracking-wider text-text-muted">{titleCase(d)}</th>
            ))}
            <th className="px-3 py-2 text-center font-mono text-[10px] uppercase tracking-wider text-accent">Overall</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => {
            const parsed = parseRunLabel(m.label);
            return (
              <tr key={m.run_dir} className="border-b border-border-subtle last:border-0 hover:bg-surface-warm">
                <td className="sticky left-0 bg-background px-3 py-2">
                  <button onClick={() => onPick(m.run_dir)} className="inline-flex items-center gap-1.5 hover:text-accent">
                    <ProviderMark vendor={parsed.vendor} size={16} />
                    <span className="font-mono text-xs text-text-primary">{parsed.model || m.label}</span>
                  </button>
                </td>
                {allDomains.map((d) => {
                  const cell = m.per_domain[d];
                  const v = cell?.judge_avg ?? null;
                  const isBest = v != null && v === bestPerDomain[d] && v >= 0;
                  return (
                    <td key={d} className="px-3 py-2 text-center font-mono text-xs">
                      {v == null ? (
                        <span className="text-text-muted/40">-</span>
                      ) : (
                        <span
                          className={isBest ? "rounded px-1.5 py-0.5 font-semibold" : ""}
                          style={isBest ? { background: "var(--color-ok, #2e9e5b)", color: "#fff" } : { color: scoreColor(v * 10) }}
                        >
                          {v.toFixed(1)}
                        </span>
                      )}
                    </td>
                  );
                })}
                <td className="px-3 py-2 text-center font-mono text-xs font-semibold text-accent">{m.judge_avg?.toFixed(1) ?? "-"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function BenchQuestions({
  vaultPath, questions, allDomains, initialDomain, onChanged,
}: {
  vaultPath: string;
  questions: BenchQuestion[];
  allDomains: string[];
  initialDomain?: string | null;
  onChanged: () => void;
}) {
  // Domain-scoped panel: show that domain's questions, not the whole suite.
  const [filter, setFilter] = useState<string>(initialDomain ? initialDomain.toLowerCase() : "all");
  const [editing, setEditing] = useState<BenchQuestion | "new" | null>(null);
  const blank: BenchQuestion = { id: "", domain: "", prompt: "", context: "", notes: "", council: false, expected_decision: "", expected_verdict_keywords: [], path: "" };
  const [draft, setDraft] = useState<BenchQuestion>(blank);
  const [saving, setSaving] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestDomain, setSuggestDomain] = useState<string>(initialDomain?.toLowerCase() ?? "");
  const [suggestCount, setSuggestCount] = useState(3);
  const [suggestModel, setSuggestModel] = useState(() => {
    if (!isBunkerOn()) return `claude${MODEL_SEP}opus`;
    // Bunker Mode: default to the first local provider's first model.
    const [cli, models] = Object.entries(MODELS).find(([c, ms]) => isLocalCli(c) && ms.length > 0) ?? [];
    return cli && models ? `${cli}${MODEL_SEP}${models[0].id}` : `claude${MODEL_SEP}opus`;
  });

  const inFilter = filter === "all" ? questions : questions.filter((q) => q.domain === filter);
  const shown = inFilter.filter((q) => !q.archived);
  const archivedShown = inFilter.filter((q) => q.archived);
  async function setArchived(q: BenchQuestion, archived: boolean) {
    try {
      await invoke("benchmark_set_question_archived", { path: q.path, archived });
      onChanged();
    } catch (e) { setInfo(`Archive failed: ${e}`); }
  }

  // Export the whole suite as one portable prevail.bench/v1 JSON file.
  async function exportQuestions() {
    try {
      const dest = await saveFileDialog({
        defaultPath: "prevail-bench-questions.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!dest) return;
      await invoke("benchmark_export_questions", { vault: vaultPath, dest });
      setInfo(`Exported ${questions.length} question${questions.length === 1 ? "" : "s"} to ${dest.split("/").pop()}`);
    } catch (e) {
      setInfo(`Export failed: ${e}`);
    }
  }

  // Import a prevail.bench/v1 file; existing ids are skipped, never overwritten.
  async function importQuestions() {
    try {
      const picked = await open({ filters: [{ name: "JSON", extensions: ["json"] }], multiple: false });
      const path = typeof picked === "string" ? picked : null;
      if (!path) return;
      const json = await invoke<string>("read_file", { path });
      const report = await invoke<{ created: string[]; skipped: string[] }>("benchmark_import_questions", { vault: vaultPath, json });
      setInfo(`Imported ${report.created.length} question${report.created.length === 1 ? "" : "s"}${report.skipped.length ? `, skipped ${report.skipped.length} (already exist or malformed)` : ""}`);
      onChanged();
    } catch (e) {
      setInfo(`Import failed: ${e}`);
    }
  }

  // AI-draft questions from each domain's own context, via the engine's
  // `bench suggest`. Drafts land in the list for review/editing.
  // Generate `count` draft questions for ONE domain. Resolves to the exit code
  // plus the net new question count for that domain (so "all domains" can verify
  // every domain actually got drafts, not just an overall total).
  async function suggestForDomain(target: string, cli: string, model: string): Promise<{ code: number | null; added: number; tail: string }> {
    const before = questions.filter((q) => q.domain === target).length;
    const session = `bench-suggest-${target}-${Date.now()}`;
    let output = "";
    let chunkUn: UnlistenFn | null = null;
    listen<{ session: string; data: string }>("benchmark:chunk", (e) => {
      if (e.payload.session === session) output = (output + e.payload.data).slice(-2000);
    }).then((u) => { chunkUn = u; });
    const done = new Promise<number | null>((resolve) => {
      let un: UnlistenFn | null = null;
      listen<{ session: string; code: number | null; phase: string }>("benchmark:done", (e) => {
        if (e.payload.session === session && e.payload.phase === "suggest") { un?.(); resolve(e.payload.code); }
      }).then((u) => { un = u; });
    });
    await invoke("benchmark_suggest", {
      args: { session_id: session, vault: vaultPath, domain: target, count: suggestCount, cli, model: model || null },
    });
    const code = await done;
    (chunkUn as UnlistenFn | null)?.();
    let added = 0;
    try {
      const fresh = await invoke<BenchQuestion[]>("benchmark_questions", { vault: vaultPath });
      added = (fresh ?? []).filter((q) => q.domain === target).length - before;
    } catch { /* counting is best-effort; exit code still drives success */ }
    return { code, added, tail: output.trim().split("\n").filter(Boolean).slice(-2).join(" / ") };
  }

  async function suggestWithAi() {
    const domain = suggestDomain.trim().toLowerCase();
    if (!domain) return;
    const [cli, model] = suggestModel.split(MODEL_SEP);
    setSuggesting(true);
    setInfo(null);
    try {
      // "all domains" must hit EVERY domain with its own request for `count`,
      // not a single call that the engine spreads thin — that left some domains
      // empty. Loop per domain (the path that works for a single domain) and
      // verify each one actually received drafts.
      const targets = domain === "all" ? allDomains.map((d) => d.toLowerCase()) : [domain];
      const short: string[] = [];
      const failed: string[] = [];
      for (const t of targets) {
        const { code, added } = await suggestForDomain(t, cli, model);
        if (!(code === 0 || code === null)) failed.push(t);
        else if (added < suggestCount) short.push(`${titleCase(t)} (${Math.max(0, added)}/${suggestCount})`);
      }
      onChanged();
      if (failed.length === 0 && short.length === 0) {
        setInfo(
          domain === "all"
            ? `Drafted ${suggestCount} question${suggestCount === 1 ? "" : "s"} for each of ${targets.length} domains. Review the ground truth before trusting scores.`
            : `Drafted ${suggestCount} question${suggestCount === 1 ? "" : "s"} for ${titleCase(domain)}. Review the ground truth before trusting scores.`,
        );
        setSuggestOpen(false);
      } else {
        const parts = [
          failed.length ? `failed: ${failed.map(titleCase).join(", ")}` : "",
          short.length ? `under target: ${short.join(", ")}` : "",
        ].filter(Boolean).join(" · ");
        setInfo(`Drafted across ${targets.length - failed.length}/${targets.length} domains — ${parts}. Re-run to fill the gaps.`);
      }
    } catch (e) {
      setInfo(`Suggest failed: ${e}`);
    } finally {
      setSuggesting(false);
    }
  }

  const openEditor = (q: BenchQuestion | "new") => {
    setEditing(q);
    setDraft(q === "new" ? blank : { ...q });
  };

  async function save() {
    // K4 (Monday feedback): a NEW question can target multiple domains at once
    // (comma-separated, no dropdown/checkboxes) — saved once per domain. Editing
    // an existing question keeps a single domain.
    const domains = draft.domain.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
    if (domains.length === 0 || !draft.prompt.trim()) return;
    const targets = editing === "new" ? domains : [domains[0]];
    setSaving(true);
    try {
      for (const dom of targets) {
        await invoke("benchmark_save_question", {
          vault: vaultPath,
          q: {
            id: editing === "new" ? null : (draft.id || null),
            domain: dom,
            prompt: draft.prompt,
            context: draft.context,
            notes: draft.notes,
            council: draft.council,
            expected_decision: draft.expected_decision,
            expected_verdict_keywords: draft.expected_verdict_keywords,
          },
        });
      }
      setEditing(null);
      onChanged();
    } finally {
      setSaving(false);
    }
  }
  async function remove(q: BenchQuestion) {
    const ok = await tauriConfirm(`Delete benchmark question "${q.id}"?`, { title: "Delete question", kind: "warning" });
    if (!ok) return;
    await invoke("benchmark_delete_question", { path: q.path });
    if (editing !== "new" && editing && editing.id === q.id) setEditing(null);
    onChanged();
  }

  if (editing) {
    return (
      <div className="w-full px-8 py-5">
        <BenchCrumbs
          items={[
            { label: "Benchmark" },
            { label: "Questions", onClick: () => setEditing(null) },
            { label: editing === "new" ? "New question" : draft.id },
          ]}
        />
        <div className="max-w-3xl space-y-4">
        <h2 className="font-display text-xl font-bold tracking-tight">{editing === "new" ? "New question" : draft.id}</h2>
        <Field label={editing === "new" ? "Domain(s): comma-separated to add to several at once" : "Domain"}>
          <input value={draft.domain} onChange={(e) => setDraft({ ...draft, domain: e.target.value })} list="bench-domains" placeholder={editing === "new" ? "wealth, health, career" : "wealth"} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
          <datalist id="bench-domains">{allDomains.map((d) => <option key={d} value={d} />)}</datalist>
        </Field>
        <Field label="Prompt: the question as you'd ask it">
          <textarea value={draft.prompt} onChange={(e) => setDraft({ ...draft, prompt: e.target.value })} rows={3} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
        </Field>
        <Field label="Context: facts the model needs (numbers, dates)">
          <textarea value={draft.context} onChange={(e) => setDraft({ ...draft, context: e.target.value })} rows={3} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
        </Field>
        <Field label="Expected decision: your real ground-truth answer">
          <input value={draft.expected_decision} onChange={(e) => setDraft({ ...draft, expected_decision: e.target.value })} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
        </Field>
        <Field label="Expected keywords: comma-separated, for the mechanical floor">
          <input
            value={draft.expected_verdict_keywords.join(", ")}
            onChange={(e) => setDraft({ ...draft, expected_verdict_keywords: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
            placeholder="liquidity, 6 month floor, diversify"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Notes: what you actually decided, and why">
          <textarea value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} rows={2} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
        </Field>
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          <input type="checkbox" checked={draft.council} onChange={(e) => setDraft({ ...draft, council: e.target.checked })} />
          Run via council (multi-model panel) by default
        </label>
        <div className="flex items-center gap-2 pt-2">
          <button onClick={save} disabled={saving || !draft.domain.trim() || !draft.prompt.trim()} className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-background hover:bg-accent-hover disabled:opacity-40">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save
          </button>
          {editing !== "new" && (
            <button onClick={() => remove(draft)} className="inline-flex items-center gap-1.5 rounded-lg border border-danger/40 px-3 py-2 text-sm text-danger hover:bg-danger/10">
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          )}
        </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full px-8 py-5">
      <BenchCrumbs
        items={[
          { label: "Benchmark" },
          { label: "Questions" },
          ...(filter !== "all" ? [{ label: titleCase(filter) }] : []),
        ]}
        meta={`${shown.length} of ${questions.length} question${questions.length === 1 ? "" : "s"}`}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] text-text-secondary">
          <option value="all">all domains</option>
          {allDomains.map((d) => <option key={d} value={d}>{titleCase(d)}</option>)}
        </select>
        <div className="flex-1" />
        <button onClick={importQuestions} title="Import a prevail.bench/v1 JSON file (existing ids are skipped)" className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 font-mono text-[11px] text-text-secondary hover:border-accent-border hover:text-accent">
          <Download className="h-3 w-3" /> Import
        </button>
        <button onClick={exportQuestions} disabled={questions.length === 0} title="Export every question as one portable JSON file" className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 font-mono text-[11px] text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-40">
          <Upload className="h-3 w-3" /> Export
        </button>
        <button onClick={() => { setSuggestOpen((v) => !v); if (!suggestDomain && filter !== "all") setSuggestDomain(filter); }} title="AI-draft questions from a domain's recorded context" className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[11px] ${suggestOpen ? "border-accent-border bg-accent-soft text-accent" : "border-border text-text-secondary hover:border-accent-border hover:text-accent"}`}>
          <Sparkles className="h-3 w-3" /> Suggest with AI
        </button>
        <button onClick={() => openEditor("new")} className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 font-mono text-[11px] text-background hover:bg-accent-hover">
          <Plus className="h-3 w-3" /> New question
        </button>
      </div>
      {suggestOpen && (
        <div className="mb-4 rounded-xl border border-accent-border bg-accent-soft/25 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent" />
            <span className="text-sm font-semibold text-text-primary">Draft questions with AI</span>
          </div>
          {/* Labeled controls, not a cramped row of bare selects. */}
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[9px] uppercase tracking-wider text-text-muted">Domain</span>
              <select value={suggestDomain} onChange={(e) => setSuggestDomain(e.target.value)} className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-text-secondary focus:border-accent-border focus:outline-none">
                <option value="">pick a domain…</option>
                <option value="all">All domains</option>
                {allDomains.map((d) => <option key={d} value={d}>{titleCase(d)}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[9px] uppercase tracking-wider text-text-muted">How many{suggestDomain === "all" ? " per domain" : ""}</span>
              <select value={suggestCount} onChange={(e) => setSuggestCount(Number(e.target.value))} className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-text-secondary focus:border-accent-border focus:outline-none">
                {[1, 2, 3, 5, 8].map((n) => <option key={n} value={n}>{n} question{n === 1 ? "" : "s"}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[9px] uppercase tracking-wider text-text-muted">Drafting model</span>
              <select value={suggestModel} onChange={(e) => setSuggestModel(e.target.value)} className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-text-secondary focus:border-accent-border focus:outline-none">
                {Object.entries(MODELS)
                  .filter(([cli]) => !isBunkerOn() || isLocalCli(cli))
                  .flatMap(([cli, models]) =>
                    models.map((m) => (
                      <option key={`${cli}${MODEL_SEP}${m.id}`} value={`${cli}${MODEL_SEP}${m.id}`}>{titleCase(cli)} · {m.label}</option>
                    )),
                  )}
              </select>
            </label>
            <button onClick={suggestWithAi} disabled={suggesting || !suggestDomain} className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-1.5 text-sm font-semibold text-background hover:bg-accent-hover disabled:opacity-40">
              {suggesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {suggesting ? "Drafting…" : "Draft"}
            </button>
          </div>
          <p className="mt-3 text-xs text-text-muted">
            Reads each domain's state, goals, and decisions (fresh domains use goals/config). Every domain you target gets the full count; drafts are marked for your review before they affect scores.
          </p>
        </div>
      )}
      {info && (
        <div className="mb-4 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-xs text-text-secondary">{info}</div>
      )}
      {shown.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-sm text-text-muted">
          No questions{filter !== "all" ? ` in ${titleCase(filter)}` : ""} yet. Hit <span className="text-accent">New question</span>, <span className="text-accent">Suggest with AI</span>, or <span className="text-accent">Import</span> to add some.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border">
          {shown.map((q) => (
            <div key={q.id} className="flex w-full items-start gap-3 border-b border-border-subtle px-4 py-3 text-left last:border-0 hover:bg-surface-warm">
              <button onClick={() => openEditor(q)} className="flex min-w-0 flex-1 items-start gap-3 text-left">
                <span className="mt-0.5 rounded bg-surface-warm px-1.5 py-0.5 font-mono text-[10px] text-text-muted">{q.domain}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-text-primary">{q.prompt || <span className="text-text-muted">(empty prompt)</span>}</div>
                  {q.expected_decision && <div className="mt-0.5 truncate text-[11px] text-ok">→ {q.expected_decision}</div>}
                  <div className="mt-0.5 font-mono text-[9px] text-text-muted">
                    {q.source === "ai" ? "AI-suggested" : "written by you"}{q.created ? ` · added ${q.created}` : ""}{q.edited ? ` · edited ${q.edited} (prior version kept)` : ""}
                  </div>
                </div>
                {/* K3 (Monday feedback): tooltip on the per-question icon. */}
                {q.council && <span title="Council question: asked to the whole panel" className="mt-0.5 shrink-0"><Scale className="h-3.5 w-3.5 text-text-muted" /></span>}
              </button>
              <button
                onClick={() => void setArchived(q, true)}
                title="Archive: kept for past runs, excluded from new ones"
                className="mt-0.5 shrink-0 rounded-md border border-border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent"
              >
                <Archive className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      {archivedShown.length > 0 && (
        <details className="mt-3 rounded-xl border border-border-subtle bg-surface px-3 py-2">
          <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
            Archived · {archivedShown.length}: kept so past benchmark runs stay interpretable
          </summary>
          <div className="mt-2 flex flex-col">
            {archivedShown.map((q) => (
              <div key={q.id} className="flex items-start gap-3 border-b border-border-subtle px-1 py-2 last:border-0">
                <span className="mt-0.5 rounded bg-surface-warm px-1.5 py-0.5 font-mono text-[10px] text-text-muted">{q.domain}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-text-muted">{q.prompt}</div>
                  <div className="mt-0.5 font-mono text-[9px] text-text-muted">
                    {q.source === "ai" ? "AI-suggested" : "written by you"}{q.created ? ` · added ${q.created}` : ""}
                  </div>
                </div>
                <button
                  onClick={() => void setArchived(q, false)}
                  className="shrink-0 rounded-md border border-border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent"
                >
                  Restore
                </button>
                <button
                  onClick={async () => { try { await invoke("benchmark_delete_question", { path: q.path }); onChanged(); } catch (e) { setInfo(`Delete failed: ${e}`); } }}
                  title="Delete permanently (past runs lose this question's text)"
                  className="shrink-0 rounded-md border border-border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted hover:border-warn hover:text-warn"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────
// SETTINGS PANEL — vault, theme, defaults, about

export function BenchRunConfig({
  mode, setMode, selModels, toggleModel, allDomains, scope, toggleScope,
  questionCounts, questionCount, running, jobs, log, logRef, activeBatch, onRun, onViewResults, onReset, onCancel, onCrumbHome,
}: {
  mode: "single" | "council";
  setMode: (m: "single" | "council") => void;
  selModels: Set<string>;
  toggleModel: (cli: string, model: string) => void;
  allDomains: string[];
  scope: Set<string>;
  toggleScope: (d: string) => void;
  questionCounts: Record<string, number>;
  questionCount: number;
  running: boolean;
  jobs: BenchJob[];
  log: string;
  logRef: React.RefObject<HTMLPreElement | null>;
  activeBatch?: { label: string; scope: string; domains: string[] } | null;
  onRun: () => void;
  onViewResults: () => void;
  onCancel?: () => void;
  onReset: () => void;
  onCrumbHome?: () => void;
}) {
  const selCount = mode === "council" ? 1 : selModels.size;
  void setMode; // mode toggle now lives in the header bar; prop kept for the call site
  // Collapsible provider groups — ALL collapsed by default so the page never
  // opens as a wall of models. Each provider row still shows its selected
  // count, so what's on the panel stays visible while collapsed.
  const [collapsedProviders, setCollapsedProviders] = useState<Set<string>>(() =>
    new Set(BENCH_CLI_OPTIONS.map((c) => c.id)),
  );
  const toggleProvider = (id: string) =>
    setCollapsedProviders((cur) => {
      const next = new Set(cur);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // Which job card is expanded to its question-by-question detail.
  const [expandedJob, setExpandedJob] = useState<string | null>(null);

  // While a benchmark is in flight (or just finished with errors), the page
  // IS the progress: the config disappears and each model gets a live
  // question-by-question progress bar. No clutter, no guessing.
  if (running || jobs.length > 0) {
    const allDone = !running;
    const doneCount = jobs.filter((j) => j.status === "done").length;
    const errCount = jobs.filter((j) => j.status === "error").length;
    return (
      <div className="w-full space-y-4 px-8 py-5">
        <BenchCrumbs
          items={[
            { label: "Benchmark", onClick: onCrumbHome },
            { label: "Run", onClick: allDone ? onReset : undefined },
            { label: activeBatch?.label ?? (running ? "Running…" : "Finished") },
          ]}
          meta={`${jobs.length} model${jobs.length === 1 ? "" : "s"} · ${jobs[0]?.total ?? 0} questions each`}
        />
        <div className="text-center">
          <div className="font-display text-xl font-semibold tracking-tight">
            {running ? "Benchmarking…" : jobs.some((j) => j.status === "cancelled") ? "Run cancelled" : errCount > 0 ? "Finished with errors" : "Benchmark complete"}
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-1">
            {(activeBatch?.domains?.length ? activeBatch.domains : ["All domains"]).slice(0, 10).map((d) => (
              <span key={d} className="rounded-full border border-accent-border bg-accent-soft px-2 py-0.5 font-mono text-[10px] text-accent">{d}</span>
            ))}
            {(activeBatch?.domains?.length ?? 0) > 10 && (
              <span className="font-mono text-[10px] text-text-muted">+{(activeBatch?.domains?.length ?? 0) - 10} more</span>
            )}
          </div>
          <div className="mt-1.5 font-mono text-[11px] text-text-muted">
            {jobs.length} model{jobs.length === 1 ? "" : "s"} · {jobs[0]?.total ?? 0} question{(jobs[0]?.total ?? 0) === 1 ? "" : "s"} each · running in parallel · auto-scored
          </div>
          {/* Overall batch progress — every question across every model. */}
          {(() => {
            const overallTotal = jobs.reduce((a, j) => a + j.total, 0);
            const overallDone = jobs.reduce((a, j) => a + (j.status === "done" || j.status === "scoring" ? j.total : j.done), 0);
            const pct = overallTotal > 0 ? Math.round((overallDone / overallTotal) * 100) : 0;
            return (
              <div className="mx-auto mt-4 max-w-xl">
                <div className="mb-1 flex items-baseline justify-between font-mono text-[11px]">
                  <span className="text-text-muted">overall</span>
                  <span className="tabular-nums text-text-primary">{overallDone}/{overallTotal} · <span className="font-semibold text-accent">{pct}%</span></span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-surface-warm">
                  <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })()}
          {running && onCancel && (
            <button
              onClick={onCancel}
              className="mx-auto mt-3 inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1 font-mono text-[11px] text-text-secondary hover:border-danger hover:text-danger"
            >
              ✗ Cancel run
            </button>
          )}
        </div>
        <div className="space-y-2">
          {jobs.map((j) => {
            const pct = j.total > 0 ? Math.round((j.done / j.total) * 100) : 0;
            const expanded = expandedJob === j.key;
            return (
              <div key={j.key} className="overflow-hidden rounded-xl border border-border bg-surface">
                <button
                  onClick={() => setExpandedJob(expanded ? null : j.key)}
                  className="w-full px-4 py-3 text-left hover:bg-surface-warm/60"
                  title="Click for question-by-question detail"
                >
                  <div className="flex items-center gap-3">
                    <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-text-muted transition-transform ${expanded ? "rotate-90" : ""}`} />
                    {j.cli ? <ProviderMark vendor={j.cli} size={20} /> : <Scale className="h-5 w-5 text-accent" />}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">{j.label}</span>
                    {j.status === "running" && j.qcur && (
                      <span className="hidden min-w-0 max-w-[220px] truncate font-mono text-[10px] text-text-muted md:inline">{j.qcur}…</span>
                    )}
                    <span className="font-mono text-[11px] tabular-nums text-text-muted">
                      {j.status === "queued" ? "queued" : `${j.done}/${j.total}`}
                    </span>
                    <span className={`w-16 text-right font-mono text-[10px] uppercase tracking-wider ${
                      j.status === "error" ? "text-danger" : j.status === "cancelled" ? "text-text-muted" : j.status === "done" ? "text-ok" : "text-accent"
                    }`}>
                      {j.status === "error" ? "error" : j.status === "cancelled" ? "cancelled" : j.status === "done" ? "done" : j.status === "scoring" ? "scoring" : j.status === "running" ? `${pct}%` : "queued"}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-warm">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        j.status === "error" ? "bg-danger/60" : j.status === "cancelled" ? "bg-surface-strong" : j.status === "scoring" || j.status === "done" ? "bg-ok" : "bg-accent"
                      } ${j.status === "scoring" ? "animate-pulse" : ""}`}
                      style={{ width: `${j.status === "done" || j.status === "scoring" ? 100 : pct}%` }}
                    />
                  </div>
                  {j.note && <div className="mt-1.5 font-mono text-[10px] text-danger">{j.note}</div>}
                </button>
                {expanded && j.qids.length > 0 && (
                  <div className="max-h-64 overflow-y-auto border-t border-border-subtle bg-background/40 px-4 py-2">
                    {j.qids.map((q) => {
                      const info = j.qdone[q];
                      const isCur = !info && j.qcur === q;
                      const failed = info?.startsWith("✗");
                      return (
                        <div key={q} className="flex items-center gap-2.5 py-1">
                          <span className="w-4 shrink-0 text-center">
                            {info ? (
                              failed
                                ? <AlertTriangle className="h-3 w-3 text-danger" />
                                : <Check className="h-3 w-3 text-ok" strokeWidth={3} />
                            ) : isCur ? (
                              <Loader2 className="h-3 w-3 animate-spin text-accent" />
                            ) : (
                              <Circle className="h-2.5 w-2.5 text-text-muted/40" />
                            )}
                          </span>
                          <span className={`min-w-0 flex-1 truncate font-mono text-[11px] ${info ? "text-text-primary" : isCur ? "text-accent" : "text-text-muted/60"}`}>
                            {q}
                          </span>
                          {info && !failed && <span className="max-w-[200px] truncate font-mono text-[9px] text-text-muted">{info}</span>}
                          {failed && <span className="max-w-[260px] truncate font-mono text-[9px] text-danger" title={info}>{info}</span>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {allDone && (
          <div className="flex items-center justify-center gap-2 pt-1">
            <button onClick={onViewResults} className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-background hover:bg-accent-hover">
              <TrendingUp className="h-4 w-4" /> View results
            </button>
            <button onClick={onReset} className="rounded-lg border border-border px-4 py-2 text-sm text-text-secondary hover:bg-surface-warm">
              New run
            </button>
          </div>
        )}
        {allDone && doneCount > 0 && errCount > 0 && (
          <p className="text-center font-mono text-[10px] text-text-muted">Failed jobs can be rerun individually from a new run.</p>
        )}
        {log && (
          <details className="rounded-lg border border-border-subtle bg-surface px-3 py-2">
            <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-wider text-text-muted">engine log</summary>
            <pre ref={logRef} className="mt-2 max-h-48 overflow-y-auto font-mono text-[10px] leading-relaxed text-text-muted">{log}</pre>
          </details>
        )}
      </div>
    );
  }

  return (
    <div className="w-full space-y-7 px-8 py-5">
      <BenchCrumbs
        items={[{ label: "Benchmark", onClick: onCrumbHome }, { label: "Run" }]}
        meta={`${questionCount} question${questionCount === 1 ? "" : "s"}${scope.size > 0 ? " · scoped" : ""}`}
      />
      {/* Mode lives in the header bar now (one consistent control row). */}

      {/* Models (multi-select) — hidden in council mode. Compact grid so the
          whole panel of a provider scans in two or three rows instead of a
          full-width row per model. */}
      {mode === "single" && (
        <section>
          <SubsectionHeader icon={Layers} hint={`${selModels.size} selected · runs head-to-head`}>
            Models
          </SubsectionHeader>
          {isBunkerOn() && (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-border bg-surface-warm/60 px-3 py-2">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-accent" />
              <span className="font-mono text-[11px] text-text-secondary">Bunker Mode is on: only local models (Ollama, LM Studio, oMLX) can run.</span>
            </div>
          )}
          <div className="space-y-3">
            {BENCH_CLI_OPTIONS.map((c) => {
              const models = MODELS[c.id] ?? [];
              const selectedHere = models.filter((m) => selModels.has(`${c.id}${MODEL_SEP}${m.id}`)).length;
              const collapsed = collapsedProviders.has(c.id);
              const bunkerBlocked = isBunkerOn() && !isLocalCli(c.id);
              return (
                <div key={c.id}>
                  <button
                    onClick={() => toggleProvider(c.id)}
                    className="mb-1.5 flex w-full items-center gap-2 rounded-md py-0.5 text-left transition-colors hover:text-accent"
                  >
                    <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-text-muted transition-transform ${collapsed ? "" : "rotate-90"}`} strokeWidth={2.5} />
                    <ProviderMark vendor={c.id} size={16} />
                    <span className="font-display text-[13px] font-semibold tracking-tight">{c.label}</span>
                    {selectedHere > 0 && (
                      <span className="rounded-full bg-accent px-1.5 py-px font-mono text-[9px] font-semibold text-background">{selectedHere}</span>
                    )}
                    <span className="ml-auto font-mono text-[10px] text-text-muted">{models.length}</span>
                  </button>
                  {!collapsed && (
                    <div className="ml-[7px] grid grid-cols-1 gap-1.5 border-l border-border-subtle/70 pl-4">
                      {models.map((m) => {
                        const on = selModels.has(`${c.id}${MODEL_SEP}${m.id}`);
                        return (
                          <button
                            key={m.id}
                            onClick={() => toggleModel(c.id, m.id)}
                            disabled={bunkerBlocked}
                            title={bunkerBlocked ? "Blocked by Bunker Mode" : m.blurb}
                            className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${on ? "border-accent bg-accent-soft" : "border-border-subtle bg-surface hover:border-accent-border"}`}
                          >
                            <span className={`min-w-0 flex-1 truncate font-mono text-xs ${on ? "font-semibold text-accent" : "text-text-primary"}`}>{m.label}</span>
                            <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${on ? "bg-accent text-background" : "border border-border"}`}>
                              {on && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Domain scope — domains that HAVE questions lead (sorted by how many);
          the empty ones sit behind a disclosure so 20+ domains don't become a
          wall of noise. */}
      <section>
        <SubsectionHeader icon={Target} hint={scope.size === 0 ? "all domains" : `${scope.size} selected`}>
          Domain scope
        </SubsectionHeader>
        {allDomains.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-surface px-4 py-3 text-xs text-text-muted">
            No questions yet: add some in the <span className="text-accent">Questions</span> tab first.
          </div>
        ) : (() => {
          const withQ = allDomains.filter((d) => (questionCounts[d] ?? 0) > 0).sort((a, b) => (questionCounts[b] ?? 0) - (questionCounts[a] ?? 0));
          const withoutQ = allDomains.filter((d) => (questionCounts[d] ?? 0) === 0);
          const pill = (d: string) => {
            const on = scope.has(d);
            const Icon = domainIcon(d);
            const count = questionCounts[d] ?? 0;
            return (
              <button
                key={d}
                onClick={() => toggleScope(d)}
                title={count === 0 ? "No questions yet: add or AI-suggest some in Questions" : `${count} question${count === 1 ? "" : "s"}`}
                className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 font-mono text-[11px] ${
                  on
                    ? "border-accent-border bg-accent-soft text-accent"
                    : count === 0
                      ? "border-border-subtle bg-background text-text-muted/60 hover:bg-surface-warm"
                      : "border-border bg-background text-text-secondary hover:bg-surface-warm"
                }`}
              >
                {Icon && <Icon className="h-3 w-3" />}
                {titleCase(d)}
                {count > 0 && (
                  <span className={`ml-0.5 rounded-full px-1 text-[9px] ${on ? "bg-accent/15 text-accent" : "bg-surface-warm text-text-muted"}`}>{count}</span>
                )}
              </button>
            );
          };
          const selectedLabel = scope.size === 0
            ? "All domains"
            : (withQ.filter((d) => scope.has(d)).map(titleCase).join(", ") || `${scope.size} selected`);
          return (
            // One collapsible list (collapsed by default) so the scope reads as a
            // single quiet line — the full domain set only appears on expand, so
            // the page isn't a wall of chips.
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md py-0.5 font-mono text-[11px] text-text-secondary transition-colors hover:text-accent">
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-muted transition-transform group-open:rotate-90" />
                <span className="truncate">{selectedLabel}</span>
              </summary>
              <div className="ml-[7px] mt-2 space-y-2 border-l border-border-subtle/70 pl-4">
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => scope.forEach((d) => toggleScope(d))}
                    className={`rounded-md border px-2.5 py-1 font-mono text-[11px] ${scope.size === 0 ? "border-accent-border bg-accent-soft text-accent" : "border-border bg-background text-text-muted hover:bg-surface-warm"}`}
                  >
                    All
                  </button>
                  {withQ.map(pill)}
                </div>
                {withoutQ.length > 0 && (
                  <details className="group/sub">
                    <summary className="cursor-pointer list-none font-mono text-[10px] uppercase tracking-wider text-text-muted hover:text-text-secondary">
                      <ChevronRight className="mr-1 inline h-3 w-3 transition-transform group-open/sub:rotate-90" />
                      {withoutQ.length} domain{withoutQ.length === 1 ? "" : "s"} without questions
                    </summary>
                    <div className="mt-2 flex flex-wrap gap-1.5">{withoutQ.map(pill)}</div>
                  </details>
                )}
              </div>
            </details>
          );
        })()}
      </section>

      {/* Run */}
      <section className="flex items-center gap-3">
        <button
          onClick={onRun}
          disabled={running || questionCount === 0 || selCount === 0}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-background hover:bg-accent-hover disabled:opacity-40"
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {running ? "Running…" : mode === "council" ? "Run council benchmark" : `Run ${selCount} model${selCount === 1 ? "" : "s"}`}
        </button>
        <span className="text-xs text-text-muted">
          {questionCount} question{questionCount === 1 ? "" : "s"}
          {scope.size > 0 ? ` · scoped` : ""} · different CLIs run in parallel · auto-scored
        </span>
      </section>

    </div>
  );
}

export function BenchResults({
  view, domainFilter, runs, matrix, allDomains, vaultPath, initialModel, onChanged, onRerun, onRerunBatch,
  finishedBatch, onViewBatch, onDismissBanner, onCrumbHome, onClearDomain,
}: {
  view: "board" | "history" | "matrix";
  domainFilter: string;
  runs: BenchmarkRun[];
  matrix: MatrixRow[];
  allDomains: string[];
  vaultPath: string;
  initialModel?: string | null;
  onChanged: () => void;
  onRerun: (run: BenchmarkRun) => void;
  onRerunBatch: (runs: BenchmarkRun[]) => void;
  finishedBatch?: string | null;
  onViewBatch?: () => void;
  onDismissBanner?: () => void;
  onCrumbHome?: () => void;
  onClearDomain?: () => void;
}) {
  const resultsView = view;
  const [selected, setSelected] = useState<RunDetail | null>(null);
  // The run + breadcrumb context behind the open detail page, so the user can
  // see where they are (view › batch › run) and walk back up the tree.
  const [selectedRun, setSelectedRun] = useState<BenchmarkRun | null>(null);
  const [selectedFrom, setSelectedFrom] = useState<{ view: string; batch?: string } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [expandedQ, setExpandedQ] = useState<string | null>(null);
  const [scoringRun, setScoringRun] = useState<string | null>(null);

  async function loadRun(runDir: string, from?: { view: string; batch?: string }) {
    setLoadingDetail(true);
    setExpandedQ(null);
    setSelectedRun(runs.find((r) => r.run_dir === runDir) ?? null);
    setSelectedFrom(from ?? { view: resultsView === "history" ? "History" : resultsView === "matrix" ? "Model × domain" : "Leaderboard" });
    try {
      setSelected(await invoke<RunDetail>("benchmark_run_detail", { runDir }));
    } catch { /* ignore */ } finally {
      setLoadingDetail(false);
    }
  }

  // Score one unscored run on demand, then refresh the lists.
  async function scoreNow(run: BenchmarkRun) {
    const runName = run.run_dir.split("/").pop() ?? "";
    if (!runName) return;
    const session = `bench-score-one-${Date.now()}`;
    setScoringRun(run.run_dir);
    try {
      const done = new Promise<void>((resolve) => {
        let un: UnlistenFn | null = null;
        listen<{ session: string; phase: string }>("benchmark:done", (e) => {
          if (e.payload.session === session && e.payload.phase === "score") { un?.(); resolve(); }
        }).then((u) => { un = u; });
      });
      await invoke("benchmark_score", { args: { session_id: session, vault: vaultPath, run: runName } });
      await done;
      onChanged();
    } catch { /* surfaced via refresh */ } finally {
      setScoringRun(null);
    }
  }

  // Runs visible under the current domain filter (a run is "in" a domain
  // when any of its questions came from it).
  const visibleRuns = useMemo(() => {
    if (domainFilter === "all") return runs;
    return runs.filter((r) => r.domains.includes(domainFilter));
  }, [runs, domainFilter]);

  // Run history grouped by BATCH — the models you launched together are one
  // unit, named by time + scope + panel size so several batches a day stay
  // distinct. Runs from before batch-stamping are clustered into
  // pseudo-batches by launch time (folders created within minutes of each
  // other were one launch), so old history reads as real sessions too.
  const runsByBatch = useMemo(() => {
    type Group = { key: string; label: string; date: string; runs: BenchmarkRun[]; isBatch: boolean };
    const groups = new Map<string, Group>();
    const legacy: BenchmarkRun[] = [];
    for (const r of visibleRuns) {
      if (!r.batch_id) { legacy.push(r); continue; }
      const g = groups.get(r.batch_id) ?? {
        key: r.batch_id,
        label: r.batch_label || r.batch_id,
        date: r.date || "",
        runs: [],
        isBatch: true,
      };
      g.runs.push(r);
      groups.set(r.batch_id, g);
    }
    // Cluster legacy runs: sorted by creation time, a gap over 10 minutes
    // starts a new pseudo-batch.
    const GAP = 10 * 60 * 1000;
    const sortedLegacy = [...legacy].sort((a, b) => a.created_ms - b.created_ms);
    let cluster: BenchmarkRun[] = [];
    const flush = () => {
      if (cluster.length === 0) return;
      const first = cluster[0];
      const t = first.created_ms ? new Date(first.created_ms) : null;
      const hhmm = t ? `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}` : "";
      const key = `legacy-${first.run_dir}`;
      groups.set(key, {
        key,
        label: `${hhmm ? hhmm + " · " : ""}${cluster.length} model${cluster.length === 1 ? "" : "s"}`,
        date: first.date || "",
        runs: cluster,
        isBatch: false,
      });
      cluster = [];
    };
    for (const r of sortedLegacy) {
      if (cluster.length > 0 && r.created_ms - cluster[cluster.length - 1].created_ms > GAP) flush();
      cluster.push(r);
    }
    flush();
    return Array.from(groups.values()).sort((a, b) =>
      b.date.localeCompare(a.date) || (b.runs[0]?.created_ms ?? 0) - (a.runs[0]?.created_ms ?? 0),
    );
  }, [visibleRuns]);

  // By-model aggregation: every run of the same model folded into one row —
  // best/latest scores, run count, and the domains it has been tested on.
  const modelAgg = useMemo(() => {
    const byModel = new Map<string, { parsed: ReturnType<typeof parseRunLabel>; runs: BenchmarkRun[] }>();
    for (const r of visibleRuns) {
      const parsed = parseRunLabel(r.label);
      const key = `${parsed.vendor}::${parsed.model || r.label}`;
      const e = byModel.get(key) ?? { parsed, runs: [] };
      e.runs.push(r);
      byModel.set(key, e);
    }
    const rows = Array.from(byModel.values()).map(({ parsed, runs: rr }) => {
      const judgeFor = (r: BenchmarkRun) => {
        if (domainFilter === "all") return r.judge_avg;
        return matrix.find((m) => m.run_dir === r.run_dir)?.per_domain[domainFilter]?.judge_avg ?? null;
      };
      const kwFor = (r: BenchmarkRun) => {
        if (domainFilter === "all") return r.keyword_avg;
        return matrix.find((m) => m.run_dir === r.run_dir)?.per_domain[domainFilter]?.keyword_avg ?? null;
      };
      const scoredRuns = rr.filter((r) => judgeFor(r) !== null);
      const best = scoredRuns.reduce<number | null>((acc, r) => {
        const v = judgeFor(r);
        return v === null ? acc : acc === null ? v : Math.max(acc, v);
      }, null);
      const latest = [...rr].sort((a, b) => b.date.localeCompare(a.date))[0];
      const domains = Array.from(new Set(rr.flatMap((r) => r.domains))).sort();
      // Chronological judge scores — the drift line. Delta = latest vs the
      // run before it.
      const history = [...scoredRuns]
        .sort((a, b) => a.created_ms - b.created_ms)
        .map((r) => judgeFor(r))
        .filter((v): v is number => v !== null);
      const delta = history.length >= 2 ? history[history.length - 1] - history[history.length - 2] : null;
      return {
        key: `${parsed.vendor}::${parsed.model}`,
        parsed,
        runs: [...rr].sort((a, b) => b.date.localeCompare(a.date)),
        best,
        latestJudge: latest ? judgeFor(latest) : null,
        latestKw: latest ? kwFor(latest) : null,
        latestDate: latest?.date ?? "",
        domains,
        history,
        delta,
      };
    });
    return rows.sort((a, b) => (b.best ?? -1) - (a.best ?? -1));
  }, [visibleRuns, matrix, domainFilter]);
  const [expandedModel, setExpandedModel] = useState<string | null>(initialModel ?? null);

  // Accurate coverage counts, derived straight from the raw run records (the
  // source of truth: each run lists the domains it covered and which model ran).
  // This is what makes the History trustworthy — "how many times was THIS domain
  // benchmarked, and by how many distinct models" — counted, never estimated.
  const coverage = useMemo(() => {
    const byDomain = new Map<string, { runs: number; models: Set<string> }>();
    const allModels = new Set<string>();
    for (const r of visibleRuns) {
      const p = parseRunLabel(r.label);
      const mk = `${p.vendor}::${p.model || r.label}`;
      allModels.add(mk);
      for (const d of r.domains) {
        const e = byDomain.get(d) ?? { runs: 0, models: new Set<string>() };
        e.runs += 1;
        e.models.add(mk);
        byDomain.set(d, e);
      }
    }
    const rows = [...byDomain.entries()]
      .map(([domain, v]) => ({ domain, runs: v.runs, models: v.models.size }))
      .sort((a, b) => b.runs - a.runs || a.domain.localeCompare(b.domain));
    return { rows, totalRuns: visibleRuns.length, modelCount: allModels.size };
  }, [visibleRuns]);


  if (selected) {
    const p = parseRunLabel(selected.score.label);
    const crumbBatch = selectedRun?.batch_label ?? selectedFrom?.batch ?? (selectedRun?.date || null);
    // A section header inside an expanded question: big, bold, unmissable.
    const SectionHead = ({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "ok" | "accent" }) => (
      <h4 className={`mb-1.5 flex items-center gap-2 font-display text-[15px] font-bold tracking-tight ${
        tone === "ok" ? "text-ok" : tone === "accent" ? "text-accent" : "text-text-primary"
      }`}>
        {children}
      </h4>
    );
    return (
      <div className="w-full px-8 py-5">
        <BenchCrumbs
          items={[
            { label: "Benchmark" },
            { label: selectedFrom?.view ?? "Leaderboard", onClick: () => setSelected(null) },
            ...(crumbBatch ? [{ label: crumbBatch, onClick: () => setSelected(null) }] : []),
            { label: p.model },
          ]}
          meta={`${selected.score.questionScores.length} questions`}
        />
        {/* Dense header — model, when, where it ran, and the verdict, one row. */}
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3">
          <ProviderMark vendor={p.vendor} size={28} />
          <h2 className="font-display text-xl font-bold tracking-tight">{p.model}</h2>
          {selectedRun?.date && <span className="rounded bg-surface-warm px-2 py-0.5 font-mono text-[10px] text-text-muted">{selectedRun.date}</span>}
          <span className="flex items-center gap-1">
            {(selectedRun?.domains ?? []).slice(0, 6).map((d) => (
              <span key={d} className="rounded bg-surface-warm px-1.5 py-0.5 font-mono text-[10px] text-text-muted">{d}</span>
            ))}
            {(selectedRun?.domains.length ?? 0) > 6 && <span className="font-mono text-[10px] text-text-muted">+{(selectedRun?.domains.length ?? 0) - 6}</span>}
          </span>
          <div className="ml-auto flex items-center gap-5 font-mono text-sm">
            <span><span className="font-display text-2xl font-bold text-accent">{selected.score.judge_avg?.toFixed(1) ?? "-"}</span><span className="text-[11px] text-text-muted"> /10</span></span>
            <span className="text-text-secondary">{selected.score.keyword_avg !== null ? Math.round(selected.score.keyword_avg) + "% kw" : ""}</span>
            <span className="text-text-muted">{selected.score.questionScores.length} q</span>
            {selectedRun && (
              <button
                onClick={() => onRerun(selectedRun)}
                title="Rerun: same model, same domains, as a fresh run"
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent"
              >
                <RotateCw className="h-3 w-3" /> rerun
              </button>
            )}
          </div>
        </div>
        <div className="mt-4 space-y-2">
          {selected.score.questionScores.map((q) => {
            const expanded = expandedQ === q.id;
            const record = selected.records.find((r) => r.id === q.id);
            return (
              <div key={q.id} className="overflow-hidden rounded-lg border border-border bg-surface">
                <button onClick={() => setExpandedQ(expanded ? null : q.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-warm">
                  <span className="text-text-muted">{expanded ? "▾" : "▸"}</span>
                  <span className="w-44 shrink-0 truncate font-mono text-sm text-text-primary" title={q.id}>{q.id}</span>
                  <span className="rounded bg-surface-warm px-1.5 py-0 font-mono text-[10px] text-text-muted">{q.domain}</span>
                  <div className="min-w-0 flex-1"><ScoreBar value={q.judge_score} max={10} /></div>
                  <span className="flex shrink-0 items-center gap-3 font-mono text-xs">
                    <span className="text-text-muted">{q.keyword_score !== null ? Math.round(q.keyword_score) + "%" : "-"}</span>
                    <span className="w-10 text-right text-accent">{q.judge_score ?? "-"}/10</span>
                  </span>
                </button>
                {expanded && (
                  <div className="space-y-5 border-t border-border-subtle px-6 py-5 text-sm">
                    <div>
                      <SectionHead><FileText className="h-4 w-4" /> Question</SectionHead>
                      <div className="max-w-[90ch] whitespace-pre-wrap leading-relaxed text-text-primary">{record?.prompt ?? "(n/a)"}</div>
                    </div>
                    {record?.expected_decision && (
                      <div className="rounded-lg border border-ok/25 bg-ok/5 px-4 py-3">
                        <SectionHead tone="ok"><Check className="h-4 w-4" strokeWidth={3} /> Expected decision</SectionHead>
                        <div className="max-w-[90ch] whitespace-pre-wrap leading-relaxed text-text-primary">{record.expected_decision}</div>
                      </div>
                    )}
                    <div>
                      <SectionHead><MessagesSquare className="h-4 w-4" /> Model's answer</SectionHead>
                      <div className="max-w-[90ch] whitespace-pre-wrap leading-relaxed text-text-primary">{record?.reply ?? "(no reply)"}</div>
                    </div>
                    {q.judge_rationale && (
                      <div className="rounded-lg border border-accent-border bg-accent-soft/40 px-4 py-3">
                        <SectionHead tone="accent"><Scale className="h-4 w-4" /> Judge verdict · {q.judge_score}/10</SectionHead>
                        <div className="max-w-[90ch] whitespace-pre-wrap leading-relaxed text-text-secondary">{q.judge_rationale}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full px-8 py-5">
      <BenchCrumbs
        items={[
          { label: "Benchmark", onClick: onCrumbHome },
          {
            label: resultsView === "history" ? "History" : resultsView === "matrix" ? "Model × domain" : "Leaderboard",
            // Clickable only when a domain filter pushes it off the tail — then
            // it walks back to the same view across all domains.
            onClick: domainFilter !== "all" ? onClearDomain : undefined,
          },
          ...(domainFilter !== "all" ? [{ label: titleCase(domainFilter) }] : []),
        ]}
        meta={
          resultsView === "history"
            ? `${runsByBatch.length} batch${runsByBatch.length === 1 ? "" : "es"} · ${visibleRuns.length} model run${visibleRuns.length === 1 ? "" : "s"}`
            : `${modelAgg.length} model${modelAgg.length === 1 ? "" : "s"} · ${visibleRuns.length} run${visibleRuns.length === 1 ? "" : "s"}`
        }
      />

      {visibleRuns.length === 0 && (
        <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-sm text-text-muted">
          {domainFilter === "all"
            ? <>No runs yet. Head to <span className="text-accent">Run</span> to kick one off.</>
            : <>No runs cover <span className="text-accent">{titleCase(domainFilter)}</span> yet. Run a benchmark scoped to it, or switch the filter to all domains.</>}
        </div>
      )}

      {/* Accurate coverage: counted from the run records, not estimated. Answers
          "how many times has each domain been benchmarked, by how many models". */}
      {visibleRuns.length > 0 && coverage.rows.length > 0 && (
        <CollapsibleSection
          icon={Target}
          title="Coverage by domain"
          subtitle="Counted directly from every run record."
          summary={`${coverage.totalRuns} runs · ${coverage.modelCount} models · ${coverage.rows.length} domains`}
          className="mb-4"
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle text-left font-mono text-[10px] uppercase tracking-wider text-text-muted">
                <th className="py-1.5 pr-3 font-medium">Domain</th>
                <th className="py-1.5 pr-3 text-right font-medium">Benchmark runs</th>
                <th className="py-1.5 text-right font-medium">Distinct models</th>
              </tr>
            </thead>
            <tbody>
              {coverage.rows.map((r) => (
                <tr key={r.domain} className="border-b border-border-subtle/40 last:border-0">
                  <td className="py-1.5 pr-3 text-text-primary">{titleCase(r.domain)}</td>
                  <td className="py-1.5 pr-3 text-right font-mono text-text-secondary">{r.runs}</td>
                  <td className="py-1.5 text-right font-mono text-text-secondary">{r.models}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CollapsibleSection>
      )}

      {loadingDetail && <div className="mb-2 text-xs text-text-muted">loading…</div>}

      {/* LEADERBOARD — the page leads with the ANSWER: which model wins.
          Podium for the top three, then full standings, one row per model. */}
      {resultsView === "board" && visibleRuns.length > 0 && (
        <>
          {finishedBatch && (
            <div className="mb-4 flex items-center gap-3 rounded-xl border border-accent-border bg-accent-soft/50 px-4 py-2.5">
              <Check className="h-4 w-4 shrink-0 text-accent" strokeWidth={3} />
              <span className="min-w-0 flex-1 truncate text-sm text-text-primary">
                Batch <span className="font-semibold">{finishedBatch}</span> finished and is on the board.
              </span>
              <button onClick={onViewBatch} className="shrink-0 rounded-md border border-accent-border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-accent hover:bg-accent hover:text-background">
                View batch
              </button>
              <button onClick={onDismissBanner} title="Dismiss" className="shrink-0 rounded-md p-1 text-text-muted hover:text-text-primary">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <div className="flex flex-col gap-2">
            {modelAgg.map((m, i) => {
              const leader = i === 0 && modelAgg.length > 1;
              const podium = i < 3 && modelAgg.length > 1;
              return (
              <div
                key={m.key}
                className={`overflow-hidden rounded-xl border transition-colors ${
                  leader
                    ? "border-accent bg-gradient-to-r from-accent-soft/70 to-surface"
                    : podium
                      ? "border-accent-border/50 bg-surface"
                      : "border-border-subtle bg-surface"
                }`}
              >
                <button
                  onClick={() => setExpandedModel(expandedModel === m.key ? null : m.key)}
                  className={`flex w-full items-center gap-3 text-left hover:bg-surface-warm/60 ${leader ? "px-4 py-3" : "px-4 py-2"}`}
                >
                  {/* Rank */}
                  <span className={`flex shrink-0 items-center justify-center rounded-full font-mono font-bold ${
                    leader
                      ? "h-8 w-8 bg-accent text-background"
                      : podium
                        ? "h-6 w-6 border border-accent-border bg-accent-soft text-[11px] text-accent"
                        : "h-6 w-6 text-[11px] text-text-muted"
                  }`}>
                    {leader ? <Crown className="h-4 w-4" /> : i + 1}
                  </span>
                  <ProviderMark vendor={m.parsed.vendor} size={leader ? 28 : 22} />
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate font-display tracking-tight ${leader ? "text-base font-bold" : "text-sm font-semibold"}`}>
                      {m.parsed.model}
                    </span>
                    <span className="block font-mono text-[10px] text-text-muted">
                      {m.runs.length} run{m.runs.length === 1 ? "" : "s"} · {m.domains.length} domain{m.domains.length === 1 ? "" : "s"} · last {m.latestDate || "-"}
                    </span>
                  </span>
                  {/* Drift: score history + latest delta */}
                  {m.history.length >= 2 && (
                    <span className="hidden items-center gap-1.5 md:flex" title={`Judge scores over time: ${m.history.map((v) => v.toFixed(1)).join(" → ")}`}>
                      <Sparkline values={m.history} />
                      {m.delta !== null && Math.abs(m.delta) >= 0.05 && (
                        <span className={`font-mono text-[10px] font-semibold ${m.delta > 0 ? "text-ok" : "text-warn"}`}>
                          {m.delta > 0 ? "▲" : "▼"}{Math.abs(m.delta).toFixed(1)}
                        </span>
                      )}
                    </span>
                  )}
                  <div className="hidden w-32 lg:block"><ScoreBar value={m.best} max={10} color={scoreColor((m.best ?? 0) * 10)} /></div>
                  <span className={`shrink-0 text-right font-mono font-bold text-accent ${leader ? "w-16 text-2xl" : "w-12 text-sm"}`}>
                    {m.best?.toFixed(1) ?? "-"}
                  </span>
                </button>
                {expandedModel === m.key && (
                  <div className="border-t border-border-subtle bg-surface px-4 py-2">
                    {m.runs.map((r) => (
                      <div key={r.run_dir} className="flex w-full items-center gap-3 rounded px-2 py-1.5 hover:bg-surface-warm">
                        <button
                          onClick={() => r.scored && loadRun(r.run_dir)}
                          disabled={!r.scored}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default"
                        >
                          <span className="w-20 shrink-0 font-mono text-[10px] text-text-muted">{r.date || "undated"}</span>
                          <span className="flex min-w-0 flex-1 items-center gap-1">
                            {r.domains.slice(0, 6).map((d) => (
                              <span key={d} className="rounded bg-surface-warm px-1.5 py-0 font-mono text-[9px] text-text-muted">{d}</span>
                            ))}
                            {r.domains.length > 6 && <span className="font-mono text-[9px] text-text-muted">+{r.domains.length - 6}</span>}
                          </span>
                          <span className="font-mono text-[10px] text-text-muted">{r.questions} q</span>
                          {r.scored ? (
                            <span className="w-12 text-right font-mono text-xs font-semibold text-accent">{r.judge_avg?.toFixed(1) ?? "-"}</span>
                          ) : (
                            <span className="font-mono text-[10px] text-warn">unscored</span>
                          )}
                        </button>
                        <button
                          onClick={() => onRerun(r)}
                          title="Rerun: same model, same domains, as a fresh run"
                          className="shrink-0 rounded-md border border-border p-1 text-text-muted hover:border-accent-border hover:text-accent"
                        >
                          <RotateCw className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              );
            })}
          </div>
        </>
      )}

      {/* HISTORY — one card per BATCH (the models launched together),
          collapsed by default. The summary alone says when, what scope, how
          many models, and the session's best score. */}
      {resultsView === "history" && visibleRuns.length > 0 && (
        <div className="space-y-2">
          {runsByBatch.map((group) => {
            const best = group.runs.reduce<number | null>((acc, r) => (r.judge_avg === null ? acc : acc === null ? r.judge_avg : Math.max(acc, r.judge_avg)), null);
            const unscored = group.runs.filter((r) => !r.scored).length;
            return (
            <details key={group.key} className="group/date overflow-hidden rounded-2xl border border-border bg-surface">
              <summary className="flex cursor-pointer list-none items-center gap-2.5 px-4 py-2.5 hover:bg-surface-warm">
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-muted transition-transform group-open/date:rotate-90" />
                {group.isBatch && <span className="font-mono text-[12px] font-semibold text-text-primary">{group.date}</span>}
                <span className={`min-w-0 truncate font-mono text-[12px] ${group.isBatch ? "text-text-secondary" : "font-semibold text-text-primary"}`}>{group.label}</span>
                <span className="font-mono text-[10px] text-text-muted">{group.runs.length} model{group.runs.length === 1 ? "" : "s"}</span>
                {unscored > 0 && <span className="rounded bg-warn/10 px-1.5 py-0 font-mono text-[9px] text-warn">{unscored} unscored</span>}
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.preventDefault(); onRerunBatch(group.runs); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onRerunBatch(group.runs); } }}
                  title="Rerun this whole batch: every model in it, same domains, fresh runs"
                  className="ml-auto inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md border border-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent"
                >
                  <RotateCw className="h-3 w-3" /> rerun batch
                </span>
                <span className="font-mono text-[10px] text-text-muted">best</span>
                <span className="font-mono text-sm font-semibold text-accent">{best?.toFixed(1) ?? "-"}</span>
              </summary>
              <div className="space-y-1.5 border-t border-border-subtle px-3 py-2.5">
                {group.runs.map((r) => {
                  const parsed = parseRunLabel(r.label);
                  return (
                    <div
                      key={r.run_dir}
                      className="flex w-full items-center gap-3 rounded-lg border border-border-subtle bg-surface px-3 py-2 hover:bg-surface-warm"
                    >
                      <button
                        onClick={() => r.scored && loadRun(r.run_dir, { view: "History", batch: group.label })}
                        disabled={!r.scored}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default"
                      >
                        <ProviderMark vendor={parsed.vendor} size={22} />
                        <span className="min-w-0 truncate font-mono text-xs text-text-primary">{parsed.model || r.label}</span>
                        <span className="hidden items-center gap-1 md:flex">
                          {r.domains.slice(0, 5).map((d) => (
                            <span key={d} className="rounded bg-surface-warm px-1.5 py-0 font-mono text-[9px] text-text-muted">{d}</span>
                          ))}
                          {r.domains.length > 5 && <span className="font-mono text-[9px] text-text-muted">+{r.domains.length - 5}</span>}
                        </span>
                      </button>
                      <span className="font-mono text-[10px] text-text-muted">{r.questions} q</span>
                      {r.scored ? (
                        <>
                          <span className="w-12 text-right font-mono text-sm font-semibold text-accent">{r.judge_avg?.toFixed(1) ?? "-"}</span>
                          <span className="w-10 text-right font-mono text-[11px] text-text-muted">{r.keyword_avg !== null ? Math.round(r.keyword_avg) + "%" : "-"}</span>
                        </>
                      ) : (
                        <button
                          onClick={() => scoreNow(r)}
                          disabled={scoringRun !== null}
                          className="inline-flex items-center gap-1 rounded-md border border-warn/50 bg-warn/10 px-2 py-0.5 font-mono text-[10px] text-warn hover:bg-warn/20 disabled:opacity-50"
                        >
                          {scoringRun === r.run_dir ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                          {scoringRun === r.run_dir ? "scoring…" : "unscored · score now"}
                        </button>
                      )}
                      <button
                        onClick={() => onRerun(r)}
                        title="Rerun: same model, same domains, as a fresh run"
                        className="shrink-0 rounded-md border border-border p-1 text-text-muted hover:border-accent-border hover:text-accent"
                      >
                        <RotateCw className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </details>
            );
          })}
        </div>
      )}

      {resultsView === "matrix" && visibleRuns.length > 0 && (
        <BenchMatrix matrix={matrix} allDomains={allDomains} onPick={loadRun} />
      )}
    </div>
  );
}

// Model × domain pivot — rows are runs (models), columns are domains, cells
// are judge averages. Best cell per column is highlighted so "which model
// wins which domain" reads at a glance.

export function BenchmarkPanel({
  vaultPath,
  initialDomain,
}: {
  vaultPath: string;
  initialDomain?: string | null;
}) {
  // A "runs" deep link from the Models page lands here with a model key to
  // expand on the leaderboard. Consumed once.
  const [initialModel] = useState<string | null>(() => {
    const v = lsGet("prevail.bench.expandModel");
    if (v) lsSet("prevail.bench.expandModel", "");
    return v || null;
  });
  // ONE flat navigation level: every destination is a top-level tab. No
  // "Results" grouping with a second pill bar underneath — that double
  // hierarchy was genuinely confusing.
  const [view, setView] = useState<"run" | "board" | "history" | "matrix" | "questions">(
    initialModel ? "board" : initialDomain ? "run" : "board",
  );
  // Domain filter shared by Leaderboard + History, shown in the same bar.
  const [domainFilter, setDomainFilter] = useState<string>(initialDomain ? initialDomain.toLowerCase() : "all");
  // Set when a batch just finished: the Leaderboard shows a "batch finished"
  // banner linking to it in History (answer first, filing one click away).
  const [finishedBatch, setFinishedBatch] = useState<string | null>(null);

  // Data
  const [runs, setRuns] = useState<BenchmarkRun[]>([]);
  const [matrix, setMatrix] = useState<MatrixRow[]>([]);
  const [questions, setQuestions] = useState<BenchQuestion[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const [vaultDomains, setVaultDomains] = useState<string[]>([]);
  const refresh = useCallback(() => {
    invoke<BenchmarkRun[]>("benchmark_runs", { vault: vaultPath }).then(setRuns).catch((e) => setErr(String(e)));
    invoke<MatrixRow[]>("benchmark_matrix", { vault: vaultPath }).then(setMatrix).catch(() => {});
    invoke<BenchQuestion[]>("benchmark_questions", { vault: vaultPath }).then(setQuestions).catch(() => {});
    invoke<Domain[]>("scan_vault", { path: vaultPath })
      .then((ds) => setVaultDomains(ds.map((d) => d.name)))
      .catch(() => {});
  }, [vaultPath]);
  useEffect(() => { refresh(); }, [refresh]);

  // Domains available to scope/filter by: the vault's REAL domains first,
  // then any extra domains that exist only in question files or old runs
  // (so nothing is hidden, but the list always matches the actual vault).
  const questionCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const q of questions) m[q.domain] = (m[q.domain] ?? 0) + 1;
    return m;
  }, [questions]);
  const allDomains = useMemo(() => {
    const vault = [...vaultDomains].sort();
    const extra = new Set<string>();
    for (const q of questions) extra.add(q.domain);
    for (const m of matrix) for (const d of Object.keys(m.per_domain)) extra.add(d);
    for (const v of vault) extra.delete(v);
    return [...vault, ...Array.from(extra).sort()];
  }, [vaultDomains, questions, matrix]);

  // ── Run config ──────────────────────────────────────────────────
  const [mode, setMode] = useState<"single" | "council">("single");
  const [selModels, setSelModels] = useState<Set<string>>(() => new Set([`claude${MODEL_SEP}opus`]));
  const [scope, setScope] = useState<Set<string>>(
    () => new Set(initialDomain ? [initialDomain.toLowerCase()] : []),
  );
  // Live run state comes from the module-scope registry, so it survives any
  // navigation and remount. This panel surfaces the batch matching its home
  // domain when scoped, otherwise the most relevant one.
  const allBatches = useBenchBatches().filter((b) => b.vault === vaultPath);
  const homeDomain = initialDomain ? initialDomain.toLowerCase() : null;
  const matchesHome = (b: BenchBatch) =>
    !homeDomain || b.scopeKey === "" || b.scopeKey.split(",").includes(homeDomain);
  const visibleBatches = allBatches.filter(matchesHome);
  const current =
    [...visibleBatches].reverse().find((b) => b.running) ??
    [...visibleBatches].reverse().find((b) => !b.consumed) ??
    null;
  const jobs = current?.jobs ?? [];
  const running = current?.running ?? false;
  const log = current?.log ?? "";
  const activeBatch = current
    ? { label: current.label, scope: current.scopeLabel, domains: current.scopeDomains }
    : null;
  const logRef = useRef<HTMLPreElement>(null);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [log]);

  // When a batch this panel surfaces finishes, land on the refreshed
  // leaderboard with the "batch finished" banner — once.
  useEffect(() => {
    const fin = visibleBatches.find((b) => !b.running && !b.consumed);
    if (!fin) return;
    fin.consumed = true;
    refresh();
    if (!fin.cancelled) {
      setFinishedBatch(fin.label);
      setView("board");
    }
    benchBatches.delete(fin.id);
    benchNotify();
  }, [visibleBatches, refresh]);

  const toggleModel = (cli: string, model: string) => {
    const k = `${cli}${MODEL_SEP}${model}`;
    setSelModels((cur) => {
      const next = new Set(cur);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });
  };
  const toggleScope = (d: string) =>
    setScope((cur) => {
      const next = new Set(cur);
      next.has(d) ? next.delete(d) : next.add(d);
      return next;
    });

  async function runBenchmark() {
    const scopeStr = Array.from(scope).join(",");
    const scoped = scope.size === 0
      ? questions
      : questions.filter((q) => scope.has(q.domain.toLowerCase()));
    const qids = scoped.map((q) => q.id).sort();
    const blankJob = { status: "queued" as BenchJobStatus, done: 0, total: qids.length, qids, qdone: {} };
    const plannedJobs: BenchJob[] =
      mode === "council"
        ? [{ key: "council", cli: "", model: "", label: "Council", ...blankJob }]
        : Array.from(selModels).map((k) => {
            const [cli, model] = k.split(MODEL_SEP);
            const ml = MODELS[cli]?.find((m) => m.id === model)?.label ?? model;
            return { key: k, cli, model, label: `${titleCase(cli)} · ${ml}`, ...blankJob, qdone: {} };
          });
    const runnable = isBunkerOn() ? plannedJobs.filter((j) => j.cli && isLocalCli(j.cli)) : plannedJobs;
    if (isBunkerOn() && mode === "council") { setErr("Blocked by Bunker Mode: the Council convenes cloud models."); return; }
    if (isBunkerOn() && runnable.length < plannedJobs.length) {
      setErr(runnable.length === 0
        ? "Blocked by Bunker Mode: pick a local model (Ollama, LM Studio, oMLX)."
        : "Cloud models were skipped (Blocked by Bunker Mode).");
      if (runnable.length === 0) return;
    }
    if (runnable.length === 0) { setErr("Pick at least one model to run."); return; }
    void executeBenchBatch(vaultPath, runnable, mode === "council", scopeStr);
  }

  // Rebuild a runnable job from a stored run. Runs since the rerun fix carry
  // meta.json (exact cli/model/council); older runs fall back to parsing the
  // label.
  function jobFromRun(r: BenchmarkRun, key: string): { job: BenchJob; council: boolean } | null {
    const stripped = r.label.replace(/^\d{4}-\d{2}-\d{2}[_ ]/, "").trim();
    let council = /^council\b/i.test(stripped);
    let cli = "";
    let modelId = "";
    if (r.council) {
      council = true;
    } else if (r.cli) {
      cli = r.cli;
      modelId = r.model ?? "";
    } else if (!council) {
      const known = ["claude", "codex", "antigravity", "ollama", "openrouter", "lmstudio"];
      for (const k of known) {
        if (stripped === k) { cli = k; break; }
        if (stripped.toLowerCase().startsWith(k + "-")) { cli = k; modelId = stripped.slice(k.length + 1); break; }
      }
      if (!cli) return null;
    }
    const label = council ? "Council" : `${titleCase(cli)} · ${modelLabel(cli, modelId) || modelId || "default"}`;
    const domSet = new Set(r.domains.map((d) => d.toLowerCase()));
    const qids = questions.filter((q) => domSet.size === 0 || domSet.has(q.domain.toLowerCase())).map((q) => q.id).sort();
    return {
      job: { key, cli, model: modelId, label, status: "queued", done: 0, total: qids.length || r.questions, qids, qdone: {} },
      council,
    };
  }

  // Rerun a past run as-is: the same model (or council) against the same
  // domain scope, as a fresh dated run.
  async function rerunRun(r: BenchmarkRun) {
    const built = jobFromRun(r, `rerun-${Date.now()}`);
    if (!built) { setErr(`Can't rerun: unrecognized run label "${r.label}"`); return; }
    setView("run");
    void executeBenchBatch(vaultPath, [built.job], built.council, r.domains.join(","));
  }

  // Rerun a whole BATCH: every model that ran together, together again.
  async function rerunBatch(batchRuns: BenchmarkRun[]) {
    const builds = batchRuns
      .map((r, i) => ({ r, built: jobFromRun(r, `rerun-${Date.now()}-${i}`) }))
      .filter((x): x is { r: BenchmarkRun; built: NonNullable<ReturnType<typeof jobFromRun>> } => x.built !== null);
    if (builds.length === 0) { setErr("Can't rerun this batch: no recognizable runs."); return; }
    // Dedup models (a batch should not double-run the same model).
    const seen = new Set<string>();
    const jobs = builds.filter(({ built }) => {
      const k = `${built.job.cli}::${built.job.model}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const council = jobs.some(({ built }) => built.council);
    setView("run");
    void executeBenchBatch(vaultPath, jobs.map(({ built }) => built.job), council, batchRuns[0]?.domains.join(",") ?? "");
  }

  return (
    <div className="flex h-full flex-col">
      {/* Sub-nav — a segmented control, deliberately a different shape from
          the underline top tab bar so the two rows don't read as twins. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 pb-3 pt-1">
        {/* THE navigation — every destination, one level, one bar. */}
        <div className="inline-flex items-center gap-0.5 rounded-xl border border-border-subtle bg-surface-warm/60 p-1">
          {([
            ["run", "Run", Sparkles],
            ["board", "Leaderboard", Crown],
            ["history", "History", Activity],
            ["matrix", "Model × domain", Layers],
            ["questions", "Questions", FileText],
          ] as const).map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setView(id)}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
                view === id
                  ? "bg-surface text-accent shadow-sm ring-1 ring-black/5"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              <Icon className="h-3 w-3" />
              {label}
            </button>
          ))}
        </div>
        {/* Contextual, same bar: run mode while configuring; domain filter on
            the score views. */}
        {view === "run" && (
          <div className="inline-flex items-center gap-0.5 rounded-xl border border-border-subtle bg-surface-warm/60 p-1">
            {([
              ["single", "Models", Layers],
              ["council", "Council", Scale],
            ] as const).map(([id, label, Icon]) => (
              <button
                key={id}
                onClick={() => setMode(id)}
                disabled={id === "council" && isBunkerOn()}
                title={
                  id === "single"
                    ? "Compare models head-to-head"
                    : isBunkerOn()
                      ? "Blocked by Bunker Mode: the Council convenes cloud models"
                      : "Run the multi-model Council"
                }
                className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
                  mode === id
                    ? "bg-surface text-accent shadow-sm ring-1 ring-black/5"
                    : "text-text-muted hover:text-text-secondary"
                }`}
              >
                <Icon className="h-3 w-3" />
                {label}
              </button>
            ))}
          </div>
        )}
        {(view === "board" || view === "history") && allDomains.length > 0 && (
          <select
            value={domainFilter}
            onChange={(e) => setDomainFilter(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] text-text-secondary"
          >
            <option value="all">all domains</option>
            {allDomains.map((d) => <option key={d} value={d}>{titleCase(d)}</option>)}
          </select>
        )}
        {initialDomain && (
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-surface px-3 py-1 font-mono text-[11px] text-text-muted">
            <Target className="h-3 w-3 text-accent" />
            scoped to <span className="font-semibold text-accent">{titleCase(initialDomain)}</span>
          </span>
        )}
      </div>

      {err && <div className="mx-4 mt-3 rounded border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">{err}</div>}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {view === "run" && (
          <BenchRunConfig
            mode={mode} setMode={setMode}
            selModels={selModels} toggleModel={toggleModel}
            allDomains={allDomains} scope={scope} toggleScope={toggleScope}
            questionCounts={questionCounts}
            questionCount={
              scope.size === 0
                ? questions.length
                : questions.filter((q) => scope.has(q.domain.toLowerCase())).length
            }
            running={running} jobs={jobs} log={log} logRef={logRef}
            activeBatch={activeBatch}
            onRun={runBenchmark}
            onViewResults={() => setView("board")}
            onReset={() => { if (current && !current.running) { benchBatches.delete(current.id); benchNotify(); } }}
            onCancel={current?.running ? () => void cancelBenchBatch(current.id) : undefined}
            onCrumbHome={() => setView("board")}
          />
        )}
        {(view === "board" || view === "history" || view === "matrix") && (
          <BenchResults
            view={view}
            domainFilter={view === "matrix" ? "all" : domainFilter}
            runs={runs} matrix={matrix} allDomains={allDomains} vaultPath={vaultPath}
            initialModel={initialModel} onChanged={refresh}
            onRerun={(r) => void rerunRun(r)}
            onRerunBatch={(rs) => void rerunBatch(rs)}
            finishedBatch={finishedBatch}
            onViewBatch={() => { setView("history"); setFinishedBatch(null); }}
            onDismissBanner={() => setFinishedBatch(null)}
            onCrumbHome={() => setView("run")}
            onClearDomain={() => setDomainFilter("all")}
          />
        )}
        {view === "questions" && (
          <BenchQuestions
            vaultPath={vaultPath} questions={questions} allDomains={allDomains}
            initialDomain={initialDomain}
            onChanged={refresh}
          />
        )}
      </div>
    </div>
  );
}
