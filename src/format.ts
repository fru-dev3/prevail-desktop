// Pure formatting helpers, extracted from App.tsx. No React, no app state — just
// value-to-string transforms used across the UI. Kept in one place so they're
// easy to find, test, and reuse as App.tsx is decomposed further.

// Score (0-100) to a CSS color token: green / amber / red.
export function scoreColor(score: number): string {
  if (score >= 75) return "var(--color-ok, #2e9e5b)";
  if (score >= 50) return "var(--color-warn, #c98a2b)";
  return "var(--color-danger, #d24b4b)";
}

// Human freshness from a count of seconds.
export function formatFreshness(secs: number): string {
  if (secs < 0) return "unknown";
  const d = Math.floor(secs / 86400);
  if (d >= 1) return d === 1 ? "1 day ago" : `${d} days ago`;
  const h = Math.floor(secs / 3600);
  if (h >= 1) return h === 1 ? "1 hour ago" : `${h} hours ago`;
  const m = Math.floor(secs / 60);
  if (m >= 1) return m === 1 ? "1 minute ago" : `${m} minutes ago`;
  return "just now";
}

// Slug ("real-estate") to Title Case ("Real Estate").
export function titleCase(slug: string): string {
  return slug
    .replace(/[-_]+/g, " ")
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ""))
    .join(" ");
}

// Relative "time ago" from an epoch-ms timestamp (null = "never").
export function relTime(ts: number | null): string {
  if (!ts) return "never";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
