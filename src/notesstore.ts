// Shared Notes store. Notes are a stream-of-consciousness capture (distinct from
// the per-domain Journal, which is activity/prompts). Persisted as a single JSON
// document at <vault>/build/notes.json. Both the Notes tab and the global Quick
// Capture ribbon read/write through here so they stay in sync; writers fire
// "prevail:notes-changed" so any open Notes view reloads.
import { invoke } from "./bridge";

export interface Note {
  id: string;
  title: string;
  body: string;
  updated: number; // unix ms
  source?: "note" | "quick" | "voice"; // how it was captured
}

// Canonical (build/-first) write location for notes.json.
export function notesPath(vaultPath: string): string {
  return `${vaultPath.replace(/\/+$/, "")}/build/notes.json`;
}

// Legacy flat location at the vault root, kept as a read fallback for vaults
// that have not yet been swept into build/.
export function legacyNotesPath(vaultPath: string): string {
  return `${vaultPath.replace(/\/+$/, "")}/notes.json`;
}

export function newNoteId(): string {
  return `n_${Date.now().toString(36)}_${Math.floor(performance.now() % 1e6).toString(36)}`;
}

export async function loadNotes(vaultPath: string): Promise<Note[]> {
  try {
    // Prefer the canonical build/ copy; fall back to the legacy root location
    // so existing flat vaults still load their notes.
    let raw = await invoke<string>("read_text_file", { path: notesPath(vaultPath) }).catch(() => "");
    if (!raw) raw = await invoke<string>("read_text_file", { path: legacyNotesPath(vaultPath) }).catch(() => "");
    const parsed = raw ? (JSON.parse(raw) as Note[]) : [];
    const list = Array.isArray(parsed) ? parsed.filter((n) => n && n.id) : [];
    list.sort((a, b) => b.updated - a.updated);
    return list;
  } catch {
    return [];
  }
}

export async function saveNotes(vaultPath: string, notes: Note[]): Promise<void> {
  await invoke("write_text_file", { path: notesPath(vaultPath), contents: JSON.stringify(notes, null, 2) });
}

// Append a new note (used by Quick Capture). Returns the created note.
export async function addNote(vaultPath: string, fields: { title?: string; body: string; source?: Note["source"] }): Promise<Note> {
  const note: Note = { id: newNoteId(), title: (fields.title ?? "").trim(), body: fields.body, updated: Date.now(), source: fields.source ?? "note" };
  const list = await loadNotes(vaultPath);
  await saveNotes(vaultPath, [note, ...list]);
  window.dispatchEvent(new CustomEvent("prevail:notes-changed"));
  return note;
}
