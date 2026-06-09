# Plan: Demo Mode -> Production Mode + Importable Role Packages

Status: **DESIGN ONLY.** Part of the batch to build alongside
`SECURITY-LOCK-PLAN.md` and `VAULT-EMBED-PLAN.md`. Captures your notes; nothing
built yet.

## Goal

A new user launches Prevail and is **immediately inside a fully-populated demo
vault** — real-looking domains, prompts, threads, and lessons — so they can chat
and feel what the product does without setting anything up. A clear "Demo mode"
marker in Settings. One click flips them to **Production mode**: the demo markers
disappear, they choose where their real vault lives, and they keep working
(optionally seeding it from an importable role package) without hand-creating
domains.

## Current behavior (what we're changing)

- First launch with no remembered vault renders `VaultWizard` (App.tsx ~2084,
  `if (!vaultPath)`), which asks the user to **pick a folder** or **load the
  sample**. So today the demo is opt-in and gated behind a choice.
- `import_sample_vault` (lib.rs) copies the bundled
  `resources/sample-vault/` into `~/Documents/Prevail Sample Vault` and points
  the vault there. The sample vault has domains: home, wealth, calendar, mail,
  learning, health, tax, chief, explore, insurance.
- No concept of "mode" (demo vs production) exists yet.

## The model

### Three concepts
1. **Mode**: `demo` | `production`. A single persisted flag (server-side, in the
   new `ui_settings` store so the WebUI agrees).
2. **Demo vault**: the bundled sample data, copied into an app-managed location
   on first launch (ties into `VAULT-EMBED-PLAN.md` — the demo vault should live
   in app storage, not dumped in `~/Documents`).
3. **Role packages**: downloadable bundles that populate a *production* vault
   with starter domains tailored to a persona.

### First-launch flow (demo by default)
- No remembered vault AND no mode set -> **auto-enter demo mode**: copy the
  bundled demo vault into `Application Support/.../demo-vault/`, set
  `mode=demo`, skip the wizard entirely. User lands in a populated app.
- A persistent but unobtrusive **"Demo mode" badge** (sidebar footer + a banner
  on the Settings page) with a "Switch to production" button. Use a lucide icon,
  no emoji (per house style).

### Switch to production
Settings -> a clear "You're in Demo mode" card -> "Switch to Production":
1. Choose vault location (folder picker on desktop; embedded default per the
   embed plan). In the browser/WebUI this is desktop-driven.
2. Choose starting content:
   - **Start empty** (just the domain scaffolding), or
   - **Keep the demo domains** (copy demo structure, strip the canned
     threads/lessons so it's *their* data going forward), or
   - **Import a role package** (see below).
3. Set `mode=production`, remove all demo badges/banners, repoint the vault.
4. Never delete the demo vault silently — archive it (repo hard rule: never
   delete user data).

Key requirement you called out: **in production they do NOT have to create
domains by hand** — they inherit the demo domain set (or a package's), just
without the sample conversations.

## Role packages (importable persona bundles)

- 6-7 downloadable bundles, e.g.: **Small Business Owner, Family, Student,
  High-Income Individual, Freelancer/Consultant, Retiree/Estate-Planning,
  Creator/Brand.**
- Each package = a single importable file that pre-populates domains (config +
  goals + starter state + suggested prompts), WITHOUT fabricated personal data.
- **Format:** a versioned `.prevailpack` (really a JSON manifest, optionally
  zipped if it carries multiple files):
  ```jsonc
  {
    "schema": "prevail.pack/v1",
    "name": "Small Business Owner",
    "version": "1.0.0",
    "domains": [
      { "slug": "business", "soul": "...", "goals": "...", "config": {…},
        "prompts": ["…"], "skills": ["…"] }
    ]
  }
  ```
- **Import:** Settings -> "Import a package" -> validate schema -> create domains
  in the active vault -> never overwrite an existing domain without confirm.
  Reuses the existing `create_domain` command + writes `soul.md`/`goals.md`.
- **Export (bonus):** let a user export their own vault structure (no private
  content) as a package to share — turns the format into a community asset.
- **Hosting (open question):** the packages are small static files. Options:
  - GitHub Releases on a `prevail-packs` repo (free, versioned, fits the
    "no binaries on Netlify" rule — these are tiny JSON, but Releases is still
    the clean home and keeps Netlify bandwidth free). **Recommended.**
  - A `packs/` path on prevail.sh (simplest, but watch Netlify bandwidth).
  - In-app: ship the 6-7 packages **bundled** as resources too, so import works
    offline and the "download" is only for community/extra packs.

## Demo-vault content (must be genuinely complete)

The demo's job is to sell the product, so it has to look finished across the
domains you named (**health, tax, home, estate, calendar, email**, plus the
existing wealth/learning/insurance/chief). For EACH demo domain we need:
- `soul.md` + `goals.md` + `config.md` (present today).
- A populated `_state.md` and `_journal`/`_log` (present for some, not all).
- **Sample threads** (`_threads/*.md`) — real-feeling multi-turn conversations.
  *Gap:* most demo domains don't ship threads yet. This is build work.
- **Sample lessons / decisions** (`_decisions.jsonl`, `_skills/PROMPTS.md`,
  `_meta/MEMORY.md`) so the self-learning surfaces have something to show.
- **No real PII.** Everything fictional but plausible (we just removed the
  benchmark PII leak — do not reintroduce it). "estate" must be a clean,
  fictional estate-planning domain.

Add a domain coverage checklist before shipping: every demo domain has
soul/goals/config + state + >=1 thread + >=1 decision + prompts.

## Interaction with the other plans

- **Embed (`VAULT-EMBED-PLAN.md`):** demo vault lives in app storage; switching
  to production is exactly the "choose/where-does-the-vault-live" decision. Build
  these together.
- **Sync (#6, shipped):** `mode` and theme both live in `ui_settings` so the
  WebUI reflects demo/production state too. The demo badge must show in the web
  view as well.
- **Encryption (`SECURITY-LOCK-PLAN.md`):** demo mode is never encrypted (it's
  throwaway sample data); encryption only applies after production switch.

## Phased build

- **Phase 1:** `mode` flag + auto-demo on first launch + demo badge in
  Settings/sidebar + "Switch to production" (empty or keep-domains). No packages
  yet.
- **Phase 2:** Role packages — define `prevail.pack/v1`, build the 6-7 bundles,
  bundle them in-app + host extras on GitHub Releases, import/validate UI.
- **Phase 3:** Package export + a small in-app package gallery.

## Open questions for you
1. On "switch to production with keep-domains" — keep the demo's example
   prompts/skills (useful scaffolding) or strip everything but the domain shells?
2. Package count + exact persona list — confirm the 6-7.
3. Host packages on GitHub Releases (recommended) vs prevail.sh?
4. Should demo mode be time/usage limited or persist forever until they switch?
   (Recommend: persists forever; switching is always user-initiated.)
