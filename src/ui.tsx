// Pure, self-contained UI primitives extracted from App.tsx. None close over
// App state — they're prop-driven leaf components, safe to live on their own.
import { Brain, ChevronRight } from "lucide-react";

// Canonical on/off switch. Track 36x20, thumb 16x16. Every switch routes through
// this so the thumb never drifts back into bespoke implementations.
export function Toggle({
  on,
  onChange,
  label,
  disabled = false,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`inline-flex h-5 w-9 shrink-0 items-center overflow-hidden rounded-full px-0.5 transition-colors disabled:opacity-50 ${
        on ? "bg-accent" : "bg-surface-strong"
      }`}
    >
      <span
        className={`h-4 w-4 rounded-full bg-white shadow-sm ring-1 ring-black/10 transition-transform duration-200 ${
          on ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}

// Tiny inline trend line for score history etc. Returns null for <2 points.
export function Sparkline({ values, width = 72, height = 20 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const pts = values
    .map((v, i) => `${((i / (values.length - 1)) * (width - 4) + 2).toFixed(1)},${(height - 2 - (Math.max(0, Math.min(10, v)) / 10) * (height - 4)).toFixed(1)}`)
    .join(" ");
  const up = values[values.length - 1] >= values[0];
  const [lx, ly] = pts.split(" ").pop()!.split(",");
  return (
    <svg width={width} height={height} className="shrink-0" aria-hidden>
      <polyline points={pts} fill="none" strokeWidth="1.5" className={up ? "stroke-ok" : "stroke-warn"} />
      <circle cx={lx} cy={ly} r="2" className={up ? "fill-ok" : "fill-warn"} />
    </svg>
  );
}

// Collapsible "Thinking" block shown above a streamed reply's answer.
export function ThinkingDisclosure({ text, open }: { text: string; open?: boolean }) {
  if (!text) return null;
  return (
    <details open={open} className="group mb-3 rounded-lg border border-border-subtle bg-surface-warm/40">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted [&::-webkit-details-marker]:hidden">
        <Brain className="h-3.5 w-3.5" />
        Thinking
        <ChevronRight className="ml-auto h-3.5 w-3.5 transition-transform group-open:rotate-90" />
      </summary>
      <div className="whitespace-pre-wrap border-t border-border-subtle px-3 py-2 text-[13px] leading-relaxed text-text-secondary">
        {text}
      </div>
    </details>
  );
}
