// Pure formatting helpers, extracted from App.tsx. No React, no app state — just
// value-to-string transforms used across the UI. Kept in one place so they're
// easy to find, test, and reuse as App.tsx is decomposed further.

// Score (0-100) to a CSS color token: green / amber / red.
export function scoreColor(score: number): string {
  if (score >= 75) return "var(--color-ok, #2e9e5b)";
  if (score >= 50) return "var(--color-warn, #c98a2b)";
  return "var(--color-err, #d24b4b)";
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

// Plain duration ("6 days", "3 hours") with NO "ago" — for future spans like
// "Next run in ~X". formatFreshness always appends "ago", so it can't be used
// for forward-looking times without reading wrong ("Next in ~6 days ago").
export function formatDuration(secs: number): string {
  if (secs < 0) return "unknown";
  const d = Math.floor(secs / 86400);
  if (d >= 1) return d === 1 ? "1 day" : `${d} days`;
  const h = Math.floor(secs / 3600);
  if (h >= 1) return h === 1 ? "1 hour" : `${h} hours`;
  const m = Math.floor(secs / 60);
  if (m >= 1) return m === 1 ? "1 minute" : `${m} minutes`;
  return "under a minute";
}

// Slug ("real-estate") to Title Case ("Real Estate").
export function titleCase(slug: string): string {
  return slug
    .replace(/[-_]+/g, " ")
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ""))
    .join(" ");
}

// A few brands whose common short title should display as the full brand name
// (keyed by the alphanumeric-normalized title). Keep small and unambiguous.
const BRAND_DISPLAY: Record<string, string> = {
  amex: "American Express",
};

// App titles sometimes arrive with a connection suffix (e.g. "AllTrails via
// InfoseekAI MCP"). The UI should always show just the app's name, so strip a
// trailing " via …" segment. App names don't legitimately contain " via …".
// Also expand a few well-known short brand names to their full form.
export function appName(title: string): string {
  const t = (title ?? "").replace(/\s+via\s+.+$/i, "").trim() || (title ?? "");
  const key = t.toLowerCase().replace(/[^a-z0-9]/g, "");
  return BRAND_DISPLAY[key] ?? t;
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
