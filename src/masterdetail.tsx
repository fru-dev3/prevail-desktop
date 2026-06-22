import { useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

// The canonical master-detail layout, extracted so every settings surface that
// needs "pick something on the left, see its detail on the right" looks and
// behaves identically (Apps, Runtimes, …). One attached panel: a flush list
// COLUMN (border-r, surface-warm, pinned title header) that collapses to a thin
// rail, joined to a DETAIL pane that fills the rest. Collapse state persists per
// `storageKey`. Keep this the single source of truth for the pattern - new
// surfaces should reuse it rather than re-rolling the markup.
export function MasterDetail({
  title,
  storageKey,
  toolbar,
  list,
  rail,
  detail,
  minHeight = "55vh",
}: {
  // Uppercase label pinned at the top of the list column (e.g. "APPS").
  title: string;
  // localStorage key the collapse state is persisted under.
  storageKey: string;
  // Optional controls under the title header (search, a "+ add" button, …).
  toolbar?: ReactNode;
  // The scrollable list body (rows/groups). The caller renders its own rows
  // (e.g. with the selected row highlighted).
  list: ReactNode;
  // Optional icon rail shown when collapsed: the caller passes the items' logos
  // (clickable to select) so collapsing keeps the items reachable instead of
  // hiding them. Without it, collapse leaves just the expand chevron.
  rail?: ReactNode;
  // The detail pane for the current selection. Render flush (no outer card of
  // its own) - the panel already provides the frame.
  detail: ReactNode;
  minHeight?: string;
}) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(storageKey) === "1"; } catch { return false; }
  });
  const toggle = () => setCollapsed((v) => {
    const n = !v;
    try { localStorage.setItem(storageKey, n ? "1" : "0"); } catch { /* ignore */ }
    return n;
  });
  return (
    <div
      className="flex flex-col overflow-hidden rounded-xl border border-border lg:flex-row lg:items-stretch"
      style={{ minHeight }}
    >
      {collapsed ? (
        <div className="flex shrink-0 flex-col items-center gap-2 border-b border-border-subtle bg-surface-warm py-2 lg:w-14 lg:border-b-0 lg:border-r">
          <button
            onClick={toggle}
            title={`Show ${title.toLowerCase()}`}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-strong hover:text-accent"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          {rail && <div className="flex min-h-0 flex-1 flex-col items-center gap-1.5 overflow-y-auto px-1 pb-1">{rail}</div>}
        </div>
      ) : (
        <aside className="flex w-full shrink-0 flex-col border-b border-border-subtle bg-surface-warm lg:w-72 lg:max-w-xs lg:border-b-0 lg:border-r">
          <div className="flex shrink-0 items-center justify-between border-b border-border-subtle px-3 py-2.5">
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">{title}</span>
            <button
              onClick={toggle}
              title="Collapse"
              className="flex h-6 w-6 items-center justify-center rounded text-text-muted transition-colors hover:bg-surface-strong hover:text-accent"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          </div>
          {toolbar && <div className="shrink-0 border-b border-border-subtle p-2">{toolbar}</div>}
          <div className="min-h-0 flex-1 overflow-y-auto p-2">{list}</div>
        </aside>
      )}
      <div className="min-w-0 flex-1 overflow-y-auto bg-surface">{detail}</div>
    </div>
  );
}
