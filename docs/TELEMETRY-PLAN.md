# Prevail Telemetry Plan — PostHog + Sentry (privacy-first)

**Status:** PLAN (awaiting founder review + credentials)
**Owner goal:** Understand downloads + usage + which features are used, and catch
crashes — WITHOUT collecting user data, respecting governance, fully transparent,
anonymous, and impossible to "get into trouble" over.

Prevail is a privacy-first app whose whole pitch is "your life's context stays
yours." Telemetry must never undercut that. The bar: a privacy-conscious user
reading exactly what we send should shrug, not recoil.

---

## 1. Principles (non-negotiable)

1. **Opt-in, default OFF.** No telemetry until the user explicitly turns it on.
   (For a vault-holding app, opt-out-by-default would be a trust violation.)
2. **Anonymous only.** A random local UUID as `distinct_id`. Never email, name,
   IP-as-identity, machine name, file paths, or anything that identifies a person.
   (PostHog: disable IP/geo or truncate; Sentry: `send_default_pii: false`.)
3. **No content, ever.** No prompts, no replies, no vault text, no domain/app
   names the user created, no skill bodies, no Ideal State, no file contents.
4. **Event names + coarse counts only.** "chat_sent" with `{provider: "openrouter"}`
   — never the message. "benchmark_run" with `{models: 3, domains: 11}` — never the
   questions. A hard allowlist of property keys; everything else is dropped.
5. **Transparent + inspectable.** An in-app "What we collect" page lists every
   event and property verbatim. A local telemetry log lets the user see exactly
   what would be / was sent.
6. **Killable instantly.** One toggle off = SDKs flushed and disabled; no events.
   If keys are absent at build time, telemetry code is fully inert.

## 2. Tool split

- **Sentry** — stability. Unhandled JS errors + Rust panics (Tauri), with stack
  traces scrubbed of paths/PII. `send_default_pii=false`, `beforeSend` strips any
  string that looks like a vault path or home dir. Sample rate tunable.
- **PostHog** — product analytics. Anonymous events: app opened, app version,
  OS family (mac/win), feature-used pings, and (on the website) downloads +
  pageviews. Autocapture OFF (it would hoover DOM text); manual events only.

## 3. What we collect vs never collect

| Collected (allowlisted)                              | NEVER collected                         |
|------------------------------------------------------|-----------------------------------------|
| `app_opened` {version, os: mac/win, channel}         | Prompts / replies / any chat content    |
| `feature_used` {feature: "benchmark"\|"council"\|…}  | Vault contents / file paths / file names|
| `benchmark_run` {models:int, domains:int}            | Domain/app/skill NAMES the user created |
| `provider_configured` {provider: "openrouter"}       | API keys / secrets / tokens             |
| `daemon_toggled` {daemon, on:bool}                   | Email, name, machine name, precise geo  |
| (web) `download` {os}, `pageview` {path}             | IP used as identity (disabled/truncated)|
| Sentry: error type + scrubbed stack + app version    | Any free-text the user typed            |

Property values are constrained to enums/ints/bools. A scrubber drops any string
not on the allowlist so a content leak can't happen by accident.

## 4. Consent + governance UX (build this FIRST, no creds needed)

- **First-run / Settings → Privacy → "Product analytics & crash reports"** toggle,
  default OFF, with a plain-language summary and a link to the detail page.
- **"What we collect" page**: the full event/property table above, rendered in-app,
  plus "Open telemetry log" (the local JSONL of what was sent) and a "Send a test
  event" button so it's verifiable.
- **Separate sub-toggles** (optional): "Crash reports (Sentry)" and "Usage
  analytics (PostHog)" independently, so a user can allow crash reports but not
  usage. Recommended.
- Consent state stored locally (`prevail.telemetry.*` prefs) and mirrored to the
  vault's privacy settings.

## 5. Security of keys

- PostHog **project API key** and Sentry **DSN** are *publishable* client keys by
  design (write-only ingestion) — they're not secrets like an admin token. Still:
  injected at build time via env (`VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST`,
  `VITE_SENTRY_DSN`), never hard-coded, and absent → telemetry inert.
- Admin/personal-API keys for PostHog/Sentry dashboards stay only in your
  1Password / CI secrets, never in the repo or the shipped app.
- Self-host option: PostHog host is configurable (EU cloud or self-hosted) for
  data-residency comfort.

## 6. Implementation surfaces

- **Desktop (this repo):** `src/telemetry.ts` (init + guarded `track()` +
  scrubber + allowlist), `@sentry/react` + `posthog-js`, Rust panic hook → Sentry
  (or forward to JS). Privacy settings UI in the Safety/Privacy section.
- **Website (prevail-web):** PostHog snippet (consent-gated cookie banner),
  `download` event on installer clicks, Sentry for site JS errors. Lighter bar
  (no vault), but still disclosed + consent-gated.
- **Docs:** this plan, a public `TELEMETRY.md` (user-facing), and a privacy-policy
  section on the site.

## 7. What I need from you (after you approve the plan)

1. PostHog **project API key** + host (US `https://us.i.posthog.com`, EU, or self-host).
2. Sentry **DSN** (one for desktop, optionally a separate one for the website).
3. A nod on defaults: **opt-in default-OFF** (my strong recommendation) and
   **independent crash vs usage sub-toggles** (recommended).

Until then I'll build everything in section 4 (consent + "what we collect" page +
inert telemetry module) so that adding the two keys later is a one-line switch.
