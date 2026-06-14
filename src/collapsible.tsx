// The ONE canonical collapsible used across the whole app. Founder rule: every
// collapsible looks and behaves the same — a leading icon tile, a title (and
// optional subtitle) on the left, a right-side summary of what's inside (plus an
// optional status dot), and collapsed by default so the user scans summaries
// first and opens only what they want. Do not hand-roll another collapsible;
// reuse this everywhere (Settings, Preferences, daemons, connectors, sidebar
// detail panes, etc.) so the experience is consistent page to page.
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { lsGet, lsSet } from "./storage";

export function CollapsibleSection({
  icon: Icon,
  title,
  subtitle,
  summary,
  status,
  right,
  defaultOpen = false,
  storageKey,
  className = "",
  children,
}: {
  icon?: LucideIcon;
  title: string;
  /** Optional secondary line under the title (what this section is). */
  subtitle?: string;
  /** Right-aligned one-glance summary of what's inside (count, current value…). */
  summary?: React.ReactNode;
  /** Optional status dot: true = active/on (accent), false = idle (muted). */
  status?: boolean;
  /** Optional non-toggling action rendered at the far right (rare). */
  right?: React.ReactNode;
  defaultOpen?: boolean;
  /** Persist open/closed across launches under this localStorage key. */
  storageKey?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState<boolean>(() => {
    if (storageKey) {
      const v = lsGet(storageKey);
      if (v === "1") return true;
      if (v === "0") return false;
    }
    return defaultOpen;
  });
  const toggle = () => {
    setOpen((o) => {
      const next = !o;
      if (storageKey) lsSet(storageKey, next ? "1" : "0");
      return next;
    });
  };
  return (
    <section className={`mb-3 overflow-hidden rounded-xl border border-border bg-surface ${className}`}>
      <button
        onClick={toggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-warm"
      >
        <ChevronRight className={`h-4 w-4 shrink-0 text-text-muted transition-transform ${open ? "rotate-90" : ""}`} strokeWidth={2.5} />
        {Icon && (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-warm text-text-secondary">
            <Icon className="h-4 w-4" />
          </span>
        )}
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold text-text-primary">{title}</span>
          {subtitle && <span className="truncate text-xs text-text-muted">{subtitle}</span>}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {summary != null && summary !== "" && (
            <span className="truncate font-mono text-[10px] uppercase tracking-wider text-text-muted">{summary}</span>
          )}
          {status !== undefined && (
            <span className={`h-1.5 w-1.5 rounded-full ${status ? "bg-accent" : "bg-text-muted/40"}`} title={status ? "active" : "idle"} />
          )}
          {right && <span onClick={(e) => e.stopPropagation()}>{right}</span>}
        </span>
      </button>
      {open && <div className="border-t border-border-subtle px-4 py-4">{children}</div>}
    </section>
  );
}
