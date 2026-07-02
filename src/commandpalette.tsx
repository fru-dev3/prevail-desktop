// F1 — the global command palette (Cmd+K). One surface to DO anything (new
// chat/task/note, toggle incognito, lock) and GO anywhere (every tab + all ~30
// settings/work sections + every domain). This also solves settings
// findability: sections that were buried behind jargon nav labels are now
// searchable by name. Content search (threads, note/task bodies) is a planned
// follow-on; this covers actions + navigation + domains.
import { useEffect, useMemo, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Search } from "lucide-react";

export interface Command {
  id: string;
  label: string;
  hint?: string;        // right-aligned context (e.g. "Go to", shortcut)
  group: string;        // section header in the list
  keywords?: string;    // extra match text not shown
  icon?: LucideIcon;
  run: () => void;
}

export function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    // Simple subsequence-tolerant contains match over label + group + keywords,
    // ranked so label-prefix hits sort first.
    const scored = commands
      .map((c) => {
        const hay = `${c.label} ${c.group} ${c.keywords ?? ""}`.toLowerCase();
        const idx = c.label.toLowerCase().indexOf(q);
        const inHay = hay.includes(q);
        if (idx < 0 && !inHay) return null;
        const score = idx === 0 ? 0 : idx > 0 ? 1 : 2;
        return { c, score };
      })
      .filter((x): x is { c: Command; score: number } => x !== null)
      .sort((a, b) => a.score - b.score);
    return scored.map((s) => s.c);
  }, [commands, query]);

  useEffect(() => { setCursor(0); }, [query]);
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const run = (c: Command | undefined) => { if (c) { onClose(); c.run(); } };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); run(filtered[cursor]); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };

  // Group headers in list order, preserving first-seen group ordering.
  const groupsInOrder: string[] = [];
  for (const c of filtered) if (!groupsInOrder.includes(c.group)) groupsInOrder.push(c.group);
  let flatIdx = -1;

  return (
    <div className="fixed inset-0 z-[150] flex items-start justify-center bg-black/40 pt-[12vh]" onMouseDown={onClose}>
      <div
        className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border-subtle px-3.5 py-2.5">
          <Search className="h-4 w-4 shrink-0 text-text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search actions, pages, and domains…"
            className="w-full bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
          />
        </div>
        <div ref={listRef} className="min-h-0 flex-1 overflow-auto py-1">
          {filtered.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-text-muted">No matches.</div>
          )}
          {groupsInOrder.map((g) => (
            <div key={g}>
              <div className="px-3.5 pb-1 pt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">{g}</div>
              {filtered.filter((c) => c.group === g).map((c) => {
                flatIdx++;
                const idx = flatIdx;
                const Icon = c.icon;
                return (
                  <button
                    key={c.id}
                    data-idx={idx}
                    onMouseMove={() => setCursor(idx)}
                    onClick={() => run(c)}
                    className={`flex w-full items-center gap-2.5 px-3.5 py-1.5 text-left ${idx === cursor ? "bg-accent-soft" : ""}`}
                  >
                    {Icon ? <Icon className={`h-3.5 w-3.5 shrink-0 ${idx === cursor ? "text-accent" : "text-text-muted"}`} /> : <span className="h-3.5 w-3.5" />}
                    <span className={`flex-1 truncate text-[13px] ${idx === cursor ? "text-text-primary" : "text-text-secondary"}`}>{c.label}</span>
                    {c.hint && <span className="shrink-0 font-mono text-[10px] text-text-muted">{c.hint}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between border-t border-border-subtle px-3.5 py-1.5 font-mono text-[10px] text-text-muted">
          <span>↑↓ navigate · ↵ run · ⎋ close</span>
          <span>{filtered.length} {filtered.length === 1 ? "result" : "results"}</span>
        </div>
      </div>
    </div>
  );
}
