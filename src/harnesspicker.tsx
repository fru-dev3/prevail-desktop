// HarnessPicker — a small popover for choosing which harness agent runs a task.
// The inverse of the homepage AgentPickerRail (which lists chat models and
// filters harnesses OUT): this lists ONLY installed harnesses (Hermes, Pi,
// OpenCode, OpenClaw). Parent owns open/close + positions it under the button.
import { VENDOR_BRAND } from "./constants";
import { ProviderMark } from "./marks";
import type { CliInfo } from "./types";

export function HarnessPicker({
  harnesses,
  onPick,
  onClose,
}: {
  harnesses: CliInfo[];
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <>
      {/* click-away catcher */}
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 z-50 mt-1 w-48 overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
        <div className="border-b border-border-subtle px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-text-muted">
          Run with agent
        </div>
        {harnesses.length === 0 ? (
          <p className="px-3 py-2 text-[11px] leading-relaxed text-text-muted">
            No harness installed. Add one in Editor → Runtimes.
          </p>
        ) : (
          harnesses.map((h) => (
            <button
              key={h.id}
              onClick={() => onPick(h.id)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text-secondary transition-colors hover:bg-surface-warm hover:text-text-primary"
            >
              <ProviderMark vendor={h.id} size={18} />
              <span className="truncate">{VENDOR_BRAND[h.id]?.name ?? h.label}</span>
            </button>
          ))
        )}
      </div>
    </>
  );
}
