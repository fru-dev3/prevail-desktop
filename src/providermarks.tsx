// Provider brand-mark data extracted from App.tsx: the OpenAI SVG path, the
// safe brandIcon accessor, the direct-provider roadmap roster, and the
// OpenRouter vendor-id → mark map + OrVendorMark renderer.
import { siAnthropic, siDeepseek, siGooglegemini, siHuggingface, siMeta, siMinimax, siMistralai, siQwen, siX as siXRaw } from "simple-icons";
import type { DirectProvider } from "./types";

export const OPENAI_PATH = "M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973l-.001.142v5.518a.79.79 0 0 0 .388.677l5.815 3.354-2.02 1.168a.075.075 0 0 1-.071 0l-4.83-2.788a4.504 4.504 0 0 1-1.647-6.098zm16.597 3.855L13.116 8.38 15.131 7.22a.071.071 0 0 1 .07 0l4.83 2.792a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.394-.674zm2.01-3.023l-.142-.085-4.774-2.781a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.659 4.139l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z";

// Direct API providers on the roadmap - shown with real brand marks. `path`+`hex`
// render the company logo on a white tile; `mono` is a fallback for brands with
// no official simple-icon yet.
// Safe accessor: if a simple-icon resolves undefined (e.g. stale dep cache),
// fall back to the monogram instead of throwing and taking down the page.

export const brandIcon = (icon: { path?: string; hex?: string } | undefined, mono: string): Partial<DirectProvider> =>
  icon && icon.path ? { path: icon.path, hex: `#${icon.hex ?? "111111"}` } : { mono };

export const DIRECT_PROVIDERS_SOON: DirectProvider[] = [
  { name: "Anthropic", ...brandIcon(siAnthropic, "A") },
  { name: "OpenAI", path: OPENAI_PATH, hex: "#000000" },
  { name: "xAI (Grok)", ...brandIcon(siXRaw, "x") },
  { name: "Google Gemini", ...brandIcon(siGooglegemini, "G") },
  { name: "DeepSeek", ...brandIcon(siDeepseek, "DS") },
  { name: "Qwen / DashScope", ...brandIcon(siQwen, "Q") },
  { name: "MiniMax", ...brandIcon(siMinimax, "M") },
  { name: "Hugging Face", ...brandIcon(siHuggingface, "HF") },
  { name: "GLM / Z.AI", mono: "Z" },
  { name: "Kimi / Moonshot", mono: "K" },
  { name: "OpenCode Zen", mono: "OZ" },
];

// Shared dimensions for every settings list row (providers, connectors,
// gateways, …) so lists look identical across pages: single column, h-8 icon
// tile, gap-3, px-4 py-3, subtle border. Containers wrap these in `space-y-2`.

// Map an OpenRouter model id ("anthropic/claude-...", "x-ai/grok-4", "qwen/...")
// to a brand mark, so the catalog reads visually instead of as a wall of ids.

export const OR_VENDOR_ICON: Record<string, { path?: string; hex?: string; mono: string }> = {
  anthropic: { ...brandIcon(siAnthropic, "A") } as { path?: string; hex?: string; mono: string },
  openai: { mono: "AI" },
  google: { ...brandIcon(siGooglegemini, "G") } as { path?: string; hex?: string; mono: string },
  "x-ai": { ...brandIcon(siXRaw, "x") } as { path?: string; hex?: string; mono: string },
  deepseek: { ...brandIcon(siDeepseek, "DS") } as { path?: string; hex?: string; mono: string },
  qwen: { ...brandIcon(siQwen, "Q") } as { path?: string; hex?: string; mono: string },
  "meta-llama": { ...brandIcon(siMeta, "M") } as { path?: string; hex?: string; mono: string },
  mistralai: { ...brandIcon(siMistralai, "Mi") } as { path?: string; hex?: string; mono: string },
  minimax: { ...brandIcon(siMinimax, "MM") } as { path?: string; hex?: string; mono: string },
  moonshotai: { mono: "Ki" },
  "z-ai": { mono: "Z" },
};

export function orVendorOf(id: string): string {
  const v = id.includes("/") ? id.split("/")[0].toLowerCase() : "";
  return v;
}

export function OrVendorMark({ id, size = 18 }: { id: string; size?: number }) {
  const v = OR_VENDOR_ICON[orVendorOf(id)];
  return (
    <span className="flex shrink-0 items-center justify-center rounded-md border border-border-subtle bg-white" style={{ width: size + 8, height: size + 8 }}>
      {v?.path ? (
        <svg width={size} height={size} viewBox="0 0 24 24" fill={v.hex ?? "#111"} aria-hidden><path d={v.path} /></svg>
      ) : (
        <span className="font-mono text-[10px] font-semibold text-text-muted">{v?.mono ?? "·"}</span>
      )}
    </span>
  );
}
