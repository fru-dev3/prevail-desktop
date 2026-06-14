// Pure text/format utilities extracted from App.tsx: skill-token highlighting,
// CLI stderr error extraction, and a tiny semver comparator.
import React from "react";
import { SKILL_TOKEN_RE } from "./constants";

export function renderSkillTokens(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(SKILL_TOKEN_RE.source, "g");
  while ((m = re.exec(text)) !== null) {
    const [full, prefix, token] = m;
    const start = m.index;
    if (start > lastIndex) parts.push(text.slice(lastIndex, start));
    if (prefix) parts.push(prefix);
    parts.push(
      <span
        key={start}
        className="rounded-md border border-accent-border bg-accent-soft px-1.5 py-0.5 font-mono text-[13px] font-medium text-accent"
      >
        {token}
      </span>,
    );
    lastIndex = start + full.length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return <>{parts}</>;
}

// Pull a concise, human-readable error out of a CLI's noisy stderr.
// CLIs emit a startup banner (version, workdir, model, session id…) plus
// the actual failure. We want only the failure. Codex emits structured
// `ERROR: {json}` lines whose `.error.message` is the useful part; other
// CLIs print a plain error line. Falls back to the last non-empty line.
export function extractCliError(stderr?: string): string | null {
  if (!stderr) return null;
  const lines = stderr.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  // Prefer an explicit ERROR line; parse JSON payload when present.
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (/^ERROR[:\s]/i.test(line) || /\berror\b/i.test(line)) {
      const braceAt = line.indexOf("{");
      if (braceAt !== -1) {
        try {
          const obj = JSON.parse(line.slice(braceAt));
          const msg = obj?.error?.message ?? obj?.message;
          if (typeof msg === "string" && msg) return msg;
        } catch { /* fall through to raw line */ }
      }
      return line.replace(/^ERROR[:\s]+/i, "");
    }
  }
  // No explicit error marker — surface the last line of output.
  return lines[lines.length - 1];
}

// Tiny semver compare — returns -1 / 0 / +1 for left vs right.
// "0.2.62" vs "0.2.62" → 0; "0.2.62" vs "0.2.59" → +1.
export function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da > db ? 1 : -1;
  }
  return 0;
}
