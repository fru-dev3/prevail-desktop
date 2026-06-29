import { useEffect, useRef, useState } from "react";
import { invoke, listen } from "./bridge";
import { Loader2, Check, X, Download, ShieldAlert, MousePointerClick, Globe, KeyRound } from "lucide-react";

// Live learn / replay panel for the browser app-sync lane. Drives the engine's
// streaming command (engine_connector_learn_stream / engine_connector_run_stream),
// renders the agent's step timeline, surfaces the "do your 2FA in the browser
// window" gate, lists captured downloads, and lets the user stop the run.
//
// The browser is a SEPARATE headed Chromium window (not embedded) — this panel's
// job is narration, not rendering. Steady-state replay needs no screenshots; the
// DOM/AX-tree-driven agent reports structured steps.

export type ConnectorRunMode = "learn" | "replay" | "relearn";

interface RunEvent {
  phase: string;
  n?: number;
  action?: string;
  target?: string;
  thought?: string;
  url?: string;
  reason?: string;
  message?: string;
  ok?: boolean;
  name?: string;
  pct?: number;
}

const PHASE_ICON: Record<string, typeof Check> = {
  step: MousePointerClick,
  nav: Globe,
  download: Download,
  blocked: ShieldAlert,
  await_user: KeyRound,
};

export function ConnectorRunPanel({
  appId,
  mode,
  goal,
  url,
  onDone,
  onClose,
}: {
  appId: string;
  mode: ConnectorRunMode;
  goal?: string;
  url?: string;
  onDone?: (ok: boolean) => void;
  onClose?: () => void;
}) {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [running, setRunning] = useState(true);
  const [awaiting, setAwaiting] = useState<string | null>(null);
  const [downloads, setDownloads] = useState<string[]>([]);
  const [final, setFinal] = useState<{ ok: boolean; message?: string } | null>(null);
  const sessionRef = useRef<string>("");
  const okRef = useRef<boolean | null>(null);
  const unsubsRef = useRef<Array<() => void>>([]);
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = `connrun-${crypto.randomUUID()}`;
      sessionRef.current = session;
      const prefix = mode === "learn" || mode === "relearn" ? (mode === "learn" ? "connector_learn" : "connector_run") : "connector_run";
      const cmd = mode === "learn" ? "engine_connector_learn_stream" : "engine_connector_run_stream";

      const unLine = await listen<{ session: string; stream?: string; data: RunEvent | string }>(`${prefix}:line`, (e) => {
        const p = e.payload;
        if (p.session !== session || p.stream === "stderr") return;
        const data = p.data;
        if (!data || typeof data !== "object") return;
        const ev = data as RunEvent;
        setEvents((cur) => [...cur, ev].slice(-300));
        if (ev.phase === "await_user") setAwaiting(ev.reason || "verification");
        if (ev.phase === "user_resumed") setAwaiting(null);
        if (ev.phase === "download" && ev.name) setDownloads((d) => [...d, ev.name!]);
        if (ev.phase === "complete" || ev.phase === "error") {
          const ok = ev.phase === "complete" && ev.ok !== false;
          okRef.current = ok;
          setFinal({ ok, message: ev.message });
          setAwaiting(null);
        }
      });
      const unDone = await listen<{ session: string; code: number | null }>(`${prefix}:done`, (e) => {
        if (e.payload.session !== session) return;
        setRunning(false);
        const ok = okRef.current ?? e.payload.code === 0;
        onDone?.(ok);
      });
      unsubsRef.current = [unLine, unDone];
      if (cancelled) {
        unLine();
        unDone();
        return;
      }
      const args: Record<string, unknown> = { id: appId, session };
      if (mode === "learn") {
        if (goal) args.goal = goal;
        if (url) args.url = url;
      } else {
        args.mode = mode === "relearn" ? "relearn" : "replay";
        if (mode === "relearn" && url) args.url = url;
      }
      invoke(cmd, args).catch((err) => {
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
  }, [appId, mode]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [events.length]);

  async function stop() {
    if (sessionRef.current) await invoke("abort_sessions", { prefix: sessionRef.current }).catch(() => {});
    setRunning(false);
  }

  const title = mode === "replay" ? "Syncing" : mode === "relearn" ? "Re-learning" : "Learning";

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
          {running ? <Loader2 className="h-4 w-4 animate-spin text-accent" /> : final?.ok ? <Check className="h-4 w-4 text-ok" /> : <X className="h-4 w-4 text-danger" />}
          {title} {appId}
        </div>
        {running ? (
          <button onClick={stop} className="rounded-md border border-border px-2 py-1 text-xs text-text-secondary hover:bg-surface-warm">
            Stop
          </button>
        ) : (
          <button onClick={() => onClose?.()} className="rounded-md border border-border px-2 py-1 text-xs text-text-secondary hover:bg-surface-warm">
            Close
          </button>
        )}
      </div>

      {/* Sign-in / 2FA gate — surfaces the agent's actual ask + points at Chrome. */}
      {awaiting && (
        <div className="flex items-start gap-2 rounded-md border border-accent/40 bg-accent/10 px-3 py-2">
          <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <div className="text-sm text-text-primary">
            {[...events].reverse().find((e) => e.phase === "await_user")?.message
              || `Complete your ${awaiting === "twofa" ? "sign-in / 2FA" : awaiting} in the Chrome window, then the agent continues.`}
            <div className="mt-0.5 text-xs text-text-muted">Look for the Chrome window that opened — sign in there, then come back.</div>
          </div>
        </div>
      )}

      {/* Step timeline */}
      <div ref={logRef} className="max-h-64 overflow-y-auto rounded-md border border-border-subtle bg-surface-warm/40 p-2 font-mono text-[11px] leading-relaxed">
        {events.length === 0 ? (
          <div className="flex items-center gap-1.5 text-text-muted"><Loader2 className="h-3 w-3 animate-spin" /> launching the agent — your Chrome will open…</div>
        ) : (
          events.map((ev, i) => {
            const Icon = PHASE_ICON[ev.phase] ?? null;
            return (
              <div key={i} className="flex items-start gap-1.5 text-text-secondary">
                {Icon ? <Icon className="mt-0.5 h-3 w-3 shrink-0 text-text-muted" /> : <span className="w-3" />}
                <span className="min-w-0 flex-1 break-words">
                  {ev.phase === "step" && <span>{ev.action}{ev.target ? ` · ${ev.target}` : ""}{ev.thought ? <span className="text-text-muted"> — {ev.thought}</span> : ""}</span>}
                  {ev.phase === "nav" && <span className="text-text-muted">→ {ev.url}</span>}
                  {ev.phase === "download" && <span className="text-ok">downloaded {ev.name}</span>}
                  {ev.phase === "blocked" && <span className="text-warning">blocked: {ev.reason}</span>}
                  {ev.phase === "await_user" && <span className="text-accent">waiting for you ({ev.reason})</span>}
                  {ev.phase === "user_resumed" && <span className="text-text-muted">resumed</span>}
                  {ev.phase === "started" && <span className="text-text-muted">starting…</span>}
                  {ev.phase === "browser_open" && <span className="text-text-muted">opening your Chrome…</span>}
                  {ev.phase === "chromium_download" && <span className="text-text-muted">{ev.message ?? "preparing the browser…"}</span>}
                  {ev.phase === "complete" && <span className="text-ok">{ev.message}</span>}
                  {ev.phase === "error" && <span className="text-danger">{ev.message}</span>}
                </span>
              </div>
            );
          })
        )}
        {running && events.length > 0 && !awaiting && (
          <div className="mt-1 flex items-center gap-1.5 text-text-muted"><Loader2 className="h-3 w-3 animate-spin" /> agent is thinking… (each step takes a few seconds)</div>
        )}
      </div>

      {downloads.length > 0 && (
        <div className="text-xs text-text-secondary">
          <span className="font-medium">{downloads.length}</span> file{downloads.length === 1 ? "" : "s"} captured into the vault.
        </div>
      )}

      {final && !running && (
        <div className={`rounded-md px-3 py-2 text-sm ${final.ok ? "border border-ok/40 bg-ok/10 text-ok" : "border border-danger/40 bg-danger/10 text-danger"}`}>
          {final.ok ? "✓ " : "✗ "}
          {final.message || (final.ok ? "Done" : "Failed")}
        </div>
      )}
    </div>
  );
}
