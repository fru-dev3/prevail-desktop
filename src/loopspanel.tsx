// Loops surface for a domain: the desired state up top, then the standing loops
// that work to close the gap to it. Loops are collapsed by default (the page
// reads as a list of forces); expand one to see its signals, condition, cadence,
// and current actions. The runner daemon (separate) evaluates enabled loops and
// keeps their actions current; here you define and steer them.
import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Infinity as InfinityIcon, Plus, Target, Trash2 } from "lucide-react";
import { titleCase } from "./format";
import { Toggle } from "./ui";
import {
  CADENCE_LABEL,
  type Loop,
  type LoopCadence,
  type LoopType,
  type LoopsDoc,
  hasSeed,
  makeLoop,
  readLoops,
  seedLoopsFor,
  writeLoops,
} from "./loops";

const CADENCES: LoopCadence[] = ["continuous", "daily", "weekly", "monthly"];

export function LoopsPanel({ domain, vaultPath }: { domain: string; vaultPath: string }) {
  const [doc, setDoc] = useState<LoopsDoc | null>(null);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<LoopType>("open");
  const [newCadence, setNewCadence] = useState<LoopCadence>("weekly");
  const [savedAt, setSavedAt] = useState(0);

  useEffect(() => {
    let alive = true;
    readLoops(vaultPath, domain).then((d) => { if (alive) setDoc(d); });
    return () => { alive = false; };
  }, [vaultPath, domain]);

  // Single persistence path: update local state, then write the whole doc.
  const persist = useCallback(async (next: LoopsDoc) => {
    setDoc(next);
    try { await writeLoops(vaultPath, domain, next); setSavedAt(Date.now()); }
    catch (e) { console.error("write loops", e); }
  }, [vaultPath, domain]);

  const mutateLoop = useCallback((id: string, patch: Partial<Loop>) => {
    if (!doc) return;
    persist({ ...doc, loops: doc.loops.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  }, [doc, persist]);

  const removeLoop = useCallback((id: string) => {
    if (!doc) return;
    persist({ ...doc, loops: doc.loops.filter((l) => l.id !== id) });
  }, [doc, persist]);

  const addLoop = useCallback(() => {
    if (!doc || !newName.trim()) return;
    const loop = makeLoop({ name: newName.trim(), type: newType, cadence: newCadence, purpose: "", status: "active", enabled: true });
    persist({ ...doc, loops: [...doc.loops, loop] });
    setNewName(""); setNewType("open"); setNewCadence("weekly"); setAdding(false);
    setOpenIds((s) => new Set(s).add(loop.id));
  }, [doc, newName, newType, newCadence, persist]);

  const toggleOpen = (id: string) => setOpenIds((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  if (!doc) return <div className="text-sm text-text-muted">loading loops…</div>;

  const active = doc.loops.filter((l) => l.status !== "done");
  const done = doc.loops.filter((l) => l.status === "done");

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      {/* Header */}
      <div>
        <h2 className="font-display text-2xl font-semibold tracking-tight">Loops</h2>
        <p className="mt-1 max-w-2xl text-sm text-text-secondary">
          Standing forces on {titleCase(domain)}, not one-off tasks. Each loop watches signals and works to close the gap to your desired state. Open loops run forever; closed loops finish when their condition is met.
        </p>
      </div>

      {/* Desired state */}
      <section className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-2 flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">
          <Target className="h-3.5 w-3.5 text-accent" /> Desired state
        </div>
        <textarea
          defaultValue={doc.desiredState}
          key={`ds-${domain}`}
          onBlur={(e) => { if (e.target.value !== doc.desiredState) persist({ ...doc, desiredState: e.target.value }); }}
          placeholder={`What does a thriving ${titleCase(domain)} look like? The loops below work to close the gap to this.`}
          className="min-h-[72px] w-full resize-y rounded-lg border border-border-subtle bg-background px-3 py-2 text-sm leading-relaxed text-text-primary outline-none focus:border-accent-border"
        />
      </section>

      {/* Empty state → seed */}
      {doc.loops.length === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-surface p-6 text-center">
          <p className="text-sm text-text-secondary">No loops yet for {titleCase(domain)}.</p>
          <button
            onClick={() => persist(seedLoopsFor(domain))}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-soft px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-accent hover:bg-accent hover:text-background"
          >
            <Plus className="h-3.5 w-3.5" /> Generate starter loops
          </button>
          <p className="mt-2 text-[11px] text-text-muted">
            {hasSeed(domain) ? `Seeds a tailored steward for ${titleCase(domain)}.` : "Seeds a general steward you can shape."}
          </p>
        </div>
      )}

      {/* Active loops */}
      {active.length > 0 && (
        <section className="space-y-2">
          {active.map((l) => (
            <LoopCard
              key={l.id}
              loop={l}
              open={openIds.has(l.id)}
              onToggleOpen={() => toggleOpen(l.id)}
              onChange={(patch) => mutateLoop(l.id, patch)}
              onRemove={() => removeLoop(l.id)}
            />
          ))}
        </section>
      )}

      {/* Add loop */}
      {doc.loops.length > 0 && (
        adding ? (
          <div className="rounded-xl border border-border-subtle bg-surface-warm/40 p-3">
            <input
              autoFocus value={newName} onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addLoop(); if (e.key === "Escape") { setAdding(false); setNewName(""); } }}
              placeholder="Loop name (e.g. Opportunity Detection)"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-border"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select value={newType} onChange={(e) => setNewType(e.target.value as LoopType)} className="rounded-md border border-border bg-background px-2 py-1 text-xs">
                <option value="open">Open (never ends)</option>
                <option value="closed">Closed (has a finish line)</option>
              </select>
              <select value={newCadence} onChange={(e) => setNewCadence(e.target.value as LoopCadence)} className="rounded-md border border-border bg-background px-2 py-1 text-xs">
                {CADENCES.map((c) => <option key={c} value={c}>{CADENCE_LABEL[c]}</option>)}
              </select>
              <button onClick={addLoop} disabled={!newName.trim()} className="rounded-md border border-accent-border bg-accent px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-background hover:opacity-90 disabled:opacity-40">add</button>
              <button onClick={() => { setAdding(false); setNewName(""); }} className="rounded-md px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:text-text-primary">cancel</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} className="flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent">
            <Plus className="h-3.5 w-3.5" /> add loop
          </button>
        )
      )}

      {/* Completed (closed) loops, collapsed at the bottom */}
      {done.length > 0 && (
        <section className="space-y-2 pt-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">Completed · {done.length}</div>
          {done.map((l) => (
            <LoopCard key={l.id} loop={l} open={openIds.has(l.id)} onToggleOpen={() => toggleOpen(l.id)} onChange={(patch) => mutateLoop(l.id, patch)} onRemove={() => removeLoop(l.id)} />
          ))}
        </section>
      )}

      {savedAt > 0 && <div className="text-right font-mono text-[10px] text-text-muted/60">saved</div>}
    </div>
  );
}

function LoopCard({ loop, open, onToggleOpen, onChange, onRemove }: {
  loop: Loop;
  open: boolean;
  onToggleOpen: () => void;
  onChange: (patch: Partial<Loop>) => void;
  onRemove: () => void;
}) {
  const done = loop.status === "done";
  const dot = done ? "#9aa0a6" : loop.status === "paused" ? "#d9a441" : "#0d7a6e";
  return (
    <div className={`overflow-hidden rounded-xl border bg-surface ${done ? "border-border-subtle opacity-70" : "border-border"}`}>
      <div className="flex items-center gap-2 px-4 py-3">
        <button onClick={onToggleOpen} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
          <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-text-muted transition-transform ${open ? "rotate-90" : ""}`} strokeWidth={2.5} />
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: dot }} />
          <span className={`truncate text-sm font-semibold ${done ? "text-text-muted line-through" : "text-text-primary"}`}>{loop.name}</span>
          {loop.type === "open"
            ? <span className="inline-flex items-center gap-1 rounded-full bg-surface-warm px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted" title="Open loop: never ends"><InfinityIcon className="h-2.5 w-2.5" /> open</span>
            : <span className="rounded-full bg-surface-warm px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted" title="Closed loop: finishes when its condition is met">closed</span>}
          <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-text-muted/70">{CADENCE_LABEL[loop.cadence]}</span>
        </button>
        {!done && (
          <Toggle on={loop.enabled} onChange={(v) => onChange({ enabled: v })} label={`${loop.name} enabled`} />
        )}
      </div>
      {open && (
        <div className="space-y-3 border-t border-border-subtle px-4 py-3 text-[13px]">
          {loop.purpose && <p className="text-text-secondary">{loop.purpose}</p>}
          {loop.signals.length > 0 && (
            <Field label="Signals">
              <div className="flex flex-wrap gap-1.5">
                {loop.signals.map((s, i) => <span key={i} className="rounded-full border border-border-subtle bg-background px-2 py-0.5 font-mono text-[10px] text-text-secondary">{s}</span>)}
              </div>
            </Field>
          )}
          {loop.condition && <Field label="Condition"><span className="font-mono text-[12px] text-text-secondary">{loop.condition}</span></Field>}
          {loop.evaluation && <Field label="What good looks like"><span className="text-text-secondary">{loop.evaluation}</span></Field>}
          {loop.actions.length > 0 && (
            <Field label="Current actions">
              <ul className="space-y-0.5">
                {loop.actions.map((a, i) => <li key={i} className="flex items-start gap-1.5 text-text-secondary"><span className="text-accent">▸</span> {a}</li>)}
              </ul>
            </Field>
          )}
          {/* Controls */}
          <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-2.5">
            <select value={loop.cadence} onChange={(e) => onChange({ cadence: e.target.value as LoopCadence })} className="rounded-md border border-border bg-background px-2 py-1 text-xs" title="How often the runner evaluates this loop">
              {CADENCES.map((c) => <option key={c} value={c}>{CADENCE_LABEL[c]}</option>)}
            </select>
            <select value={loop.status} onChange={(e) => onChange({ status: e.target.value as Loop["status"] })} className="rounded-md border border-border bg-background px-2 py-1 text-xs" title="Loop status">
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="done">Done</option>
            </select>
            <button onClick={onRemove} title="Delete this loop" className="ml-auto flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-surface-warm hover:text-warn">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-text-muted">{label}</div>
      {children}
    </div>
  );
}
