// F6 — one app-wide toast system. Before this, error/success feedback was
// scattered across inline text, window.alert, and 169 silent catches. This is a
// tiny, dependency-free pub/sub: any module calls `toast(...)`, and the single
// <Toaster/> mounted in App renders it. No provider/context prop-drilling.
import { useEffect, useState } from "react";
import { Check, Info, Loader2, TriangleAlert, X } from "lucide-react";

type ToastKind = "info" | "success" | "error" | "loading";
export interface ToastAction { label: string; onClick: () => void }
export interface ToastOpts {
  kind?: ToastKind;
  duration?: number; // ms; 0 = sticky (auto-set for loading)
  action?: ToastAction;
}
interface ToastItem extends ToastOpts { id: number; message: string }

let seq = 0;
const listeners = new Set<(items: ToastItem[]) => void>();
let items: ToastItem[] = [];

function emit() { for (const l of listeners) l(items); }
function remove(id: number) { items = items.filter((t) => t.id !== id); emit(); }

function push(message: string, opts: ToastOpts = {}): number {
  const id = ++seq;
  const kind = opts.kind ?? "info";
  const duration = opts.duration ?? (kind === "loading" ? 0 : kind === "error" ? 6000 : 4000);
  items = [...items, { id, message, kind, duration, action: opts.action }];
  emit();
  if (duration > 0) window.setTimeout(() => remove(id), duration);
  return id;
}

// Public API: `toast("saved")`, `toast.error(...)`, `toast.success(...)`,
// `toast.loading(...)` (returns an id to dismiss), and `toast.dismiss(id)`.
export const toast = Object.assign(
  (message: string, opts?: ToastOpts) => push(message, opts),
  {
    info: (m: string, o?: Omit<ToastOpts, "kind">) => push(m, { ...o, kind: "info" }),
    success: (m: string, o?: Omit<ToastOpts, "kind">) => push(m, { ...o, kind: "success" }),
    error: (m: string, o?: Omit<ToastOpts, "kind">) => push(m, { ...o, kind: "error" }),
    loading: (m: string, o?: Omit<ToastOpts, "kind">) => push(m, { ...o, kind: "loading" }),
    dismiss: (id: number) => remove(id),
  },
);

const ICONS: Record<ToastKind, typeof Check> = {
  info: Info, success: Check, error: TriangleAlert, loading: Loader2,
};
const TINT: Record<ToastKind, string> = {
  info: "text-text-secondary", success: "text-ok", error: "text-err", loading: "text-ai",
};

export function Toaster() {
  const [list, setList] = useState<ToastItem[]>(items);
  useEffect(() => { listeners.add(setList); return () => { listeners.delete(setList); }; }, []);
  if (list.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[200] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4">
      {list.map((t) => {
        const Icon = ICONS[t.kind ?? "info"];
        return (
          <div
            key={t.id}
            role="status"
            className="pointer-events-auto flex items-start gap-2.5 rounded-lg border border-border bg-surface px-3.5 py-2.5 shadow-lg backdrop-blur"
          >
            <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${TINT[t.kind ?? "info"]} ${t.kind === "loading" ? "animate-spin" : ""}`} />
            <div className="min-w-0 flex-1 text-[13px] text-text-primary">{t.message}</div>
            {t.action && (
              <button
                onClick={() => { t.action?.onClick(); remove(t.id); }}
                className="shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold text-accent hover:bg-accent-soft"
              >
                {t.action.label}
              </button>
            )}
            <button
              onClick={() => remove(t.id)}
              aria-label="Dismiss"
              className="shrink-0 rounded p-0.5 text-text-muted hover:text-text-primary"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
