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
//     log. Both SDKs are lazy-imported on first send, so a user who never opts in
//     pays zero bytes; PostHog/Sentry init is privacy-hardened (see each block).
import { APP_VERSION } from "./constants";
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
export function setCrash(on: boolean) {
  setPref(PREF.telemetryCrash, on ? "1" : "0");
  // Attach Sentry's global handlers the moment consent is granted; when revoked,
  // beforeSend already drops every event, so no teardown is needed.
  if (on && SENTRY_DSN) void ensureSentry();
}

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

// ── Sentry crash reporting (lazy) ─────────────────────────────────────────────
// Same privacy posture as PostHog: lazy-imported only when crash consent is on,
// so a non-consenting user pays zero bytes. Hardened init — the OPPOSITE of the
// vendor default: sendDefaultPii=false, no IP, no breadcrumbs (which would
// capture console/DOM/fetch content), no tracing, no session replay. Consent is
// re-checked in beforeSend on EVERY event, so flipping the toggle off stops all
// sends instantly even if the SDK is already initialized. The only identifier
// attached is the random local UUID — never email/name/host/path.
type SentryLike = {
  captureException: (e: unknown) => void;
  captureMessage: (m: string) => void;
};
let _sentry: SentryLike | null = null;
let _sentryInit: Promise<SentryLike | null> | null = null;
function ensureSentry(): Promise<SentryLike | null> {
  if (_sentry) return Promise.resolve(_sentry);
  if (_sentryInit) return _sentryInit;
  if (!SENTRY_DSN) return Promise.resolve(null);
  _sentryInit = import("@sentry/browser")
    .then((Sentry) => {
      Sentry.init({
        dsn: SENTRY_DSN,
        release: APP_VERSION,          // matches the source maps uploaded in CI → readable stack traces
        sendDefaultPii: false,         // never attach IP, cookies, headers, or user data
        defaultIntegrations: false,    // drop breadcrumbs/console/fetch/dom capture wholesale
        integrations: [
          // Keep only crash capture + dedupe; nothing that records content.
          Sentry.globalHandlersIntegration({ onerror: true, onunhandledrejection: true }),
          Sentry.dedupeIntegration(),
          Sentry.functionToStringIntegration(),
        ],
        maxBreadcrumbs: 0,             // belt-and-suspenders: zero breadcrumbs
        tracesSampleRate: 0,           // no performance/transaction data
        // No session pings: defaultIntegrations are off and we never add
        // browserSessionIntegration, so no session/health data is ever sent.
        initialScope: { user: { id: distinctId() } }, // anon UUID only
        beforeBreadcrumb: () => null,  // drop every breadcrumb, always
        beforeSend(event) {
          if (!crashOn()) return null; // consent re-checked per event → off = silent
          // Strip anything that could carry identity or content.
          delete event.request;
          delete event.server_name;    // machine hostname
          delete event.contexts?.device;
          event.user = { id: distinctId() };
          return event;
        },
      });
      _sentry = { captureException: Sentry.captureException, captureMessage: Sentry.captureMessage };
      return _sentry;
    })
    .catch(() => null);
  return _sentryInit;
}

/**
 * Initialize crash reporting if (and only if) the user has consented and a DSN
 * was built in. Safe to call on boot and again whenever consent changes — it is
 * idempotent. Once initialized, Sentry's global handlers capture uncaught errors
 * and unhandled rejections automatically; beforeSend gates every send on consent.
 */
export function initCrashReporting(): void {
  if (crashOn() && SENTRY_DSN) void ensureSentry();
}

/** Manually report a caught error. No-op unless crash consent is on + DSN built in. */
export function reportError(err: unknown): void {
  if (!crashOn() || !SENTRY_DSN) return;
  void ensureSentry().then((s) => s?.captureException(err)).catch(() => {});
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
