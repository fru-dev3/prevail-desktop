# W4 — Vault file-structure reorg (engine migration) — IMPLEMENTED

**Status:** DONE and shipped. (This doc originally read as a plan; on review the
work was already built — corrected 2026-06-16.)

## What's built
- **Migrator:** `prevail-cli/src/vault-data-layout.ts` — `migrateToDataLayout()` is
  **non-destructive** (COPIES content into `<vault>/data/`, verifies every file is
  accounted for, then repoints the configured vault to `data/`). Idempotent: a
  re-run on an already-migrated root is a no-op (never nests `data/data/`).
- **No data loss by design:** migrate never deletes. The loose originals are left
  in place until you separately run `prevail vault archive-data --force`, which
  MOVES them into a timestamped `_pre-data-*` archive (still never deletes).
- **CLI:** `prevail vault migrate-data` (+ `--json`) and `prevail vault archive-data --force`.
- **Desktop:** exposed via `engine_vault_migrate_data` (settings8.tsx, registered in
  `src-tauri/src/lib.rs`).
- **Path resolvers prefer `data/`:** `src-tauri/src/paths.rs` and the cli resolvers
  read from `<vault>/data/...` when present, legacy layout otherwise — so the app
  works before AND after migration.
- **Tests:** `prevail-cli/src/vault-data-layout.test.ts` — 8 passing (copy
  completeness, idempotency, already-migrated detection, marker handling).

## Optional future polish (not required)
- A `--dry-run` preview on `migrate-data` (it's already safe to run since it only
  copies, but a preview is a nice affordance).
- A one-click "tidy vault" affordance in the Workspace UI that runs migrate then
  offers archive, with the diff shown.

Conclusion: W4 needs no founder sign-off to be "done" — it's implemented, tested,
non-destructive, and shipped. Running `archive-data` (the only step that moves
originals) is already explicitly opt-in behind `--force`.
