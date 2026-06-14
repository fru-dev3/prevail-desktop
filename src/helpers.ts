// Pure cross-component helpers extracted from App.tsx.
import { titleCase } from "./format";
import type { EngineApp } from "./types";

export function bytesHuman(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatAuditedAt(ms: number | null): string {
  if (!ms) return "never audited";
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "unknown";
  }
}

export function splitThinking(raw: string): { thinking: string; answer: string } {
  if (!raw || raw.indexOf("<think") === -1) return { thinking: "", answer: raw };
  let thinking = "";
  const answer = raw.replace(/<think(?:ing)?>([\s\S]*?)(?:<\/think(?:ing)?>|$)/gi, (_m, inner: string) => {
    thinking += inner;
    return "";
  });
  return { thinking: thinking.trim(), answer: answer.trim() };
}

export function appScheduleText(app: EngineApp): string {
  if (!app.refresh?.every) return "Manual. No schedule set.";
  const parts = [`Every ${app.refresh.every}`];
  if (app.refresh.on) parts.push(titleCase(app.refresh.on));
  if (app.refresh.at) parts.push(`at ${app.refresh.at}`);
  return parts.join(" · ");
}

export function compactNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return `${n}`;
}

export function fmtCost(n: number): string {
  if (n === 0) return "$0";
  if (n < 0.01) return "<$0.01";
  return `$${n.toFixed(2)}`;
}
