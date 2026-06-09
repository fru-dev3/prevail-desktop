# Prevail — Master Build Plan

> ## Build status (2026-06-09, updated)
>
> Almost the whole plan is now implemented engine-first and unit-tested, across
> both repos, all compiling/building. What's left is content authoring, the
> security-reviewed encryption phase, and the inherent human steps (a live GUI
> run + the signed release).
>
> | # | Feature | Implemented | Tested | Notes |
> | --- | --- | --- | --- | --- |
> | 1 | Usage analytics | **Done** | engine (15) + desktop unit tests, tsc, build | needs 1 live GUI smoke test |
> | 2 | Embedded vault | **Done** (migration + button) | engine (6 tests), cargo, build | first-launch default-flip lands via F3 auto-demo |
> | 3 | Demo/Prod + packages | **Done** (mode flag, 6 packs, import UI, banner, switch, auto-demo, seeded usage + threads) | engine (8 pack tests), tsc, build | content is extensible; tone worth a review |
> | 4 | Login + encryption | **Phase 0 done** (app lock) + **Phase 1 crypto core done** (9 tests) | engine (6 lock + 9 crypto), tsc, build | Phase 1 read/write integration remains (live-test + review) |
>
> **Engine: 243 tests pass. Desktop: 38 Rust tests pass. Both typecheck + build clean.**
>
> **What shipped to `main` this session (engine-first throughout):**
> - **F1:** `usage --domain` + one-shot `usage summary`; desktop delegates all
>   accounting to the engine (one ledger, one pricing table) + legacy migration;
>   per-domain Usage tab + global stats; WebUI free via the proxy.
> - **F2:** `vault-embed.ts` (app-owned `~/.prevail/vault` + non-destructive
>   copy/verify migration) + `prevail vault embed` + a desktop "Move into app"
>   button.
> - **F3:** `appMode` flag (demo|production) + `prevail appmode`; `prevail.pack/v1`
>   format with list/import/export + **6 bundled personas**; desktop demo banner,
>   switch-to-production, and starter-pack import UI.
> - **F4 Phase 0:** `prevail lock` (Argon2id verifier via Bun, passcode on stdin)
>   + a desktop LockScreen gate + Settings → Safety set/remove control. Honest
>   that it locks the UI but does not yet encrypt files.
>
> **Genuinely remaining (the honest gaps):**
> - **F3 demo content** — auto-entering demo on first launch, and authoring a
>   *complete* sample vault (threads + lessons + decisions + seeded usage across
>   domains, PII-free). This is content-authoring volume, best done against the
>   engine's existing "Alex Rivera" demo vault, and worth your eyes on tone.
> - **F4 Phase 1 (at-rest vault encryption)** — Argon2id-derived key + AES-GCM
>   envelope per file, recovery code, Touch ID, migration, multi-surface unlock.
>   Security-critical; deliberately left for a reviewed effort rather than shipped
>   blind. Phase 0 is the safe gate that's live now.
> - **Live verification + release** — I can't launch the Tauri app + sidecar
>   headless, so the cross-process paths (usage record/summary, vault embed, pack
>   import, lock verify) need one real GUI run; then a signed/notarized DMG +
>   engine release to reach users. Those are your manual steps.
>
> Detail per feature unchanged below.



One file, everything we've agreed to build, before you give the go-ahead.
Deep per-feature detail lives in the linked docs; this is the canonical plan and
the architecture discipline that ties it together.

- `USAGE-ANALYTICS-PLAN.md`
- `VAULT-EMBED-PLAN.md`
- `DEMO-MODE-PLAN.md`
- `SECURITY-LOCK-PLAN.md`
- `BUILD-BATCH.md` (sequencing)
- `NIGHT-WORK-2026-06-08.md` (already-shipped fixes, context only)

---

## 0. The architecture rule (this governs every line below)

**The CLI engine (`prevail-cli`) is the single source of truth. Every other
surface is a thin client of it. We never implement business logic more than
once.**

The four surfaces and how they relate:

```
                      ┌───────────────────────────┐
                      │   prevail-cli (ENGINE)     │
                      │  vault I/O · council · state│
                      │  modes · privacy · usage    │
                      │  EXPOSED AS --json / NDJSON │
                      └─────────────┬──────────────┘
            ┌─────────────┬─────────┼───────────────┬─────────────┐
            │             │         │               │             │
       prevail-tui   prevail-desktop (Tauri)   Telegram gateway   (future
       (terminal     ├── Rust engine.rs shells   ("2-way") —       surfaces)
        thin client)  │   to the bundled engine    telegram_bridge
                      │   sidecar                   spawns the CLI
                      └── React UI renders JSON     (run_cli)
                              │
                              └── Embedded Web App = the SAME React bundle
                                  served over HTTP (webui.rs + bridge.ts);
                                  every invoke() proxies to the desktop,
                                  which runs the engine. Zero duplicate UI.
```

Consequences we will hold ourselves to:

1. **New logic goes in the engine**, exposed as a `--json` subcommand. The
   desktop's Rust layer (`lib.rs`/`engine.rs`) should *call the engine*, not
   re-derive results. Where desktop Rust currently owns logic the CLI can't
   reach (e.g. `usage_summary`, `ui_settings`), we migrate it into the engine as
   part of this work, leaving a thin desktop shim.
2. **The embedded web app is free.** Because it's the desktop bundle served over
   HTTP and proxied to the engine, anything that works on desktop works on web
   automatically — *provided* state is engine/file-backed and not stuck in
   browser `localStorage`. (We already fixed theme + vault inheritance this way;
   the same rule applies to every feature here.)
3. **The 2-way (Telegram) already runs through the engine** (`run_cli`). New
   capabilities exposed as engine commands become reachable from Telegram for
   little extra cost.
4. **The TUI stays a pure NDJSON client.** Already true post engine-v1.7.0
   (council/modes/privacy/insights all come from the engine).

So each feature below is specified as: **Engine work → Desktop (thin) → Web
(free) → Telegram → TUI.**

### Where shared state lives (one place each)
- **User/config + mode + privacy + modes** → engine config at
  `~/.prevail/config.json` (engine already owns `UserConfig`, bunker, modes,
  privacy). The desktop/web read/write it *through the engine*, not via a
  parallel store.
- **Vault location** → engine-owned, with the desktop's `bootstrap-vault.txt` as
  the bridge for the WebUI (already wired). Embedding makes this deterministic.
- **Cross-device UI prefs (theme/palette)** → `ui_settings.json` (shipped). Fold
  into engine config in the Usage/Embed pass so there's one config surface.
- **Vault content + ledgers** (`_state.md`, `_decisions.jsonl`, `usage.ndjson`,
  threads) → the vault, read/written **only by the engine**.

---

## 1. Usage & Cost Analytics  *(build first — lowest risk, no vault-location dependency)*

**Goal:** per-domain and global visibility into queries, tokens, cost, by
provider and by specific model, including over-time trends.

**Engine work (the core):**
- Promote usage from a desktop-only feature to an engine command:
  `prevail usage --json [--domain <slug>] [--by cli|model|domain|day]
  [--since <date>]`. It reads `<vault>/usage/usage.ndjson` and returns totals +
  buckets, including a new **`by_day`** time series (the `day` field is already
  captured per record).
- Move the aggregation that currently lives in desktop `lib.rs::usage_summary`
  into the engine so the CLI, TUI, Telegram, and desktop all report identical
  numbers. Desktop `usage_summary` becomes a thin call into the engine.
- Single source of truth for **model pricing** in the engine (so every surface
  costs a turn the same way). Stamp "prices as of <date>".

**Desktop (thin):** add a **"Usage" tab on the domain view** (domain-scoped) and
promote the existing global `UsageDashboard` into a first-class **Stats** view
with sections: overview · over-time · by-provider (`cli`) · by-model · by-domain.
Reuse one `UsageBreakdown` component for both altitudes.

**Web (free):** the Stats views render in the embedded web app automatically;
just allowlist the read-only `usage` command in `WEBUI_ALLOWED`.

**Telegram (2-way):** `prevail usage` means a `/usage` or "what did I spend this
week" reply is a near-free add.

**TUI:** add a stats panel fed by the same NDJSON.

Detail: `USAGE-ANALYTICS-PLAN.md`.

---

## 2. Embedded (app-owned) Vault  *(foundation for 3 and 4)*

**Goal:** the vault lives inside app-managed storage by default, not a loose
folder the user has to manage, while keeping an escape hatch for external
folders.

**Engine work:** the engine owns "where is the vault" — a resolved default at an
app-data path, plus the existing `bootstrap-vault.txt` bridge for the WebUI. Add
engine commands for the non-destructive **migration** (copy external → embedded,
verify counts/checksums, repoint) so desktop, CLI, and TUI all relocate vaults
through the same verified path. Never move/delete originals (repo hard rule).

**Desktop (thin):** default new installs to the embedded location (no folder
picker); Settings → Vault shows the path read-only + a "Move vault into the app"
button that calls the engine migration; keep "Use an external folder instead" as
the power-user escape hatch.

**Web (free):** already inherits the desktop's authoritative vault; embedding
makes that path deterministic and removes stale-folder drift.

**Telegram / TUI:** they resolve the vault from engine config, so they follow
the embedded default with no extra work.

**The only thing to confirm (not a blocker):** you said desktop is primary but
the **2-way matters and the CLI is the main driver**. So we keep the standalone
`prevail-cli`/`prevail-tui` fully working on the embedded vault by having them
resolve location (and later the unlock key) from engine config — which is the
plan anyway. External editors (Obsidian/git) only keep working on *external*
vaults; that's what the escape hatch is for.

Detail: `VAULT-EMBED-PLAN.md`.

---

## 3. Demo Mode → Production Mode + Role Packages

**Goal:** launch straight into a complete, populated demo vault; a clear "Demo
mode" marker; one click to switch to a real production vault keeping the domains;
importable persona packages to populate a vault.

**Engine work:**
- A persisted **`mode` flag** (`demo` | `production`) in engine config, so every
  surface agrees on which mode you're in.
- **Demo seeding**: copy the bundled demo vault into the app-owned demo location
  on first run (uses the embed-plan location). Engine command so CLI/desktop
  share it.
- **Switch to production**: an engine command that points at the chosen vault and
  optionally carries the demo domain *structure* (stripping the canned
  threads/lessons) — so the user never hand-creates domains.
- **Package import/export**: define `prevail.pack/v1` (a JSON manifest of
  domains: soul/goals/config/prompts/skills, no fabricated PII). Engine command
  `prevail pack import <file>` / `export` that creates domains via the existing
  `create_domain` path. Bundle the 6–7 packages in-app so import works offline.

**Demo content build (real work, not just plumbing):** make the demo vault
genuinely complete across **health, tax, home, estate, calendar, email** (+ the
existing wealth/learning/insurance/chief): every demo domain needs
soul+goals+config, a populated `_state.md`, ≥1 **sample thread**, ≥1
**decision/lesson**, sample prompts, and a realistic `usage.ndjson` (so the
Stats tabs from #1 aren't empty). All fictional, **no real PII** (we just removed
the benchmark leak — do not reintroduce it). Ship a per-domain coverage
checklist.

**Desktop (thin):** auto-enter demo on first launch (no wizard); a "Demo mode"
badge (sidebar footer + Settings banner, lucide icon, no emoji); a "Switch to
Production" flow (pick location → empty / keep-domains / import-package); an
"Import a package" action.

**Web (free):** mode flag + badge come from engine config, so the web app shows
the same demo/production state.

**Packages hosting:** bundle in-app + host extras on **GitHub Releases**
(`prevail-packs`), keeping Netlify bandwidth free (house rule).

Detail: `DEMO-MODE-PLAN.md`.

---

## 4. App Login + Vault Encryption  *(last — highest risk)*

**Goal:** optional username/password profile that gates the app, and (the real
value) at-rest encryption of the vault so the files aren't readable off disk.

**Why engine-first is non-negotiable here:** the engine reads/writes every vault
file. If encryption lived only in the desktop, the CLI, TUI, and Telegram would
all break on an encrypted vault. So **encryption is an engine capability**: the
engine derives the key (Argon2id), holds it in memory for the session, and
encrypts/decrypts vault files (envelope encryption, AES-256-GCM per file).

**Key flow across surfaces:**
- Desktop unlocks (password or Touch ID via Keychain) and hands the in-memory
  key to the **bundled engine sidecar**, so chat/council keep working.
- The 2-way and standalone CLI/TUI get their own unlock prompt when opening an
  encrypted vault (they call the same engine key-derivation).
- The WebUI never sees the key — it proxies to the desktop, which already holds
  it. (Architecture already fits.)

**Phasing:**
- **Phase 0:** app lock only (Argon2 verifier, gate desktop + WebUI login),
  clearly labeled "does not encrypt files yet — that's next." Honest, low risk.
- **Phase 1:** opt-in encryption of production vaults; recovery code at setup;
  Touch ID unlock; in-place migration with a verified backup first.
- **Phase 2:** filename encryption, idle auto-lock, plaintext export, standalone
  CLI/TUI unlock polish.

Encryption never applies to the demo vault. Threat model, KDF params, and
what-breaks detail: `SECURITY-LOCK-PLAN.md`.

---

## 5. Recommended sequence

1. **Usage analytics** — additive, no vault-location dependency, exercises the
   "move logic into the engine, render everywhere" pattern on a low-risk feature.
2. **Embedded vault** — establishes the app-owned location every other feature
   builds on.
3. **Demo / Production + packages** — sits on the embedded location; includes the
   real demo-content build.
4. **Login + encryption** — engine-level key handling, after the vault is
   app-owned.

Each feature is shipped engine-first, then desktop, with web/telegram/tui
following from the shared contract. Each lands behind a typecheck + `cargo check`
+ engine tests, committed and pushed per your standing rule, and reaches users
only on the next signed/notarized DMG (+ engine release for the sidecar).

---

## 6. Decisions I need before "go"

Most have a recommended default in brackets — reply "use defaults" and I'll run
with all of them.

**Architecture / scope**
1. Confirm the engine-first rule above is how you want it: new logic in
   `prevail-cli`, desktop/web/telegram as thin clients, migrating desktop-only
   logic (usage, ui_settings) into the engine as we touch it. [Recommended: yes]
2. Standalone CLI/TUI must stay first-class against the embedded **and**
   encrypted vault (resolve path + unlock key from engine config), not just
   desktop. [Recommended: yes — matches "CLI is the main driver"]

**Usage**
3. Default time window for "over time": 30 / 90 / all-time. [Recommended: 90 days
   with all-time toggle]

**Demo / packages**
4. On "switch to production, keep domains": keep the example prompts/skills as
   scaffolding, or strip to bare domain shells? [Recommended: keep prompts/skills,
   strip the canned threads/decisions]
5. Confirm persona list (6–7): Small Business Owner, Family, Student,
   High-Income, Freelancer/Consultant, Retiree/Estate, Creator/Brand. [Recommended:
   this set]
6. Host packages on GitHub Releases + bundle in-app. [Recommended: yes]
7. Demo persists forever until the user switches (no time limit). [Recommended: yes]

**Encryption**
8. Ship Phase 0 (app lock, no encryption) first as its own release, then Phase 1
   encryption? [Recommended: yes]
9. Recovery model if the password is forgotten: recovery code at setup vs accept
   data loss. [Recommended: recovery code]
10. Touch ID unlock in Phase 1? [Recommended: yes]

**Release**
11. Ship each feature as its own DMG + engine release as it lands, or batch them
    into one bigger release? [Recommended: ship #1 and #2 together, then #3, then
    #4 — so encryption gets its own careful release]

Give me your answers (or "use defaults") and I'll start at #1.
