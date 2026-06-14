// Telemetry — anonymous, opt-in, default OFF, and impossible to leak content.
//
// Design (see docs/TELEMETRY-PLAN.md):
//   * Two independent consents: usage (PostHog) and crash (Sentry). Both default OFF.
//   * A HARD allowlist of event names and property keys. Anything off the list is
//     dropped before it can ever be sent — a content leak can't happen by accident.
//   * distinct_id is a random local UUID, never email/name/path/machine.
//   * Every would-be send is also appended to a local ring-buffer log so the user
//     can see EXACTLY what telemetry does. Full transparency.
//   * Network sends are gated behind build-time keys (VITE_POSTHOG_KEY /
//     VITE_SENTRY_DSN). With no keys the module is inert: it only writes the local
//     log. Wiring the real SDKs is a one-spot change in `flush()` once keys exist.
import { PREF, getPref, lsGet, lsSet, setPref } from "./storage";

// ── Allowlist ───────────────────────────────────────────────────────────────
// Only these event names may be sent. Add deliberately; never auto-generate.
export const ALLOWED_EVENTS = [
  "app_opened",        // {version, os}
  "feature_used",      // {feature}
  "benchmark_run",     // {models, domains}
  "provider_configured", // {provider}
  "daemon_toggled",    // {daemon, on}
] as const;
export type TelemetryEvent = (typeof ALLOWED_EVENTS)[number];

// Only these property KEYS survive scrubbing, and only as primitives. No free
// text the user typed, no names they created, no paths — none of it is here.
const ALLOWED_PROPS = new Set([
  "version", "os", "channel", "feature", "models", "domains", "provider", "daemon", "on",
]);

// Properties whose string values must come from a fixed vocabulary, so even an
// allowlisted key can't smuggle content (e.g. feature must be a known feature).
const ENUM_VALUES: Record<string, Set<string>> = {
  os: new Set(["mac", "win", "linux", "unknown"]),
  feature: new Set(["chat", "council", "benchmark", "skills", "intents", "ideal_state", "apps", "memory"]),
  provider: new Set(["openrouter", "anthropic", "openai", "google", "ollama", "lmstudio", "bedrock", "other"]),
  daemon: new Set(["distill", "reminders", "taskgen", "skillgen", "headless_learn"]),
};

// ── Consent ──────────────────────────────────────────────────────────────────
export function usageOn(): boolean { return getPref(PREF.telemetryUsage, "0") === "1"; }
export function crashOn(): boolean { return getPref(PREF.telemetryCrash, "0") === "1"; }
export function setUsage(on: boolean) { setPref(PREF.telemetryUsage, on ? "1" : "0"); }
export function setCrash(on: boolean) { setPref(PREF.telemetryCrash, on ? "1" : "0"); }

// ── Anonymous id ─────────────────────────────────────────────────────────────
export function distinctId(): string {
  let id = getPref(PREF.telemetryDistinctId, "");
  if (!id) {
    id = (globalThis.crypto?.randomUUID?.() ?? `anon-${Math.random().toString(36).slice(2)}-${Date.now()}`);
    setPref(PREF.telemetryDistinctId, id);
  }
  return id;
}

// ── Scrubber ─────────────────────────────────────────────────────────────────
// Drop any key not on the allowlist; coerce values to safe primitives; enforce
// enum vocabularies. Returns a clean object that is safe to transmit.
function scrub(props?: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!props) return out;
  for (const [k, v] of Object.entries(props)) {
    if (!ALLOWED_PROPS.has(k)) continue;
    if (typeof v === "number" && Number.isFinite(v)) { out[k] = v; continue; }
    if (typeof v === "boolean") { out[k] = v; continue; }
    if (typeof v === "string") {
      const enums = ENUM_VALUES[k];
      if (enums) { if (enums.has(v)) out[k] = v; continue; } // unknown enum value → dropped
      // Non-enum strings (version, channel): allow only short, simple tokens.
      if (/^[\w.\-+]{1,40}$/.test(v)) out[k] = v;
    }
  }
  return out;
}

// ── Local transparency log (ring buffer, newest last) ────────────────────────
const LOG_KEY = "prevail.telemetry.log";
const LOG_MAX = 200;
export type LoggedEvent = { ts: number; event: string; props: Record<string, string | number | boolean>; sent: boolean };
export function telemetryLog(): LoggedEvent[] {
  try { return JSON.parse(lsGet(LOG_KEY, "[]") || "[]"); } catch { return []; }
}
function appendLog(e: LoggedEvent) {
  const log = telemetryLog();
  log.push(e);
  while (log.length > LOG_MAX) log.shift();
  lsSet(LOG_KEY, JSON.stringify(log));
}
export function clearTelemetryLog() { lsSet(LOG_KEY, "[]"); }

// ── Build-time keys (inert if absent) ────────────────────────────────────────
const POSTHOG_KEY = (import.meta as { env?: Record<string, string> }).env?.VITE_POSTHOG_KEY ?? "";
const POSTHOG_HOST = (import.meta as { env?: Record<string, string> }).env?.VITE_POSTHOG_HOST ?? "https://us.i.posthog.com";
const SENTRY_DSN = (import.meta as { env?: Record<string, string> }).env?.VITE_SENTRY_DSN ?? "";
export function telemetryConfigured(): boolean { return !!POSTHOG_KEY || !!SENTRY_DSN; }

// ── PostHog (lazy) ────────────────────────────────────────────────────────────
// The SDK is only imported on the first transmitted event — never at module load
// — so a user who never opts in pays zero bytes for it. Privacy-hardened init:
// no autocapture, no pageviews, no session recording, identified-only profiles,
// and IP/geo collection disabled server-side via the property below.
type PostHogLike = { capture: (e: string, p?: Record<string, unknown>) => void };
let _posthog: PostHogLike | null = null;
let _posthogInit: Promise<PostHogLike | null> | null = null;
function ensurePosthog(): Promise<PostHogLike | null> {
  if (_posthog) return Promise.resolve(_posthog);
  if (_posthogInit) return _posthogInit;
  if (!POSTHOG_KEY) return Promise.resolve(null);
  _posthogInit = import("posthog-js")
    .then(({ default: posthog }) => {
      posthog.init(POSTHOG_KEY, {
        api_host: POSTHOG_HOST,
        autocapture: false,          // never scrape DOM clicks/inputs
        capture_pageview: false,     // no URL/route capture
        capture_pageleave: false,
        disable_session_recording: true,
        disable_surveys: true,
        person_profiles: "identified_only",
        persistence: "localStorage",
        bootstrap: { distinctID: distinctId() },
        ip: false,                   // no IP collection
        property_blacklist: ["$current_url", "$pathname", "$host", "$referrer", "$referring_domain"],
      });
      _posthog = posthog as unknown as PostHogLike;
      return _posthog;
    })
    .catch(() => null);
  return _posthogInit;
}

// ── Public API ───────────────────────────────────────────────────────────────
/**
 * Record an anonymous usage event. Always allowlist-scrubbed and logged locally;
 * only transmitted if usage consent is on AND a PostHog key was built in.
 */
export function track(event: TelemetryEvent, props?: Record<string, unknown>) {
  if (!ALLOWED_EVENTS.includes(event)) return; // unknown event → never sent
  const clean = scrub(props);
  const willSend = usageOn() && !!POSTHOG_KEY;
  appendLog({ ts: Date.now(), event, props: clean, sent: willSend });
  if (!willSend) return;
  // Forward to PostHog. Lazy-inits the SDK on first send; the scrubbed `clean`
  // object is the ONLY payload — distinct_id is the random local UUID, IP/geo
  // and autocapture are disabled in init(). Fire-and-forget; never throws.
  void ensurePosthog().then((ph) => ph?.capture(event, clean)).catch(() => {});
}

/** Coarse OS family for the `os` property (never the full UA/machine name). */
export function osFamily(): "mac" | "win" | "linux" | "unknown" {
  if (typeof navigator === "undefined") return "unknown";
  const s = `${navigator.userAgent} ${navigator.platform}`.toLowerCase();
  if (s.includes("mac")) return "mac";
  if (s.includes("win")) return "win";
  if (s.includes("linux")) return "linux";
  return "unknown";
}
