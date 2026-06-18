// A minimal context-window meter for the composer. The whole point of a context
// window is that once it fills up, model quality degrades - so this shows, at a
// glance and without noise, how full the current conversation context is, where
// the tokens are going (history vs attached context), and lets the user reclaim
// space by starting fresh. Just a small circular gauge; details on click.
import { useState } from "react";
import { Toggle } from "./ui";

// Rough token estimate: ~4 chars/token for English prose. Good enough to drive a
// fill gauge and warn before degradation; exact tokenization isn't needed here.
export function estimateTokens(text: string): number {
  return Math.ceil((text?.length ?? 0) / 4);
}

// Per-provider context window (tokens). Approximate; the gauge is about
// proportion, not exactness. Honors a "1m"/"[1m]" long-context model hint.
export function contextWindowFor(cli: string | null, model: string | null): number {
  const m = (model ?? "").toLowerCase();
  if (m.includes("1m") || m.includes("[1m]")) return 1_000_000;
  switch ((cli ?? "").toLowerCase()) {
    case "claude": return 200_000;
    case "codex": return 272_000;
    case "antigravity":
    case "gemini": return 1_000_000;
    case "openrouter": return 200_000;
    case "ollama":
    case "lmstudio":
    case "mlx": return 32_000;
    default: return 128_000;
  }
}

function fmt(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k`;
  return String(n);
}

export function ContextMeter({
  conversationTokens,
  attachedTokens,
  draftTokens,
  windowTokens,
  onReset,
  onCompact,
  compacting,
  autoCompact,
  onToggleAutoCompact,
}: {
  conversationTokens: number;
  attachedTokens: number;
  draftTokens: number;
  windowTokens: number;
  onReset: () => void;
  onCompact?: () => void;
  compacting?: boolean;
  autoCompact?: boolean;
  onToggleAutoCompact?: (v: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const used = conversationTokens + attachedTokens + draftTokens;
  const frac = Math.max(0, Math.min(1, used / Math.max(1, windowTokens)));
  const pct = Math.round(frac * 100);
  // Calm under 70%, amber 70-90% (getting heavy), red past 90% (degrading).
  const tone = frac >= 0.9 ? "var(--color-danger)" : frac >= 0.7 ? "var(--color-warn)" : "var(--color-accent)";
  const r = 7, c = 2 * Math.PI * r;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title={`Context: ${fmt(used)} / ${fmt(windowTokens)} tokens (${pct}%)`}
        className="flex items-center gap-1 rounded-md px-1 py-0.5 text-text-muted transition-colors hover:bg-surface-warm hover:text-text-secondary"
      >
        {/* Circular gauge - the minimal "how full" clock. */}
        <svg width="18" height="18" viewBox="0 0 18 18" className="shrink-0">
          <circle cx="9" cy="9" r={r} fill="none" stroke="var(--color-border)" strokeWidth="2" />
          <circle
            cx="9" cy="9" r={r} fill="none" stroke={tone} strokeWidth="2" strokeLinecap="round"
            strokeDasharray={c} strokeDashoffset={c * (1 - frac)} transform="rotate(-90 9 9)"
          />
        </svg>
        <span className="font-mono text-[10px] tabular-nums" style={frac >= 0.7 ? { color: tone } : undefined}>{pct}%</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full right-0 z-50 mb-1.5 w-64 rounded-xl border border-border bg-surface p-3 shadow-xl">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-semibold text-text-primary">Context window</span>
              <span className="font-mono text-[11px] text-text-muted">{fmt(used)} / {fmt(windowTokens)}</span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-strong">
              <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: tone }} />
            </div>
            <ul className="mt-3 space-y-1 text-xs">
              <li className="flex justify-between"><span className="text-text-secondary">Conversation</span><span className="font-mono text-text-muted">{fmt(conversationTokens)}</span></li>
              <li className="flex justify-between"><span className="text-text-secondary">Attached context</span><span className="font-mono text-text-muted">{fmt(attachedTokens)}</span></li>
              {draftTokens > 0 && <li className="flex justify-between"><span className="text-text-secondary">Draft</span><span className="font-mono text-text-muted">{fmt(draftTokens)}</span></li>}
            </ul>
            {frac >= 0.7 && (
              <p className="mt-2 text-[11px]" style={{ color: tone }}>
                {frac >= 0.9 ? "Nearly full - responses may degrade. Start fresh to reclaim space." : "Getting heavy. Consider starting fresh soon."}
              </p>
            )}
            {onCompact && (
              <button
                onClick={() => { onCompact(); }}
                disabled={compacting}
                title="Summarize the conversation so far into a compact gist, freeing space. Memory + domain context carry over."
                className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-background transition-colors hover:bg-accent-hover disabled:opacity-50"
              >
                {compacting ? "Compacting…" : "Compact"}
              </button>
            )}
            <button
              onClick={() => { onReset(); setOpen(false); }}
              title="Clear the conversation and start over. Long-term memory + domain context still carry over."
              className="mt-2 w-full rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary transition-colors hover:border-accent-border hover:bg-accent-soft hover:text-accent"
            >
              Start fresh
            </button>
            {onToggleAutoCompact && (
              <div className="mt-2.5 flex items-center gap-2 border-t border-border-subtle pt-2.5" title="Automatically compact when the window gets full">
                <span className="flex-1 text-[11px] text-text-secondary">Auto-compact</span>
                <Toggle on={!!autoCompact} onChange={(v) => onToggleAutoCompact(v)} label="Auto-compact when the window gets full" />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
