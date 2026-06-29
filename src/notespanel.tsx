// Notes / logs (Work mode → Notes). Phase 3 of the 2026 redesign: a place to
// brain-dump ideas and search them. Persisted as a single JSON document at
// <vault>/notes.json via the generic read_text_file / write_text_file commands
// (no new engine command needed). Autosaves shortly after you stop typing.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, Plus, Search, Trash2 } from "lucide-react";
import { relTime } from "./format";
import { SettingsHeader } from "./sectionutil";
import { loadNotes, newNoteId as newId, saveNotes, type Note } from "./notesstore";

export function NotesPanel({ vaultPath }: { vaultPath: string }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loaded, setLoaded] = useState(false);
  // Guards the autosave effect from writing the file back during the initial load.
  const hydrating = useRef(true);

  // Load on mount / vault change.
  useEffect(() => {
    let alive = true;
    hydrating.current = true;
    setLoaded(false);
    (async () => {
      const list = await loadNotes(vaultPath);
      if (!alive) return;
      setNotes(list);
      setSelectedId(list[0]?.id ?? null);
      setLoaded(true);
      hydrating.current = false;
    })();
    return () => { alive = false; };
  }, [vaultPath]);

  // Autosave: debounce writes after notes change (skip the hydration write).
  // saveNotes does NOT broadcast, so this never loops with the listener below.
  useEffect(() => {
    if (hydrating.current || !loaded) return;
    const id = window.setTimeout(() => { void saveNotes(vaultPath, notes).catch((e) => console.error("notes save", e)); }, 600);
    return () => window.clearTimeout(id);
  }, [notes, loaded, vaultPath]);

  // Pick up notes added elsewhere (the Quick Capture ribbon) so they appear here
  // AND so our autosave doesn't later overwrite the file without them. Preserve
  // the in-memory selected note (it may have unsaved edits).
  useEffect(() => {
    const onChanged = () => {
      if (hydrating.current) return;
      void loadNotes(vaultPath).then((list) => {
        setNotes((cur) => {
          const sel = cur.find((n) => n.id === selectedId);
          if (!sel) return list;
          return list.some((n) => n.id === sel.id) ? list.map((n) => (n.id === sel.id ? sel : n)) : [sel, ...list];
        });
      });
    };
    window.addEventListener("prevail:notes-changed", onChanged);
    return () => window.removeEventListener("prevail:notes-changed", onChanged);
  }, [vaultPath, selectedId]);

  const selected = notes.find((n) => n.id === selectedId) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? notes.filter((n) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q)) : notes;
    return [...list].sort((a, b) => b.updated - a.updated);
  }, [notes, query]);

  const createNote = useCallback(() => {
    const n: Note = { id: newId(), title: "", body: "", updated: Date.now() };
    setNotes((cur) => [n, ...cur]);
    setSelectedId(n.id);
  }, []);

  const updateSelected = (patch: Partial<Pick<Note, "title" | "body">>) => {
    if (!selectedId) return;
    setNotes((cur) => cur.map((n) => (n.id === selectedId ? { ...n, ...patch, updated: Date.now() } : n)));
  };

  const deleteNote = (id: string) => {
    setNotes((cur) => {
      const next = cur.filter((n) => n.id !== id);
      if (id === selectedId) setSelectedId(next[0]?.id ?? null);
      return next;
    });
  };

  const titleOf = (n: Note) => n.title.trim() || (n.body.trim().split("\n")[0] || "Untitled note").slice(0, 60);

  return (
    <>
      <SettingsHeader
        title="Notes"
        icon={FileText}
        subtitle="Quick brain-dumps, ideas, and logs — searchable, saved to your vault. Everything here lives in notes.json inside your vault folder."
        right={
          <button onClick={createNote} className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-background hover:bg-accent-hover">
            <Plus className="h-4 w-4" /> New note
          </button>
        }
      />
      <div className="flex min-h-[60vh] gap-4">
        {/* List + search */}
        <div className="flex w-72 shrink-0 flex-col rounded-lg border border-border-subtle bg-surface-warm">
          <div className="border-b border-border-subtle p-2">
            <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5">
              <Search className="h-3.5 w-3.5 text-text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search notes…"
                className="min-w-0 flex-1 bg-transparent text-sm focus:outline-none"
              />
            </div>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {filtered.length === 0 ? (
              <li className="px-3 py-6 text-center text-[13px] text-text-muted">
                {notes.length === 0 ? "No notes yet. Capture your first idea." : "No notes match your search."}
              </li>
            ) : filtered.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => setSelectedId(n.id)}
                  className={`group flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left transition-colors ${
                    n.id === selectedId ? "bg-accent-soft" : "hover:bg-surface-strong"
                  }`}
                >
                  <FileText className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${n.id === selectedId ? "text-accent" : "text-text-muted"}`} />
                  <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className={`truncate text-[13px] ${n.id === selectedId ? "font-semibold text-text-primary" : "text-text-secondary"}`}>{titleOf(n)}</span>
                    <span className="truncate text-[10px] text-text-muted">{relTime(n.updated)}</span>
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); deleteNote(n.id); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); deleteNote(n.id); } }}
                    title="Delete note"
                    className="shrink-0 rounded p-1 text-text-muted opacity-0 hover:bg-err/10 hover:text-err group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Editor */}
        <div className="min-w-0 flex-1 rounded-lg border border-border-subtle bg-background p-4">
          {selected ? (
            <div className="flex h-full flex-col">
              <input
                value={selected.title}
                onChange={(e) => updateSelected({ title: e.target.value })}
                placeholder="Title"
                className="mb-2 w-full bg-transparent font-display text-2xl font-bold text-text-primary placeholder:text-text-muted/50 focus:outline-none"
              />
              <textarea
                value={selected.body}
                onChange={(e) => updateSelected({ body: e.target.value })}
                placeholder="Start writing… ideas, logs, brain-dumps."
                className="min-h-0 flex-1 resize-none bg-transparent text-[14px] leading-relaxed text-text-secondary placeholder:text-text-muted/50 focus:outline-none"
              />
              <div className="mt-2 border-t border-border-subtle pt-2 font-mono text-[10px] uppercase tracking-wider text-text-muted">
                Saved to vault · updated {relTime(selected.updated)}
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-center text-text-muted">
              <FileText className="mb-3 h-8 w-8 opacity-40" />
              <p className="text-sm">Select a note, or create one to start writing.</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
