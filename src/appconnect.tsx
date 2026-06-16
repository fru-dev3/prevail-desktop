// Connect an app by describing the goal — no tier dropdowns, no auth forms.
// The user types the app name + what they want from it; the Connection Agent
// (engine) researches the best method and returns a plan + the ONE auth step.
// See docs/APPS-REDESIGN.md.
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, Link2, Loader2, Sparkles, X } from "lucide-react";
import { invoke } from "./bridge";
import { titleCase } from "./format";
import { PREF, getPref } from "./storage";
import type { EngineApp } from "./types";

type Plan = {
  app_id?: string;
  title?: string;
  integration?: string;
  why?: string;
  auth_step?: { kind?: string; instruction?: string };
  schedule?: { every?: string };
  domains?: string[];
  data?: string;
};
type ConnectResult = { ok: boolean; plan?: Plan; error?: string; raw?: string };

const METHOD_LABEL: Record<string, string> = {
  mcp: "MCP server", api: "API", oauth: "API (OAuth)", cli: "CLI", composio: "Composio", browser: "Browser automation", manual: "Manual",
};

export function ConnectAppFlow({ vaultPath, onDone, onCancel }: { vaultPath: string; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ConnectResult | null>(null);
  // While the engine researches (one long async call), cycle a visible status so
  // it's clear work is happening — a button spinner alone reads as "stuck".
  const RESEARCH_PHASES = [
    "Reading what you want to pull in…",
    "Checking for an MCP server…",
    "Checking the official API…",
    "Checking a local CLI…",
    "Checking Composio connectors…",
    "Considering browser automation…",
    "Picking the best method for you…",
  ];
  const [phaseIdx, setPhaseIdx] = useState(0);
  useEffect(() => {
    if (!busy) { setPhaseIdx(0); return; }
    const id = window.setInterval(() => setPhaseIdx((i) => Math.min(i + 1, RESEARCH_PHASES.length - 1)), 1400);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);
  // APP-2: IntelliSense — match what's typed against already-connected apps so we
  // REUSE an existing one instead of silently creating a duplicate. (No dropdown;
  // a single inline match that the user can open, or override to connect anew.)
  const [existing, setExisting] = useState<EngineApp[]>([]);
  useEffect(() => { void invoke<EngineApp[]>("engine_apps_list").then((l) => setExisting(Array.isArray(l) ? l : [])).catch(() => {}); }, []);
  const match = useMemo(() => {
    const q = name.trim().toLowerCase();
    if (q.length < 2) return null;
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const nq = norm(q);
    return existing.find((a) => {
      const t = norm(a.title || ""); const id = norm(a.id || "");
      return t === nq || id === nq || (nq.length >= 3 && (t.includes(nq) || id.includes(nq) || nq.includes(t)));
    }) ?? null;
  }, [name, existing]);

  const find = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      const provider = getPref(PREF.memoryProvider, "claude");
      const model = getPref(PREF.distillModel, "claude-haiku-4-5");
      const r = await invoke<ConnectResult>("engine_app_connect", { name: name.trim(), goal: goal.trim(), vault: vaultPath, provider, model });
      setResult(r);
    } catch (e) {
      setResult({ ok: false, error: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const plan = result?.plan;
  const authNeeded = plan?.auth_step && plan.auth_step.kind && plan.auth_step.kind !== "none" && (plan.auth_step.instruction ?? "").trim() !== "";

  return (
    <div className="mb-5 rounded-xl border border-accent-border bg-accent-soft/20 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
          <Sparkles className="h-4 w-4 text-accent" /> Connect an app
        </div>
        <button onClick={onCancel} className="rounded p-1 text-text-muted hover:text-text-primary" title="Cancel"><X className="h-4 w-4" /></button>
      </div>

      {!result && (
        <div className="space-y-2">
          <input
            autoFocus value={name} onChange={(e) => setName(e.target.value)}
            placeholder="App name (e.g. AllTrails, Gmail, PayPal)"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-border"
          />
          <textarea
            value={goal} onChange={(e) => setGoal(e.target.value)}
            placeholder="What should it pull in, and into which domain? (e.g. my completed hikes and saved trails into Health, weekly)"
            rows={2}
            className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm leading-relaxed text-text-primary outline-none focus:border-accent-border"
          />
          {/* APP-2: already-connected match — reuse instead of duplicating. */}
          {match && (
            <div className="flex items-center gap-2 rounded-lg border border-accent-border bg-accent-soft/40 px-3 py-2">
              <Link2 className="h-3.5 w-3.5 shrink-0 text-accent" />
              <span className="min-w-0 flex-1 text-xs text-text-secondary">
                <span className="font-semibold text-text-primary">{match.title || match.id}</span> is already connected. Open it instead of creating a duplicate.
              </span>
              <button onClick={() => { window.dispatchEvent(new CustomEvent("prevail:app-open", { detail: match.id })); onCancel(); }}
                className="shrink-0 rounded-md border border-accent-border bg-accent px-2.5 py-1 text-xs font-semibold text-background hover:opacity-90">
                Open {match.title || match.id}
              </button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={find} disabled={busy || !name.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-1.5 text-sm font-semibold text-background hover:bg-accent-hover disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {busy ? "Finding the best way to connect…" : match ? "Connect a new one anyway" : "Find the best way to connect"}
            </button>
            <span className="text-[11px] text-text-muted">Prevail researches MCP, API, CLI, Composio, or browser — and picks the best.</span>
          </div>
          {busy && (
            <div className="mt-3 rounded-lg border border-accent-border/40 bg-accent-soft/20 p-3">
              <div className="flex items-center gap-2 text-sm font-medium text-accent">
                <Loader2 className="h-4 w-4 animate-spin" /> Working on it…
              </div>
              <div className="mt-2 space-y-1">
                {RESEARCH_PHASES.map((p, i) => (
                  <div key={i} className={`flex items-center gap-2 text-xs ${i < phaseIdx ? "text-text-muted" : i === phaseIdx ? "text-text-primary" : "text-text-muted/40"}`}>
                    <span className="w-3 shrink-0 text-center">{i < phaseIdx ? "✓" : i === phaseIdx ? "▸" : "·"}</span>
                    {p}
                  </div>
                ))}
              </div>
              <div className="mt-2 text-[11px] text-text-muted">This runs a model to research + test the best path — usually 10–30s.</div>
            </div>
          )}
        </div>
      )}

      {result && !result.ok && (
        <div className="space-y-2">
          <div className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
            Couldn't establish a connection: {result.error ?? "no method found"}.
          </div>
          <button onClick={() => setResult(null)} className="rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary hover:border-accent-border hover:text-accent">Try again</button>
        </div>
      )}

      {result?.ok && plan && (
        <div className="space-y-3">
          <div className="rounded-lg border border-border-subtle bg-background p-3">
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 text-ok" />
              <span className="text-sm font-semibold text-text-primary">{plan.title || name}</span>
              <span className="rounded border border-border-subtle px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-text-muted">{METHOD_LABEL[plan.integration ?? "manual"] ?? plan.integration}</span>
            </div>
            {plan.why && <p className="mt-1.5 text-xs text-text-secondary">{plan.why}</p>}
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-text-muted">
              {plan.data && <span>pulls: {plan.data}</span>}
              {plan.schedule?.every && <span>· every {plan.schedule.every}</span>}
              {(plan.domains ?? []).length > 0 && <span>· feeds {plan.domains!.map(titleCase).join(", ")}</span>}
            </div>
          </div>

          {authNeeded ? (
            <div className="rounded-lg border border-accent-border bg-accent-soft/40 p-3">
              <div className="font-mono text-[10px] uppercase tracking-wider text-accent">One step to authorize</div>
              <p className="mt-1 text-sm text-text-primary">{plan.auth_step!.instruction}</p>
              <p className="mt-1 text-[11px] text-text-muted">Do this once, then mark it done — Prevail will sync on schedule from then on.</p>
            </div>
          ) : (
            <div className="rounded-lg border border-ok/30 bg-ok/5 px-3 py-2 text-xs text-ok">No authorization needed — it's ready to sync.</div>
          )}

          <div className="flex items-center gap-2">
            <button onClick={onDone} className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-1.5 text-sm font-semibold text-background hover:bg-accent-hover">
              {authNeeded ? "I've done it — finish" : "Done"} <ArrowRight className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => { setResult(null); setName(""); setGoal(""); }} className="rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary hover:border-accent-border hover:text-accent">Connect another</button>
          </div>
        </div>
      )}
    </div>
  );
}
