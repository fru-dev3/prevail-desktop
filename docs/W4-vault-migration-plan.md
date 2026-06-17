# W4 — Vault file-structure reorg (engine migration)

**Status:** PLAN ONLY — needs founder sign-off before any code runs.
**Why gated:** this rewrites the on-disk layout of EVERY existing user vault. The
"never lose user data" hard rule means it ships only with a tested, reversible
migrator. Created 2026-06-16.

## Goal (from Monday feedback)
No loose files at the vault root. Everything lives in a folder. Apps + domains sit
together inside a `data/` folder via a prefix scheme.

## Today's root (loose files to relocate)
`_decisions.jsonl`, `_intents.jsonl`, `_skillgen.json`, `_taskgen.json`,
`usage.ndjson`, `profile.md`, `AGENTS-operating.md`, plus per-domain folders and
`apps/`.

## Proposed target layout
```
<vault>/
  data/
    domains/<d>/...        # was <vault>/<d> or <vault>/domains/<d>
    apps/<app>/...         # was <vault>/apps/<app>
  _meta/                   # runtime ledgers, out of the way
    decisions.jsonl        # was _decisions.jsonl
    intents.jsonl          # was _intents.jsonl
    skillgen.json / taskgen.json / usage.ndjson
  profile.md               # identity stays at root (read by read_user_md)
  ideal-state.md           # constitution stays at root
  AGENTS-operating.md
```
(Exact placement of profile/ideal/AGENTS is a founder call — they may prefer those
under `_meta/` too. Listed at root here because several readers hard-code them.)

## Work required
1. **Path layer audit.** Centralize every vault path in one resolver (cli
   `vault-data-layout.ts` already exists — extend it) so readers/writers don't
   hard-code roots. Desktop `paths.rs` mirrors this.
2. **Migrator.** `prevail vault migrate` (idempotent): detect old layout, snapshot
   via `git-vault` first, move files, write a `schema: N` marker, verify, and leave
   a one-line rollback path. Dry-run by default.
3. **Back-compat reads.** For one release, readers try new path then fall back to
   legacy, so a half-migrated or un-migrated vault never breaks.
4. **Tests.** Round-trip migrate on a fixture vault; assert byte-identical content,
   no orphans, rollback restores exactly.
5. **Desktop trigger.** Offer migration in Workspace with a clear "snapshot taken,
   reversible" affordance — never silent.

## Risk register
- Breaking the live `~/.prevail` vault (mitigate: git snapshot + dry-run + fallback reads).
- Path references missed across engine/desktop (mitigate: single resolver + grep audit + tests).
- Half-migrated state on crash (mitigate: marker file + idempotent re-run).

## Recommendation
Land behind the centralized resolver + fallback reads FIRST (no user-visible change),
ship that, then enable the migrator in a follow-up once the resolver is proven. Two
small releases beat one big risky one.
