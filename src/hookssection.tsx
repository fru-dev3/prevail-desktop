// Hooks (Editor → Connections). Run your own shell command when a Prevail event
// fires. Backed by the hooks_read/hooks_write/hooks_run engine commands; hooks
// live in <vault>/hooks.json and the engine fires them at their source
// (task.created, chat.reply). "Manual" hooks only run via the Run button.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Play, Plus, Power, Trash2, Webhook, X } from "lucide-react";
import { invoke } from "./bridge";
import { titleCase } from "./format";
import { SettingsHeader } from "./sectionutil";
import type { Domain } from "./types";

interface Hook {
  id: string;
  name: string;
  event: string;
  command: string;
  enabled: boolean;
  domain?: string | null;
}

const EVENTS: Array<{ id: string; label: string; auto: boolean }> = [
  { id: "task.created", label: "When a task is created", auto: true },
  { id: "chat.reply", label: "When a chat reply lands", auto: true },
  { id: "manual", label: "Manual only (run on demand)", auto: false },
];
const eventLabel = (id: string) => EVENTS.find((e) => e.id === id)?.label ?? id;

function newHookId(): string {
  return `h_${Date.now().toString(36)}_${Math.floor(performance.now() % 1e6).toString(36)}`;
}

export function HooksSection({ vaultPath }: { vaultPath: string }) {
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState<Hook | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [runOut, setRunOut] = useState<{ id: string; text: string } | null>(null);
  const [running, setRunning] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!vaultPath) return;
    try {
      const list = await invoke<Hook[]>("hooks_read", { vault: vaultPath }).catch(() => [] as Hook[]);
      setHooks(Array.isArray(list) ? list : []);
    } finally {
      setLoaded(true);
    }
  }, [vaultPath]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { invoke<Domain[]>("scan_vault", { path: vaultPath }).then((d) => setDomains((d ?? []).filter((x) => !x.name.startsWith("_")))).catch(() => {}); }, [vaultPath]);

  const persist = useCallback(async (next: Hook[]) => {
    setHooks(next);
    await invoke("hooks_write", { vault: vaultPath, hooks: next }).catch((e) => { console.error("hooks_write", e); setErr(String(e)); });
  }, [vaultPath]);

  const startAdd = () => { setErr(null); setDraft({ id: newHookId(), name: "", event: "task.created", command: "", enabled: true, domain: null }); };
  const startEdit = (h: Hook) => { setErr(null); setDraft({ ...h }); };

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) { setErr("Give the hook a name."); return; }
    if (!draft.command.trim()) { setErr("Enter a command to run."); return; }
    const clean: Hook = { ...draft, name: draft.name.trim(), command: draft.command.trim(), domain: draft.domain || null };
    const exists = hooks.some((h) => h.id === clean.id);
    await persist(exists ? hooks.map((h) => (h.id === clean.id ? clean : h)) : [...hooks, clean]);
    setDraft(null);
  };

  const toggle = (h: Hook) => void persist(hooks.map((x) => (x.id === h.id ? { ...x, enabled: !x.enabled } : x)));
  const remove = (h: Hook) => void persist(hooks.filter((x) => x.id !== h.id));

  const runNow = async (h: Hook) => {
    setRunning(h.id);
    setRunOut(null);
    try {
      const out = await invoke<string>("hooks_run", { vault: vaultPath, id: h.id });
      setRunOut({ id: h.id, text: out || "(no output)" });
    } catch (e) {
      setRunOut({ id: h.id, text: `Error: ${e}` });
    } finally {
      setRunning(null);
    }
  };

  const empty = loaded && hooks.length === 0 && !draft;
  const eventEnv = useMemo(() => "Available to your command as env vars: PREVAIL_HOOK_EVENT, PREVAIL_HOOK_NAME, PREVAIL_HOOK_DOMAIN, PREVAIL_VAULT.", []);

  return (
    <>
      <SettingsHeader
        title="Hooks"
        icon={Webhook}
        subtitle="Run your own shell command when something happens in Prevail (a task is created, a chat reply lands) or on demand. Commands run on this machine."
        right={!draft ? (
          <button onClick={startAdd} className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-background hover:bg-accent-hover">
            <Plus className="h-4 w-4" /> Add hook
          </button>
        ) : undefined}
      />

      {draft && (
        <div className="mb-4 max-w-xl rounded-lg border border-border bg-surface-warm p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-display text-base font-semibold text-text-primary">{hooks.some((h) => h.id === draft.id) ? "Edit hook" : "New hook"}</h3>
            <button onClick={() => { setDraft(null); setErr(null); }} className="rounded p-1 text-text-muted hover:text-text-primary"><X className="h-4 w-4" /></button>
          </div>
          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-text-muted">Name</label>
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Notify on new task" className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-accent-border focus:outline-none" />
            </div>
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-text-muted">When</label>
              <select value={draft.event} onChange={(e) => setDraft({ ...draft, event: e.target.value })} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-accent-border focus:outline-none">
                {EVENTS.map((ev) => <option key={ev.id} value={ev.id}>{ev.label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-text-muted">Domain <span className="text-text-muted/60">(optional, all if blank)</span></label>
              <select value={draft.domain ?? ""} onChange={(e) => setDraft({ ...draft, domain: e.target.value || null })} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-accent-border focus:outline-none">
                <option value="">All domains</option>
                {domains.map((d) => <option key={d.name} value={d.name}>{titleCase(d.name)}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-text-muted">Command</label>
              <textarea value={draft.command} onChange={(e) => setDraft({ ...draft, command: e.target.value })} placeholder={'e.g. echo "$PREVAIL_HOOK_EVENT in $PREVAIL_HOOK_DOMAIN" >> ~/prevail-hooks.log'} rows={2} className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 font-mono text-[13px] focus:border-accent-border focus:outline-none" />
              <p className="mt-1 text-[11px] text-text-muted">{eventEnv}</p>
            </div>
            {err && <div className="text-xs text-err">{err}</div>}
            <div className="flex justify-end gap-2">
              <button onClick={() => { setDraft(null); setErr(null); }} className="rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-strong">Cancel</button>
              <button onClick={() => void save()} className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-background hover:bg-accent-hover">Save hook</button>
            </div>
          </div>
        </div>
      )}

      {!draft && err && <div className="mb-3 text-xs text-err">{err}</div>}

      {empty && (
        <div className="max-w-xl rounded-lg border border-dashed border-border bg-surface-warm p-6 text-center">
          <Webhook className="mx-auto mb-2 h-7 w-7 text-text-muted opacity-50" />
          <p className="text-sm text-text-secondary">No hooks yet. Add one to run a command when a task is created, a chat reply lands, or on demand.</p>
        </div>
      )}

      <ul className="grid max-w-xl grid-cols-1 gap-2">
        {hooks.map((h) => (
          <li key={h.id} className={`rounded-lg border bg-surface p-3 ${h.enabled ? "border-border-subtle" : "border-border-subtle opacity-60"}`}>
            <div className="flex items-start gap-3">
              <Webhook className={`mt-0.5 h-4 w-4 shrink-0 ${h.enabled ? "text-accent" : "text-text-muted"}`} />
              <div className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="truncate text-sm font-semibold text-text-primary">{h.name}</span>
                <span className="truncate text-[11px] text-text-muted">
                  {eventLabel(h.event)}{h.domain ? ` · ${titleCase(h.domain)}` : ""}
                </span>
                <code className="mt-1 truncate rounded bg-surface-warm px-1.5 py-0.5 font-mono text-[11px] text-text-secondary" title={h.command}>{h.command}</code>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button onClick={() => void runNow(h)} disabled={running === h.id} title="Run now" className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-warm hover:text-accent disabled:opacity-50"><Play className="h-3.5 w-3.5" /></button>
                <button onClick={() => toggle(h)} title={h.enabled ? "Disable" : "Enable"} className={`flex h-8 w-8 items-center justify-center rounded-md hover:bg-surface-warm ${h.enabled ? "text-accent" : "text-text-muted"}`}><Power className="h-3.5 w-3.5" /></button>
                <button onClick={() => startEdit(h)} title="Edit" className="flex h-8 items-center rounded-md px-2 text-xs text-text-muted hover:bg-surface-warm hover:text-text-primary">Edit</button>
                <button onClick={() => remove(h)} title="Remove" className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-err/10 hover:text-err"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>
            {runOut && runOut.id === h.id && (
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-border-subtle bg-background p-2 font-mono text-[11px] text-text-secondary">{runOut.text}</pre>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
