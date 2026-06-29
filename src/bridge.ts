// Transport bridge — the WebUI "wrapper" seam.
//
// The desktop frontend talks to the backend via Tauri IPC (invoke/listen).
// To serve the SAME UI bundle in a browser (no rebuild, no duplicate UI), the
// few import sites point here instead of directly at @tauri-apps/api. On the
// desktop (Tauri present) this delegates 1:1 to the real API — identical
// behavior. In a plain browser it routes invoke over HTTP POST and events over
// Server-Sent Events to the in-app bridge server (see src-tauri/src/webui.rs).
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen, emit as tauriEmit, type UnlistenFn, type EventCallback } from "@tauri-apps/api/event";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// Browser auth token (set by the WebUI login screen).
const TOKEN_KEY = "prevail.web.token";
export function setWebToken(t: string): void {
  try { sessionStorage.setItem(TOKEN_KEY, t); } catch { /* ignore */ }
}
function token(): string {
  try { return sessionStorage.getItem(TOKEN_KEY) ?? ""; } catch { return ""; }
}
export function isBrowser(): boolean { return !isTauri; }

export async function invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri) return tauriInvoke<T>(cmd, args);
  const res = await fetch("/api/invoke", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: token() },
    body: JSON.stringify({ cmd, args: args ?? {} }),
  });
  if (res.status === 401) throw new Error("unauthorized, sign in again");
  if (!res.ok) throw new Error(await res.text().catch(() => `HTTP ${res.status}`));
  const j = (await res.json()) as { data?: T; error?: string };
  if (j && j.error) throw new Error(j.error);
  return j.data as T;
}

// ── Browser event bus over SSE ────────────────────────────────────────
let es: EventSource | null = null;
const handlers = new Map<string, Set<(p: unknown) => void>>();
function ensureSse(): void {
  if (es) return;
  es = new EventSource(`/api/events?token=${encodeURIComponent(token())}`);
  es.onmessage = (m) => {
    try {
      const { event, payload } = JSON.parse(m.data) as { event: string; payload: unknown };
      const set = handlers.get(event);
      if (set) set.forEach((h) => h({ event, payload, id: 0 } as unknown as never));
    } catch { /* malformed event — skip */ }
  };
  // EventSource auto-reconnects on error; nothing to do.
}
export async function listen<T = unknown>(event: string, handler: EventCallback<T>): Promise<UnlistenFn> {
  if (isTauri) return tauriListen<T>(event, handler);
  ensureSse();
  let set = handlers.get(event);
  if (!set) { set = new Set(); handlers.set(event, set); }
  const h = handler as unknown as (p: unknown) => void;
  set.add(h);
  return () => { set!.delete(h); };
}
export async function emit(event: string, payload?: unknown): Promise<void> {
  if (isTauri) return tauriEmit(event, payload);
  await fetch("/api/emit", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: token() },
    body: JSON.stringify({ event, payload }),
  });
}

export type { UnlistenFn, EventCallback } from "@tauri-apps/api/event";
