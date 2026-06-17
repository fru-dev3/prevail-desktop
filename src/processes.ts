// A tiny global registry of long-running "processes" so the UI can show a live
// "N running" indicator (P2 from the 2026-06-17 feedback) and the user can see
// that a chat, council, benchmark, or loop is still working even while they
// navigate elsewhere. Module-scope (survives component unmount) + a subscribe
// hook, mirroring the benchBatches pattern.
import { useEffect, useState } from "react";

export type ProcKind = "chat" | "council" | "benchmark" | "loop";
export type Proc = { id: string; kind: ProcKind; label: string; domain?: string | null; startedAt: number };

const procs = new Map<string, Proc>();
const listeners = new Set<() => void>();
function emit() { for (const l of listeners) l(); }

export function startProcess(id: string, kind: ProcKind, label: string, domain?: string | null) {
  procs.set(id, { id, kind, label, domain: domain ?? null, startedAt: Date.now() });
  emit();
}
export function endProcess(id: string) {
  if (procs.delete(id)) emit();
}
export function listProcesses(): Proc[] {
  return [...procs.values()].sort((a, b) => a.startedAt - b.startedAt);
}

export function useProcesses(): Proc[] {
  const [items, setItems] = useState<Proc[]>(listProcesses);
  useEffect(() => {
    const l = () => setItems(listProcesses());
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return items;
}
