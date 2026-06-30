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

// ── Types ─────────────────────────────────────────────────────────────
type PolicyClass = "read" | "reversible" | "external_send" | "financial" | "irreversible" | "credential" | "unknown";
type Decision = "allow" | "ask" | "never";

type AutonomyMode = "paused" | "ask" | "auto";

interface AutonomyStatus {
  state: AutonomyMode;
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

// Monthly spend cap: default to $50 (not "no cap"), with a slider that tops out
// at a sensible $1,000. "No cap" remains reachable via an explicit toggle.
const DEFAULT_CAP = 50;
const CAP_MAX = 1000;
const CAP_STEP = 10;

// ── Action policy: a 3-way segmented control per class ───────────────────
function PolicySegmented({ value, onChange, disabled }: { value: Decision; onChange: (d: Decision) => void; disabled?: boolean }) {
  // Selected = solid, semantically colored fill with contrasting text so the
  // active choice reads at a glance. Allow = green, Ask = amber, Never = red.
  const selected: Record<Decision, string> = {
    allow: "bg-ok text-background shadow-sm hover:bg-ok/90",
    ask: "bg-warn text-background shadow-sm hover:bg-warn/90",
    never: "bg-err text-background shadow-sm hover:bg-err/90",
  };
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-background p-0.5">
      {DECISIONS.map((d) => (
        <button
          key={d.id}
          type="button"
          disabled={disabled}
          onClick={() => onChange(d.id)}
          className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${
            value === d.id ? selected[d.id] : "font-medium text-text-muted hover:text-text-secondary"
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
  if (d === "block" || d === "never" || d === "blocked") return { label: "block", cls: "border-err/40 bg-err/10 text-err" };
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
          {running ? <Loader2 className="h-4 w-4 animate-spin text-accent" /> : final?.ok ? <Check className="h-4 w-4 text-ok" /> : <X className="h-4 w-4 text-err" />}
          Running · {playbook.name}
        </div>
        {running ? (
          <button onClick={stop} className="inline-flex items-center gap-1.5 rounded-md border border-err/40 bg-err/10 px-2.5 py-1 text-xs font-medium text-err transition-colors hover:bg-err/20">
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
                  {!s.done ? <Loader2 className="inline h-3 w-3 animate-spin text-text-muted" /> : s.ok === false ? <X className="inline h-3 w-3 text-err" /> : <Check className="inline h-3 w-3 text-ok" />}
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
        <div className={`rounded-md px-3 py-2 text-sm ${final.ok ? "border border-ok/40 bg-ok/10 text-ok" : "border border-err/40 bg-err/10 text-err"}`}>
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
                <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${err ? "bg-err/10 text-err" : pb ? "bg-accent-soft text-accent" : "bg-surface-warm text-text-muted"}`}>
                  {pb ? <BookText className="h-3 w-3" /> : <Activity className="h-3 w-3" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-text-muted">
                    {e.type && <span className={pb ? "text-accent" : ""}>{titleCase(e.type.replace(/_/g, " "))}</span>}
                    <span>{relTime(e.ts)}</span>
                    {err && <span className="text-err">failed</span>}
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
  const [capDraft, setCapDraft] = useState<string>(String(DEFAULT_CAP));
  const [noCap, setNoCap] = useState(false);

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
  }, [loadStatus]);

  // Keep the cap controls in sync with the loaded status. A null cap means
  // "no cap" is on; we still keep a sensible numeric draft ($50 default) so the
  // slider and input have a value ready the moment the user turns the cap back on.
  useEffect(() => {
    if (!status) return;
    const cap = status.monthlyFinancialCapUsd;
    setNoCap(cap == null);
    setCapDraft(cap == null ? String(DEFAULT_CAP) : String(cap));
  }, [status?.monthlyFinancialCapUsd]);

  const mode: AutonomyMode = status?.state ?? "ask";
  const paused = mode === "paused";

  const setMode = useCallback(async (next: AutonomyMode) => {
    setBusy(true);
    const prev = status?.state;
    setStatus((s) => (s ? { ...s, state: next } : s)); // optimistic
    try {
      const r = await invoke<{ ok: boolean; state: string }>("engine_autonomy_set", { state: next });
      if (r?.state) setStatus((s) => (s ? { ...s, state: r.state as AutonomyMode } : s));
      setErr(null);
    } catch (e) {
      setErr(`Couldn't change autonomy: ${String(e).slice(0, 160)}`);
      if (prev) setStatus((s) => (s ? { ...s, state: prev } : s));
    } finally { setBusy(false); }
  }, [status]);

  const saveCap = useCallback(async (raw: string) => {
    const cap = raw.trim() === "" || raw.trim().toLowerCase() === "off" ? "off" : String(Number(raw.replace(/[^0-9.]/g, "")) || 0);
    try {
      const r = await invoke<{ monthlyFinancialCapUsd: number | null }>("engine_autonomy_cap", { cap });
      setStatus((s) => (s ? { ...s, monthlyFinancialCapUsd: r?.monthlyFinancialCapUsd ?? null } : s));
      setErr(null);
    } catch (e) { setErr(`Couldn't set cap: ${String(e).slice(0, 160)}`); }
  }, []);

  // Set a concrete dollar cap (clamped at 0) from the slider or the number input.
  const commitCap = useCallback((raw: string) => {
    const n = Math.max(0, Number(raw.replace(/[^0-9.]/g, "")) || 0);
    setCapDraft(String(n));
    setNoCap(false);
    void saveCap(String(n));
  }, [saveCap]);

  // Toggle the "no cap" state. Turning it off restores the numeric draft (>= $50).
  const toggleNoCap = useCallback((off: boolean) => {
    if (off) {
      setNoCap(true);
      void saveCap("off");
    } else {
      const v = Number(capDraft.replace(/[^0-9.]/g, "")) || DEFAULT_CAP;
      setNoCap(false);
      setCapDraft(String(v));
      void saveCap(String(v));
    }
  }, [capDraft, saveCap]);

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
        <div className="flex items-start gap-2 rounded-lg border border-err/40 bg-err/10 px-3 py-2 text-sm text-err">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{err}
        </div>
      )}

      {/* Global brake — one master mode */}
      <section className={`rounded-xl border p-4 ${paused ? "border-err/40 bg-err/5" : mode === "auto" ? "border-accent-border bg-accent-soft/15" : "border-border bg-surface"}`}>
        <div className="mb-3 flex items-center gap-3">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${paused ? "bg-err/10 text-err" : mode === "auto" ? "bg-accent-soft text-accent" : "bg-surface-warm text-text-muted"}`}>
            {paused ? <Pause className="h-5 w-5" /> : mode === "auto" ? <Zap className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-display text-lg font-bold tracking-tight text-text-primary">Autonomy</div>
            <div className="text-xs text-text-secondary">
              {paused ? "Agents will not take any action on their own." : mode === "auto" ? "Agents run allowed actions on their own; the policy below still governs money, sends, and deletes." : "Agents propose actions and wait for your approval. Nothing runs on its own."}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-background p-0.5">
          {([
            { k: "paused", label: "Paused", hint: "Kill switch" },
            { k: "ask", label: "Ask first", hint: "Approve each" },
            { k: "auto", label: "Automatic", hint: "Run allowed" },
          ] as { k: AutonomyMode; label: string; hint: string }[]).map((m) => (
            <button key={m.k} onClick={() => void setMode(m.k)} disabled={busy || !status}
              className={`flex flex-col items-center rounded-md px-2 py-2 text-xs font-semibold transition-colors disabled:opacity-50 ${mode === m.k ? (m.k === "paused" ? "bg-err text-background shadow-sm" : m.k === "auto" ? "bg-accent text-background shadow-sm" : "bg-warn text-background shadow-sm") : "text-text-muted hover:text-text-secondary"}`}>
              {m.label}
              <span className="mt-0.5 text-[10px] font-normal opacity-80">{m.hint}</span>
            </button>
          ))}
        </div>
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
                <PolicySegmented value={value ?? "ask"} disabled={!status} onChange={(d) => void setPolicy(row.key, d)} />
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-text-muted">
          Destructive and credential changes default to Never; money and outbound messages to Ask.
        </p>
        {(() => {
          const sliderVal = Math.min(CAP_MAX, Math.max(0, Number(capDraft.replace(/[^0-9.]/g, "")) || 0));
          return (
            <div className="mt-3 rounded-xl border border-border bg-surface p-4">
              <div className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-warm text-text-muted"><DollarSign className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-text-primary">Monthly spend cap</div>
                  <div className="text-xs text-text-muted">An auto-approved financial action that would push the month past this asks for approval instead.</div>
                </div>
                <button
                  type="button"
                  onClick={() => toggleNoCap(!noCap)}
                  disabled={!status}
                  className={`shrink-0 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-50 ${noCap ? "border-accent-border bg-accent-soft text-accent" : "border-border text-text-muted hover:text-text-secondary"}`}
                >
                  No cap
                </button>
              </div>

              <div className={`mt-3 flex items-center gap-3 ${noCap ? "opacity-40" : ""}`}>
                <input
                  type="range"
                  min={0}
                  max={CAP_MAX}
                  step={CAP_STEP}
                  value={sliderVal}
                  disabled={!status || noCap}
                  onChange={(e) => setCapDraft(e.target.value)}
                  onMouseUp={(e) => commitCap((e.target as HTMLInputElement).value)}
                  onTouchEnd={(e) => commitCap((e.target as HTMLInputElement).value)}
                  onKeyUp={(e) => commitCap((e.target as HTMLInputElement).value)}
                  aria-label="Monthly spend cap"
                  className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-surface-warm accent-accent disabled:cursor-not-allowed"
                />
                <div className="flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2 py-1 focus-within:border-accent-border">
                  <span className="text-sm text-text-muted">$</span>
                  <input
                    value={noCap ? "" : capDraft}
                    onChange={(e) => setCapDraft(e.target.value)}
                    onBlur={() => commitCap(capDraft)}
                    onKeyDown={(e) => { if (e.key === "Enter") commitCap(capDraft); }}
                    inputMode="decimal"
                    placeholder={noCap ? "off" : String(DEFAULT_CAP)}
                    disabled={!status || noCap}
                    className="w-16 bg-transparent text-right text-sm text-text-primary placeholder:text-text-muted/60 focus:outline-none disabled:cursor-not-allowed"
                  />
                </div>
              </div>
              <div className="mt-1.5 text-[11px] text-text-muted">
                {noCap ? "No monthly limit. Each auto-approved spend still follows the policy above." : `Asks for approval above $${sliderVal} per month. Slider tops out at $${CAP_MAX}.`}
              </div>
            </div>
          );
        })()}
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
