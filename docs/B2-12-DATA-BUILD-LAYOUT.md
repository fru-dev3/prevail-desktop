# B2-12 — Vault on-disk layout: `data/` + `build/`

**Branch:** `feat/b2-12-data-build-layout`
**Status:** plan + Phase 1 in progress. This is a DESTRUCTIVE on-disk migration, so
it ships only behind a verified, reversible migrator. "Never lose user data" governs.

## Target layout
```
<vault>/
  data/                 # the user's content (already done by the W4 migrator)
    domains/<d>/...
    apps/<app>/...
  build/                # supporting/runtime files (NEW in B2-12)
    benchmark/  complete/  core/  usage.ndjson
    _decisions.jsonl  _intents.jsonl  _journal.md  _surface.json
    _meta/  _threads/  AGENTS-operating.md
  profile.md            # identity stays at root
```
Root ends up as just `data/`, `build/`, `profile.md`.

## Why this is phased (not a one-shot)
Runtime-file paths are built ad-hoc in **~44 files** across cli + desktop
(benchmark 88×, `_meta` 29×, `_threads` 27×, `_intents.jsonl` 17×, `_decisions.jsonl`
6×, `_journal.md` 4×, `usage.ndjson` 2×, `_surface.json` 1×). Moving them to `build/`
safely requires every reader/writer to resolve through ONE place first.

## Phases
1. **Central resolver (additive, zero behavior change).**
   - cli `path-safety.ts`: add `buildRoot(vault)` and `runtimePath(vault, name)`
     that returns `build/<name>` when `build/` exists, else the current location.
   - desktop `paths.rs`: mirror `build_root(vault)` + `runtime_path(vault, name)`.
   - No files moved yet; resolvers fall back to today's paths, so nothing changes.
2. **Route the ~44 sites through the resolver.** Replace each ad-hoc
   `join("_decisions.jsonl")` / `"_threads"` / `"benchmark"` / `usage.ndjson` /
   `_meta` / `_intents.jsonl` / `_journal.md` / `_surface.json` with the resolver.
   Mechanical but wide; do per-file with tests after each cluster.
3. **Migrator.** Extend `vault-data-layout.ts`: after `data/` is populated, COPY the
   runtime entries into `build/`, verify counts, then (separate opt-in, like
   `archive-data`) remove the originals. Idempotent; snapshot via git-vault first.
4. **Desktop trigger + UI.** A "Tidy into data/ + build/" action (replaces the
   current Tidy) that runs the migrator with the snapshot + diff affordance.
5. **Back-compat reads** for one release: resolver tries `build/` then legacy, so a
   half-migrated or un-migrated vault always works.

## Site inventory (grep targets to convert in Phase 2)
- `_decisions.jsonl`, `_intents.jsonl`, `_journal.md`, `_surface.json`, `usage.ndjson`
- dirs: `_meta/`, `_threads/`, `benchmark/`, `complete/`, `core/`
- file: `AGENTS-operating.md`
Run: `grep -rlE "_decisions\.jsonl|_intents\.jsonl|usage\.ndjson|_threads|_meta|benchmark/" prevail-desktop/src-tauri/src prevail-cli/src`

## Risk register
- Lost `_threads`/`_decisions` on a botched move → COPY+verify before any delete; git snapshot first.
- A missed site reading the old path after move → Phase 5 fallback reads cover the gap.
- Cross-repo drift (cli sidecar vs desktop) → land resolver in both before the migrator ships.

## Phase 2 findings (IMPORTANT — discovered while implementing)
1. **Per-domain vs root.** Most runtime-file sites are PER-DOMAIN
   (`<domain>/_intents.jsonl`, `_decisions.jsonl`, `_journal.md`) via `domain_dir`
   — these stay INSIDE the domain (under data/domains/<d>); they do NOT move to
   build/. Only the vault-ROOT "General" bucket + top-level dirs move.
2. **General-bucket classification needs a founder call.** `domain_dir(None)` (the
   General/root bucket) serves BOTH clearly-supporting files (ledgers, _journal,
   _surface, _threads) AND arguably-content files (`_memory.md`, `_state.md`,
   `_skills/`). A blanket resolver swap would over-move content. DECISION NEEDED:
   for the General bucket, which go to build/ (supporting) vs stay as content?
   Recommend: ledgers + _journal + _surface + _threads + _meta → build/;
   _memory.md + _state.md + _skills → content (root/data).
3. **Safe lever.** `build_root(vault)` == vault root until `build/` exists, so
   wrapping a vault-root path in it is a RUNTIME NO-OP until the migrator runs —
   Phase-2 routing is safe to land incrementally, even unverified.

### Phase 2 progress (this branch)
- DONE (desktop, no-op until build/): `benchmark/` (benchmark.rs ×5) and `_meta/`
  (idealstate, intent_daemon, intents) resolve via `build_root`. cargo check green.
- TODO: General-bucket ledgers/_threads (pending the classification call);
  cli-side routing for usage.ndjson + benchmark + _meta (the engine owns those);
  then Phase 3 migrator.

## Recommendation
Land Phases 1–2 (resolver + routing, no destructive move) and ship; then Phase 3–4
(migrator + trigger) in a follow-up once routing is proven. Two safe releases beat
one risky one. Until then, the existing `data/` migrator already cleanly nests
apps+domains under `data/` (the founder's primary ask).
