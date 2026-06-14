// Provider brand marks extracted from App.tsx. Real simple-icons SVG glyphs for
// Claude and Ollama; a faithful OpenAI mark (not in simple-icons) and the
// multicolor Google G for Antigravity; monograms for lmstudio/mlx.
import React from "react";
import { siClaude as siClaudeRaw, siOllama as siOllamaRaw } from "simple-icons";
import { VENDOR_BRAND } from "./constants";

export const siClaude = siClaudeRaw as { path: string };
export const siOllama = siOllamaRaw as { path: string };

export function ProviderMark({ vendor, size = 28 }: { vendor: string; size?: number }) {
  const v = VENDOR_BRAND[vendor] ?? VENDOR_BRAND.other;
  const glyphSize = Math.round(size * 0.62);
  let inner: React.ReactNode;
  let bg = v.hex;
  switch (vendor) {
    case "claude":
      inner = (
        <svg viewBox="0 0 24 24" width={glyphSize} height={glyphSize} fill="white" aria-hidden="true">
          <path d={siClaude.path} />
        </svg>
      );
      break;
    case "codex":
      inner = (
        <svg viewBox="0 0 24 24" width={glyphSize} height={glyphSize} fill="white" aria-hidden="true">
          <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973l-.001.142v5.518a.79.79 0 0 0 .388.677l5.815 3.354-2.02 1.168a.075.075 0 0 1-.071 0l-4.83-2.788a4.504 4.504 0 0 1-1.647-6.098zm16.597 3.855L13.116 8.38 15.131 7.22a.071.071 0 0 1 .07 0l4.83 2.792a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.394-.674zm2.01-3.023l-.142-.085-4.774-2.781a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.659 4.139l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/>
        </svg>
      );
      break;
    case "antigravity":
      // White tile with the four-color Google G so the brand stays
      // true on any background.
      bg = "#ffffff";
      inner = (
        <svg viewBox="0 0 48 48" width={glyphSize} height={glyphSize} aria-hidden="true">
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8a12 12 0 1 1 0-24 11.9 11.9 0 0 1 8.5 3.3l5.7-5.7A20 20 0 1 0 24 44a20 20 0 0 0 19.6-23.5z"/>
          <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8A12 12 0 0 1 24 12a11.9 11.9 0 0 1 8.5 3.3l5.7-5.7A20 20 0 0 0 6.3 14.7z"/>
          <path fill="#4CAF50" d="M24 44a20 20 0 0 0 13.5-5.2l-6.2-5.3a11.9 11.9 0 0 1-7.3 2.5 12 12 0 0 1-11.3-8L6.1 33A20 20 0 0 0 24 44z"/>
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3a12.1 12.1 0 0 1-4.1 5.5l6.2 5.3c.4-.4 6.6-4.8 6.6-14.8 0-1.3-.1-2.4-.4-3.5z"/>
        </svg>
      );
      break;
    case "ollama":
      inner = (
        <svg viewBox="0 0 24 24" width={glyphSize} height={glyphSize} fill="white" aria-hidden="true">
          <path d={siOllama.path} />
        </svg>
      );
      break;
    case "lmstudio":
      // No official simple-icons glyph; use a clean monogram on the brand tile.
      inner = <span className="font-mono font-semibold text-white" style={{ fontSize: Math.round(size * 0.34) }}>LM</span>;
      break;
    case "mlx":
      inner = <span className="font-mono font-semibold text-white" style={{ fontSize: Math.round(size * 0.3) }}>MLX</span>;
      break;
    default:
      inner = <span className="font-mono text-white">·</span>;
  }
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-md ring-1 ring-black/5"
      style={{ background: bg, height: size, width: size }}
      title={v.name}
    >
      {inner}
    </span>
  );
}
