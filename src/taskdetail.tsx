// Task detail object — a task is more than a board row. Click one open and you
// get its full shape: title, domain, due, priority, status, owner, a long-form
// description, and a comment/activity thread you (and the AI) build over time.
// The one-line _tasks.md record stays canonical; the rich parts live in the
// per-domain sidecar (_task_details.json) via task_detail_* commands.
import { useCallback, useEffect, useState } from "react";
import { Bot, Flag, MessageSquarePlus, Sparkles, User, X } from "lucide-react";
import { invoke } from "./bridge";
import { titleCase, relTime } from "./format";
import { VENDOR_BRAND } from "./constants";
import type { BoardTask } from "./types";

type Detail = { description?: string; comments?: { ts: number; text: string; author?: string }[] };

export function TaskDetailPanel({ task, vaultPath, onClose, onChanged }: {
  task: BoardTask;
  vaultPath: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<Detail>({});
  const [desc, setDesc] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const id = task.id ?? "";

  useEffect(() => {
    if (!id) return;
    let alive = true;
    invoke<Detail>("task_detail_get", { vault: vaultPath, domain: task.domain, id })
      .then((d) => { if (alive) { setDetail(d || {}); setDesc(d?.description ?? ""); } })
      .catch(() => { if (alive) { setDetail({}); setDesc(""); } });
    return () => { alive = false; };
  }, [id, vaultPath, task.domain]);

  // Mutate one field on the underlying task line (status/owner/priority/due) via a
  // read-modify-write, then refresh the board.
  const patchTask = useCallback(async (patch: Partial<BoardTask>) => {
    if (!id) return;
    setBusy(true);
    try {
      const cur = await invoke<BoardTask[]>("tasks_read", { vault: vaultPath, domain: task.domain });
      await invoke("tasks_set", { vault: vaultPath, domain: task.domain, tasks: cur.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
      onChanged();
    } catch (e) { console.error("patch task", e); }
    finally { setBusy(false); }
  }, [id, vaultPath, task.domain, onChanged]);

  const saveDesc = useCallback(async () => {
    if (!id || desc === (detail.description ?? "")) return;
    try { await invoke("task_detail_set_description", { vault: vaultPath, domain: task.domain, id, description: desc }); setDetail((d) => ({ ...d, description: desc })); }
    catch (e) { console.error("save description", e); }
  }, [id, desc, detail.description, vaultPath, task.domain]);

  const addComment = useCallback(async () => {
    const t = comment.trim();
    if (!id || !t) return;
    try {
      const d = await invoke<Detail>("task_detail_add_comment", { vault: vaultPath, domain: task.domain, id, text: t, author: "me" });
      setDetail(d || {});
      setComment("");
    } catch (e) { console.error("add comment", e); }
  }, [id, comment, vaultPath, task.domain]);

  const cyclePriority = () => patchTask({ priority: task.priority === "critical" ? null : task.priority === "high" ? "critical" : "high" });

  // Open this task's domain chat seeded with the task as context.
  const discuss = () => {
    window.dispatchEvent(new CustomEvent("prevail:open-domain", { detail: task.domain }));
    window.dispatchEvent(new CustomEvent("prevail:compose-seed", { detail: `Help me with this task: "${task.text}"${desc ? `\n\nDetails: ${desc}` : ""}` }));
    onClose();
  };

  const comments = detail.comments ?? [];

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      {/* Floating side drawer: anchored to the right but inset on all sides so it
          reads as a compact card, not a full-height slab covering the screen. */}
      <div className="fixed right-3 top-3 bottom-3 z-50 flex w-[400px] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
        {/* Header */}
        <div className="flex items-start gap-2 border-b border-border-subtle px-4 py-3">
          <span title={task.owner === "ai" ? "AI" : "Me"} className={`mt-0.5 shrink-0 ${task.owner === "ai" ? "text-accent" : "text-text-muted"}`}>
            {task.owner === "ai" ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}
          </span>
          <div className="min-w-0 flex-1">
            <input
              defaultValue={task.text}
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== task.text) patchTask({ text: v }); }}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              className="w-full bg-transparent text-[15px] font-semibold text-text-primary outline-none focus:rounded focus:bg-background focus:px-1"
            />
            <div className="mt-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-text-muted">
              <span className="rounded-full bg-surface-warm px-1.5 py-px">{titleCase(task.domain)}</span>
              {task.trashed && <span className="text-warn">trashed</span>}
            </div>
          </div>
          <button onClick={onClose} className="shrink-0 text-text-muted hover:text-text-primary"><X className="h-4 w-4" /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {/* Meta controls */}
          <div className="grid grid-cols-2 gap-2.5">
            <label className="block">
              <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-text-muted">Status</div>
              <select value={task.status} onChange={(e) => patchTask({ status: e.target.value })} disabled={busy} className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs">
                {["todo", "doing", "review", "blocked", "done", "icebox"].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
              </select>
            </label>
            <label className="block">
              <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-text-muted">Due</div>
              <input type="date" value={task.due ?? ""} onChange={(e) => patchTask({ due: e.target.value || null })} disabled={busy} className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-text-secondary" />
            </label>
            <button onClick={cyclePriority} disabled={busy} className="flex items-center justify-between rounded-md border border-border bg-background px-2 py-1.5 text-left">
              <span className="font-mono text-[9px] uppercase tracking-wider text-text-muted">Priority</span>
              <span className={`inline-flex items-center gap-1 text-xs ${task.priority === "critical" ? "text-danger" : task.priority === "high" ? "text-warn" : "text-text-muted"}`}>
                <Flag className="h-3 w-3" fill={task.priority ? "currentColor" : "none"} /> {task.priority ?? "normal"}
              </span>
            </button>
            <button onClick={() => patchTask({ owner: task.owner === "ai" ? "me" : "ai" })} disabled={busy} className="flex items-center justify-between rounded-md border border-border bg-background px-2 py-1.5 text-left">
              <span className="font-mono text-[9px] uppercase tracking-wider text-text-muted">Owner</span>
              <span className="inline-flex items-center gap-1 text-xs text-text-secondary">{task.owner === "ai" ? <><Bot className="h-3 w-3" /> AI</> : <><User className="h-3 w-3" /> Me</>}</span>
            </button>
          </div>

          {/* Description */}
          <div className="mt-4">
            <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-text-muted">Description</div>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              onBlur={saveDesc}
              placeholder="Add details, links, acceptance criteria…"
              rows={4}
              className="w-full resize-y rounded-md border border-border bg-background px-2.5 py-2 text-[13px] leading-relaxed text-text-primary outline-none focus:border-accent-border"
            />
          </div>

          {/* Discuss with AI */}
          <button onClick={discuss} className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-accent-border bg-accent-soft px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-accent hover:bg-accent hover:text-background">
            <Sparkles className="h-3.5 w-3.5" /> Discuss with AI
          </button>

          {/* Comments / activity */}
          <div className="mt-5">
            <div className="mb-2 font-mono text-[9px] uppercase tracking-wider text-text-muted">Comments · {comments.length}</div>
            <div className="space-y-2">
              {comments.map((c, i) => (
                <div key={i} className="rounded-lg border border-border-subtle bg-background px-3 py-2">
                  <div className="mb-0.5 flex items-center gap-2 font-mono text-[9px] uppercase tracking-wider text-text-muted">
                    {(() => {
                      // author is "me"/"you" (the user), "ai" (generic), or an
                      // agent id like "pi"/"hermes"/"opencode"/"Prevail" when a
                      // task was handed to an agent. Show who actually wrote it.
                      const a = c.author;
                      const isUser = !a || a === "me" || a === "you";
                      const label = isUser ? "You" : a === "ai" ? "AI" : (VENDOR_BRAND[a]?.name ?? a);
                      return (
                        <>
                          {isUser ? <User className="h-3 w-3" /> : <Bot className="h-3 w-3 text-accent" />}
                          {label} · {relTime(c.ts)}
                        </>
                      );
                    })()}
                  </div>
                  <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-text-secondary">{c.text}</div>
                </div>
              ))}
              {comments.length === 0 && <div className="text-xs text-text-muted">No comments yet.</div>}
            </div>
            <div className="mt-2 flex items-end gap-2">
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) addComment(); }}
                placeholder="Add a comment… (⌘↵)"
                rows={2}
                className="min-w-0 flex-1 resize-y rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] text-text-primary outline-none focus:border-accent-border"
              />
              <button onClick={addComment} disabled={!comment.trim()} className="inline-flex shrink-0 items-center gap-1 rounded-md bg-accent px-2.5 py-2 text-xs font-semibold text-background hover:bg-accent-hover disabled:opacity-40">
                <MessageSquarePlus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
