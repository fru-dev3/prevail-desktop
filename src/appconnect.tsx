// Connect an app by describing the goal — no tier dropdowns, no auth forms.
// The user types the app name + what they want from it; the Connection Agent
// (engine) researches the best method and returns a plan + the ONE auth step.
// See docs/APPS-REDESIGN.md.
import { useState } from "react";
import { ArrowRight, Check, Loader2, Sparkles, X } from "lucide-react";
import { invoke } from "./bridge";
import { titleCase } from "./format";
import { PREF, getPref } from "./storage";

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
          <div className="flex items-center gap-2">
            <button
              onClick={find} disabled={busy || !name.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-1.5 text-sm font-semibold text-background hover:bg-accent-hover disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {busy ? "Finding the best way to connect…" : "Find the best way to connect"}
            </button>
            <span className="text-[11px] text-text-muted">Prevail researches MCP, API, CLI, Composio, or browser — and picks the best.</span>
          </div>
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
