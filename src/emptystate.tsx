// D4 — one shared empty/loading vocabulary. Before this, empty states were
// ad-hoc one-liners ("No notes yet.", "Nothing scheduled…") with inconsistent
// tone and no call to action, and loading was bare spinners. These two
// primitives give panels a consistent, designed baseline.
import type { LucideIcon } from "lucide-react";
import { Loader2 } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  body?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {Icon && (
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-border-subtle bg-surface-warm text-text-muted">
          <Icon className="h-5 w-5" />
        </div>
      )}
      <div className="text-sm font-semibold text-text-primary">{title}</div>
      {body && <p className="mt-1 max-w-xs text-balance text-xs text-text-muted">{body}</p>}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-3 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent hover:opacity-90"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 px-6 py-12 text-sm text-text-muted">
      <Loader2 className="h-4 w-4 animate-spin text-ai" />
      {label}
    </div>
  );
}
