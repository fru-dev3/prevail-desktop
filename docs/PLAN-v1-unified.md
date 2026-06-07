# Prevail — Unified Plan (research + vision-gap + code audit)

Synthesizes three inputs: the competitive deep-research (`RESEARCH-landscape.md`),
the vision gap-analysis, and the codebase audit (`AUDIT-v1.md`).

## 1. Where Prevail actually stands (three lenses)

**Vision completeness.** The *foundation* is built and real: per-domain vault chat,
the durable intent ledger (never lose a chat), memory distillation, cross-model +
OpenRouter, usage tracking. The *proactive intelligence layer* (surface
questions/insights unprompted, auto-distill skills, auto-generate tasks/goals +
reminders) and *turnkey data connectors* (Plaid, email/IMAP) are the biggest gaps.

**Competitive reality.** The integration thesis is compelling, but most individual
pillars are commoditized: cross-model switching (OpenRouter, Cherry Studio ~47k★,
AionUi ~27.7k★), local-first markdown vaults (Reor, Khoj), proactivity (Khoj
automations, Saner.AI), durable memory (mem0 ~58k★ + $24M A), connectors (OpenClaw
60–100k★). **What no one combines** = Prevail's bundle: per-life-domain structure +
durable raw-transcript *intent ledger as source of truth* + per-domain distilled
journals + proactive vault-grounded insight + skills/goals distillation + **deep
financial/email data auto-sync**. Differentiation must come from the **intent-ledger +
domain-vault integration and connector depth**, not any single feature. It's
pre-traction vs high-traction incumbents → **distribution + integration depth win,
not feature novelty.**

**Code health.** Not production- or OSS-ready. Engine/CLI is close; the **desktop app
is blocked by the WebUI's remote attack surface** (P0). Plus structural debt
(App.tsx 12.4k lines, lib.rs 3k), zero desktop tests/CI, missing OSS governance.

## 2. Strategic implication

Stop adding commoditized features. Invest the next cycle in the **three things that
are both missing from Prevail AND defensible**:
1. **Data-connector depth** (Plaid bank sync, email/IMAP) — the research's most
   defensible moat; turns the vault from manual to auto-built.
2. **Proactive layer** — surface questions/insights/goals/tasks + reminders from the
   intent ledger & vault (the biggest vision gap).
3. **Auto-distillation into skills + tasks/goals** per domain.
…on top of a **secured, contributor-ready** codebase (so it can be open-sourced to
build distribution).

## 3. Prioritized roadmap

### P0 — Security gate (before any public release / enabling WebUI)
From `AUDIT-v1.md` §2. Headline: the WebUI bridge.
- [ ] Allowlist WebUI-proxied commands (deny-by-default); drop `provider_key_get`
      from remote surface (→ `provider_key_exists`); remove generic file r/w &
      `app_uninstall` from the remote surface.
- [ ] Bind `127.0.0.1` (Tailscale/tunnel for remote); real token auth
      (HMAC + httpOnly cookie, constant-time, rate-limit); enable CSP.
- [ ] Path/domain validation on filesystem commands; keychain writes via stdin;
      extend secret-redaction to API-key patterns; scrub env on ingestion spawns.
- [ ] **Decision:** ship v0.4.x with WebUI **feature-flagged OFF** if the token
      rework can't land immediately — neutralizes the worst surface today.

### P1 — Differentiators (the moat) + code health
Differentiators:
- [ ] **Connectors:** Plaid (bank) + email/IMAP auto-sync into per-domain vault
      context (build on the ingestion/MCP/Composio framework already present).
- [ ] **Proactive engine:** scan ledger + vault → surface questions, insights,
      and per-domain goals/tasks; reminders. (Engine `briefing` command is a seed.)
- [ ] **Auto-distill** learnings → reusable skills, and → tasks/goals per domain.
Code health (gates contributors):
- [ ] Desktop CI (tsc + biome + cargo test/clippy + build smoke); fix the
      sidecar-not-built-in-CI release gap.
- [ ] Decompose App.tsx (hooks + components) and split lib.rs (vault/chat/
      benchmark/threads/usage).
- [ ] Engine: single-source CliKind; enforce localOnly everywhere; OpenRouter
      integration tests; non-optional budget tracking.
- [ ] Rust correctness: lock-poison tolerance in daemons; distill cursor race.
- [ ] OSS governance for desktop: LICENSE, CONTRIBUTING, SECURITY, CoC, issue/PR
      templates; fix README/version drift (says v0.1, ships v0.4).

### P2 — Polish
WebUI invoke-timeout pruning, graceful daemon shutdown, markdown memoization,
domain metadata registry, dead-prop cleanup, `npm/cargo audit` in CI, lockfile
regen. (Full list in `AUDIT-v1.md` §4.)

## 4. Recommended sequence
1. **P0 WebUI hardening** (or feature-flag off) — unblocks a safe public release.
2. Remaining P0 backend/CLI security.
3. Desktop CI + sidecar-in-CI + governance docs (so it's safe to invite contributors).
4. **Then the moat:** connectors (Plaid/email) → proactive engine → auto-distillation.
5. Structural refactors behind the new tests (good first issues for contributors).
