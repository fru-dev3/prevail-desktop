// Autonomy — the user-facing control surface for the autonomous-agent engine.
// Its whole job is "complete transparency + the ability to stop": a global
// pause/kill brake, a pre-emptive action-policy editor (what classes of action
// the agent may take on its own), runnable playbooks with a live, stoppable
// step timeline, and the recent agent-activity ledger so nothing is hidden.
//
// Stream/stop mechanics mirror connectorrun.tsx exactly: a fresh per-run session
// id, a `<prefix>:line` / `<prefix>:done` listener pair, and abort_sessions(session)
// to kill an in-flight run.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity, AlertTriangle, BookText, Check, DollarSign, Eye, HelpCircle, KeyRound,
  Loader2, Pause, Pencil, Play, Send, ShieldCheck, Square, Trash2, X, Zap,
} from "lucide-react";
import { invoke, listen } from "./bridge";
import { relTime, titleCase } from "./format";
import { SettingsHeader } from "./sectionutil";
import { Toggle } from "./ui";

// ── Types ─────────────────────────────────────────────────────────────
type PolicyClass = "read" | "reversible" | "external_send" | "financial" | "irreversible" | "credential" | "unknown";
type Decision = "allow" | "ask" | "never";

interface AutonomyStatus {
  state: "active" | "paused";
  policy: Record<PolicyClass, Decision>;
  monthlyFinancialCapUsd: number | null;
}

interface Playbook { id: string; name: string; goal?: string }

// Action classes in ascending-risk order, each with a short human label + icon.
const POLICY_ROWS: { key: PolicyClass; label: string; desc: string; icon: typeof Eye }[] = [
  { key: "read",          label: "Read / fetch",         desc: "Look things up, pull in data.",            icon: Eye },
  { key: "reversible",    label: "Create / edit",        desc: "Make or change things that can be undone.", icon: Pencil },
  { key: "external_send", label: "Send / contact outside", desc: "Email, message, or post beyond the vault.", icon: Send },
  { key: "financial",     label: "Spend money",          desc: "Payments, purchases, transfers.",          icon: DollarSign },
  { key: "credential",    label: "Change credentials",   desc: "Rotate keys, passwords, access.",           icon: KeyRound },
  { key: "irreversible",  label: "Delete / destroy",     desc: "Permanent removal that can't be undone.",   icon: Trash2 },
  { key: "unknown",       label: "Uncategorized",        desc: "Anything that doesn't fit the above.",      icon: HelpCircle },
];

const DECISIONS: { id: Decision; label: string }[] = [
  { id: "allow", label: "Allow" },
  { id: "ask", label: "Ask" },
  { id: "never", label: "Never" },
];

// X2: the graduated tier this class+decision resolves to (mirrors the engine's
// classify_tier). Shows the user what will ACTUALLY happen: allowlisted classes
// run, reversible ones run sandboxed, only consequential ones stop for approval.
type Tier = "allow" | "sandbox" | "ask" | "block";
function tierFor(cls: PolicyClass, decision: Decision): Tier {
  if (decision === "never") return "block";
  if (decision === "allow") return "allow";
  if (cls === "read") return "allow";
  if (cls === "reversible") return "sandbox";
  return "ask"; // external_send / financial / irreversible / credential / unknown
}
const TIER_META: Record<Tier, { label: string; cls: string }> = {
  allow: { label: "runs", cls: "text-ok" },
  sandbox: { label: "sandboxed", cls: "text-ai" },
  ask: { label: "asks first", cls: "text-warn" },
  block: { label: "blocked", cls: "text-err" },
};

// ── Action policy: a 3-way segmented control per class ───────────────────
function PolicySegmented({ value, onChange, disabled }: { value: Decision; onChange: (d: Decision) => void; disabled?: boolean }) {
  const tint: Record<Decision, string> = {
    allow: "bg-ok/15 text-ok",
    ask: "bg-warn/15 text-warn",
    never: "bg-danger/15 text-danger",
  };
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-background p-0.5">
      {DECISIONS.map((d) => (
        <button
          key={d.id}
          type="button"
          disabled={disabled}
          onClick={() => onChange(d.id)}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
            value === d.id ? `${tint[d.id]} shadow-sm` : "text-text-muted hover:text-text-secondary"
          }`}
        >
          {d.label}
        </button>
      ))}
    </div>
  );
}

// ── Playbook run: live, stoppable step timeline (mirrors connectorrun.tsx) ─
interface PlaybookEvent {
  phase: "started" | "step" | "step_done" | "complete" | "error";
  index?: number;
  label?: string;
  ok?: boolean;
  decision?: string;
  note?: string;
  message?: string;
}

interface RunStep { index: number; label: string; decision?: string; ok?: boolean; note?: string; done: boolean }

// auto/allow → green, ask → amber, block/never → red.
function decisionBadge(decision?: string): { label: string; cls: string } | null {
  if (!decision) return null;
  const d = decision.toLowerCase();
  if (d === "auto" || d === "allow") return { label: "auto", cls: "border-ok/40 bg-ok/10 text-ok" };
  if (d === "ask") return { label: "ask", cls: "border-warn/40 bg-warn/10 text-warn" };
  if (d === "block" || d === "never" || d === "blocked") return { label: "block", cls: "border-danger/40 bg-danger/10 text-danger" };
  return { label: d, cls: "border-border bg-surface-warm text-text-secondary" };
}

function PlaybookRun({ playbook, onClose }: { playbook: Playbook; onClose: () => void }) {
  const [steps, setSteps] = useState<RunStep[]>([]);
  const [running, setRunning] = useState(true);
  const [final, setFinal] = useState<{ ok: boolean; message?: string } | null>(null);
  const sessionRef = useRef<string>("");
  const okRef = useRef<boolean | null>(null);
  const unsubsRef = useRef<Array<() => void>>([]);
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = `playbookrun-${crypto.randomUUID()}`;
      sessionRef.current = session;
      const prefix = "playbook_run";

      const unLine = await listen<{ session: string; stream?: string; data: PlaybookEvent | string }>(`${prefix}:line`, (e) => {
        const p = e.payload;
        if (p.session !== session || p.stream === "stderr") return;
        const data = p.data;
        if (!data || typeof data !== "object") return;
        const ev = data as PlaybookEvent;
        if ((ev.phase === "step" || ev.phase === "step_done") && typeof ev.index === "number") {
          setSteps((cur) => {
            const i = cur.findIndex((s) => s.index === ev.index);
            const merged: RunStep = {
              index: ev.index!,
              label: ev.label ?? (i >= 0 ? cur[i].label : `Step ${ev.index! + 1}`),
              decision: ev.decision ?? (i >= 0 ? cur[i].decision : undefined),
              ok: ev.ok ?? (i >= 0 ? cur[i].ok : undefined),
              note: ev.note ?? (i >= 0 ? cur[i].note : undefined),
              done: ev.phase === "step_done" || (i >= 0 ? cur[i].done : false),
            };
            if (i >= 0) { const next = [...cur]; next[i] = merged; return next; }
            return [...cur, merged].sort((a, b) => a.index - b.index);
          });
        }
        if (ev.phase === "complete" || ev.phase === "error") {
          const ok = ev.phase === "complete" && ev.ok !== false;
          okRef.current = ok;
          setFinal({ ok, message: ev.message ?? ev.note });
        }
      });
      const unDone = await listen<{ session: string; code: number | null }>(`${prefix}:done`, (e) => {
        if (e.payload.session !== session) return;
        setRunning(false);
        if (okRef.current === null) okRef.current = e.payload.code === 0;
      });
      unsubsRef.current = [unLine, unDone];
      if (cancelled) { unLine(); unDone(); return; }
      invoke("engine_run_playbook_stream", { id: playbook.id, session }).catch((err) => {
        okRef.current = false;
        setFinal({ ok: false, message: String(err) });
        setRunning(false);
      });
    })();
    return () => {
      cancelled = true;
      for (const u of unsubsRef.current) u();
      if (sessionRef.current) void invoke("abort_sessions", { prefix: sessionRef.current }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playbook.id]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [steps.length]);

  async function stop() {
    if (sessionRef.current) await invoke("abort_sessions", { prefix: sessionRef.current }).catch(() => {});
    setRunning(false);
  }

  return (
    <div className="mt-2 flex flex-col gap-3 rounded-lg border border-border bg-surface p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
          {running ? <Loader2 className="h-4 w-4 animate-spin text-accent" /> : final?.ok ? <Check className="h-4 w-4 text-ok" /> : <X className="h-4 w-4 text-danger" />}
          Running · {playbook.name}
        </div>
        {running ? (
          <button onClick={stop} className="inline-flex items-center gap-1.5 rounded-md border border-danger/40 bg-danger/10 px-2.5 py-1 text-xs font-medium text-danger transition-colors hover:bg-danger/20">
            <Square className="h-3 w-3" /> Stop
          </button>
        ) : (
          <button onClick={onClose} className="rounded-md border border-border px-2.5 py-1 text-xs text-text-secondary hover:bg-surface-warm">
            Close
          </button>
        )}
      </div>

      <div ref={logRef} className="max-h-64 overflow-y-auto rounded-md border border-border-subtle bg-surface-warm/40 p-2 text-[12px] leading-relaxed">
        {steps.length === 0 ? (
          <div className="flex items-center gap-1.5 text-text-muted"><Loader2 className="h-3 w-3 animate-spin" /> starting the playbook…</div>
        ) : (
          steps.map((s) => {
            const badge = decisionBadge(s.decision);
            return (
              <div key={s.index} className="flex items-start gap-2 py-0.5">
                <span className="mt-0.5 w-4 shrink-0 text-center">
                  {!s.done ? <Loader2 className="inline h-3 w-3 animate-spin text-text-muted" /> : s.ok === false ? <X className="inline h-3 w-3 text-danger" /> : <Check className="inline h-3 w-3 text-ok" />}
                </span>
                <span className="min-w-0 flex-1 break-words text-text-secondary">
                  <span className="text-text-primary">{s.label}</span>
                  {badge && <span className={`ml-1.5 rounded border px-1 py-px font-mono text-[9px] uppercase tracking-wider ${badge.cls}`}>{badge.label}</span>}
                  {s.note && <span className="block text-[11px] text-text-muted">{s.note}</span>}
                </span>
              </div>
            );
          })
        )}
      </div>

      {final && !running && (
        <div className={`rounded-md px-3 py-2 text-sm ${final.ok ? "border border-ok/40 bg-ok/10 text-ok" : "border border-danger/40 bg-danger/10 text-danger"}`}>
          {final.ok ? "✓ " : "✗ "}{final.message || (final.ok ? "Done" : "Stopped")}
        </div>
      )}
    </div>
  );
}

// ── Recent agent activity (reuses activity_read) ─────────────────────────
interface ActivityEvent { ts: number; type?: string; title: string; detail?: string; status?: string; [k: string]: unknown }

function RecentActivity({ vaultPath }: { vaultPath: string }) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [onlyPlaybooks, setOnlyPlaybooks] = useState(false);

  const load = useCallback(async () => {
    try {
      const rows = await invoke<ActivityEvent[]>("activity_read", { vault: vaultPath, limit: 60 });
      setEvents(Array.isArray(rows) ? rows : []);
    } catch { setEvents([]); }
    finally { setLoading(false); }
  }, [vaultPath]);

  useEffect(() => {
    load();
    const iv = window.setInterval(load, 15000);
    const onChange = () => load();
    window.addEventListener("prevail:loops-advanced", onChange);
    return () => { window.clearInterval(iv); window.removeEventListener("prevail:loops-advanced", onChange); };
  }, [load]);

  const isPlaybook = (e: ActivityEvent) => (e.type ?? "").startsWith("playbook");
  const shown = onlyPlaybooks ? events.filter(isPlaybook) : events;

  return (
    <section>
      <div className="mb-1.5 flex items-center justify-between">
        <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">Recent agent activity</div>
        <button
          onClick={() => setOnlyPlaybooks((v) => !v)}
          className={`rounded-md border px-2 py-0.5 text-[10px] font-medium transition-colors ${onlyPlaybooks ? "border-accent-border bg-accent-soft text-accent" : "border-border text-text-muted hover:text-text-secondary"}`}
        >
          Playbooks only
        </button>
      </div>
      {loading ? (
        <div className="text-sm text-text-muted">loading activity…</div>
      ) : shown.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface p-5 text-center text-sm text-text-secondary">
          {onlyPlaybooks ? "No playbook runs recorded yet." : "No agent activity recorded yet."}
        </div>
      ) : (
        <ul className="space-y-1.5">
          {shown.map((e, i) => {
            const pb = isPlaybook(e);
            const err = e.status === "error";
            return (
              <li key={`${e.ts}-${i}`} className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 ${pb ? "border-accent-border bg-accent-soft/15" : "border-border-subtle bg-surface"}`}>
                <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${err ? "bg-danger/10 text-danger" : pb ? "bg-accent-soft text-accent" : "bg-surface-warm text-text-muted"}`}>
                  {pb ? <BookText className="h-3 w-3" /> : <Activity className="h-3 w-3" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-text-muted">
                    {e.type && <span className={pb ? "text-accent" : ""}>{titleCase(e.type.replace(/_/g, " "))}</span>}
                    <span>{relTime(e.ts)}</span>
                    {err && <span className="text-danger">failed</span>}
                  </div>
                  <div className="mt-0.5 text-[13px] leading-snug text-text-primary">{e.title}</div>
                  {e.detail && <div className="mt-0.5 text-[12px] leading-relaxed text-text-muted">{e.detail}</div>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ── The panel ────────────────────────────────────────────────────────────
export function AutonomyPanel({ vaultPath }: { vaultPath: string }) {
  const [status, setStatus] = useState<AutonomyStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [running, setRunning] = useState<Playbook | null>(null);
  // X4: real month-to-date spend, so the cap reads against actual usage.
  const [spentUsd, setSpentUsd] = useState<number | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const s = await invoke<AutonomyStatus>("engine_autonomy_status");
      setStatus(s);
      setErr(null);
    } catch (e) { setErr(`Couldn't read autonomy status: ${String(e).slice(0, 160)}`); }
  }, []);

  useEffect(() => {
    void loadStatus();
    void invoke<Playbook[]>("engine_list_playbooks").then((p) => setPlaybooks(Array.isArray(p) ? p : [])).catch(() => setPlaybooks([]));
    void invoke<{ spent_usd?: number }>("engine_budget_status", { vault: vaultPath, domain: null })
      .then((b) => { if (typeof b?.spent_usd === "number") setSpentUsd(b.spent_usd); })
      .catch(() => {});
  }, [loadStatus, vaultPath]);

  const paused = status?.state === "paused";

  const toggleBrake = useCallback(async (active: boolean) => {
    setBusy(true);
    // Optimistic flip so the big switch feels instant; reconcile from the result.
    setStatus((s) => (s ? { ...s, state: active ? "active" : "paused" } : s));
    try {
      const r = await invoke<{ ok: boolean; state: string }>("engine_autonomy_set", { state: active ? "resume" : "pause" });
      if (r?.state) setStatus((s) => (s ? { ...s, state: r.state === "paused" ? "paused" : "active" } : s));
      setErr(null);
    } catch (e) {
      setErr(`Couldn't change autonomy: ${String(e).slice(0, 160)}`);
      await loadStatus();
    } finally { setBusy(false); }
  }, [loadStatus]);

  const setPolicy = useCallback(async (cls: PolicyClass, decision: Decision) => {
    const prev = status?.policy[cls];
    setStatus((s) => (s ? { ...s, policy: { ...s.policy, [cls]: decision } } : s));
    try {
      await invoke("engine_autonomy_policy", { class: cls, decision });
      setErr(null);
    } catch (e) {
      setErr(`Couldn't update policy: ${String(e).slice(0, 160)}`);
      if (prev) setStatus((s) => (s ? { ...s, policy: { ...s.policy, [cls]: prev } } : s));
    }
  }, [status]);

  return (
    <div className="w-full space-y-6">
      <SettingsHeader
        icon={ShieldCheck}
        title="Autonomy"
        subtitle="Complete control over what agents do on their own. Pause everything with one switch, set what whole classes of action are allowed pre-emptively, run playbooks with a live timeline you can stop, and see everything the agents have done."
      />

      {err && (
        <div className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{err}
        </div>
      )}

      {/* Global brake */}
      <section className={`rounded-xl border p-4 ${paused ? "border-danger/40 bg-danger/5" : "border-accent-border bg-accent-soft/15"}`}>
        <div className="flex items-center gap-3">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${paused ? "bg-danger/10 text-danger" : "bg-accent-soft text-accent"}`}>
            {paused ? <Pause className="h-5 w-5" /> : <Zap className="h-5 w-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-display text-lg font-bold tracking-tight text-text-primary">
              Autonomy: {paused ? "Paused" : "Active"}
            </div>
            <div className="text-xs text-text-secondary">
              {paused ? "Agents will not take any action on their own." : "Agents act on their own within the policy below."}
            </div>
          </div>
          <Toggle on={!paused} onChange={(v) => void toggleBrake(v)} disabled={busy || !status} label="Autonomy" />
        </div>
        {paused && (
          <div className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-medium text-danger">
            All autonomous action is paused.
          </div>
        )}
      </section>

      {/* Action policy */}
      <section>
        <div className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">Action policy</div>
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          {POLICY_ROWS.map((row, i) => {
            const Icon = row.icon;
            const value = status?.policy[row.key];
            return (
              <div key={row.key} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? "border-t border-border-subtle" : ""}`}>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-warm text-text-muted"><Icon className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-text-primary">{row.label}</div>
                  <div className="text-xs text-text-muted">{row.desc}</div>
                </div>
                {(() => { const t = tierFor(row.key, value ?? "ask"); return (
                  <span title="What actually happens with this setting (graduated brake)" className={`shrink-0 font-mono text-[10px] uppercase tracking-wider ${TIER_META[t].cls}`}>{TIER_META[t].label}</span>
                ); })()}
                <PolicySegmented value={value ?? "ask"} disabled={!status} onChange={(d) => void setPolicy(row.key, d)} />
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-text-muted">
          Destructive and credential changes default to Never; money and outbound messages to Ask.
          {typeof status?.monthlyFinancialCapUsd === "number" && (() => {
            const cap = status.monthlyFinancialCapUsd as number;
            const over = spentUsd !== null && cap > 0 && spentUsd >= cap;
            const warn = spentUsd !== null && cap > 0 && spentUsd >= cap * 0.8;
            return (
              <> Monthly spend cap: <span className={`font-mono ${over ? "text-err" : warn ? "text-warn" : "text-text-secondary"}`}>
                {spentUsd !== null ? `$${spentUsd.toFixed(2)} of $${cap}` : `$${cap}`}
              </span>{over ? " — cap reached." : "."}</>
            );
          })()}
        </p>
      </section>

      {/* Playbooks */}
      <section>
        <div className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">Playbooks</div>
        {playbooks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-surface p-5 text-center text-sm text-text-secondary">
            No playbooks available yet.
          </div>
        ) : (
          <div className="space-y-2">
            {playbooks.map((pb) => {
              const isRunning = running?.id === pb.id;
              return (
                <div key={pb.id} className="rounded-xl border border-border bg-surface p-3">
                  <div className="flex items-start gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent"><BookText className="h-4 w-4" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-text-primary">{pb.name}</div>
                      {pb.goal && <div className="text-xs text-text-muted">{pb.goal}</div>}
                    </div>
                    <button
                      onClick={() => setRunning(pb)}
                      disabled={isRunning || paused}
                      title={paused ? "Resume autonomy to run playbooks" : undefined}
                      className="inline-flex items-center gap-1.5 rounded-md border border-accent-border bg-accent-soft/40 px-3 py-1.5 text-xs font-semibold text-accent transition-colors hover:bg-accent-soft disabled:opacity-50"
                    >
                      <Play className="h-3.5 w-3.5" /> Run
                    </button>
                  </div>
                  {isRunning && <PlaybookRun playbook={pb} onClose={() => setRunning(null)} />}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <RecentActivity vaultPath={vaultPath} />
    </div>
  );
}
