# Security audit — Tier D (CLI connectors)

Self-audit of `src-tauri/src/ingestion/tier_d_cli.rs` and the `ingestion_cli_*`
commands. Tier D executes external CLI binaries, so it is the highest-risk
ingestion tier. This documents the controls and the residual risks for a human
reviewer before `v*` is tagged.

## What it does
On request, runs an allowlisted CLI's read-only command (e.g. `gh api user`,
`op item list`, `stripe balance retrieve`, `gcloud config list`) and ingests the
captured stdout into the matching domain via the shared `storage::ingest_artifact`
sink (SHA-256 + sidecar). Providers are defined in the bundled
`resources/connectors/cli_providers.json`.

## Controls (verified, with tests)
1. **No shell.** Execution is `std::process::Command::new(binary).args(args)` —
   never `sh -c`, never string interpolation of input. No shell metacharacter
   surface. (test: `run_captures_stdout_of_readonly_command`)
2. **Allowlist only.** The binary and args come solely from the bundled provider
   file. The JS/Tauri surface can only pick a provider by `id`; it cannot supply
   a binary, args, or flags. (`ingestion_cli_run` looks up by id, 404s otherwise.)
3. **Binary-name validation.** `valid_binary()` accepts only a bare
   `[A-Za-z0-9._-]{1,64}` token — no `/`, no `..`, no absolute paths, no spaces,
   no `;|$()`. Rejected names never spawn. (tests:
   `valid_binary_rejects_paths_and_injection`, `run_refuses_unsafe_binary_without_spawning`)
4. **Read-only commands.** Seeded `fetch_args` are all read-only
   (`api user`, `item list`, `balance retrieve`, `config list`). Autonomy beyond
   read is not exposed by Tier D.
5. **Timeout-bounded.** `RUN_TIMEOUT_SEC = 45`; the child is killed and reaped on
   overrun (reader threads drain stdout/stderr to avoid pipe deadlock).
6. **Output capped.** stdout truncated to `MAX_OUTPUT = 5 MiB` before it is
   written to disk.
7. **Network guard.** `ingestion_cli_run` calls `crate::bunker::guard_cloud()`
   first, so a CLI fetch is blocked in Bunker mode.
8. **No bundled CLIs.** Prevail never ships or installs a CLI. The user installs
   and authenticates it themselves (same model as Tier C requiring Node).
9. **No secret capture.** Output is ingested as a domain artifact; Tier D never
   reads or stores the CLI's own credentials.

## Residual risks / reviewer notes
- **Trust in the installed CLI.** Tier D runs whatever binary is first on `PATH`
  for that name. A user with a malicious `gh`/`op` shadowing the real one on PATH
  would run it. Mitigation relies on the user's own PATH hygiene; we augment PATH
  with the standard install dirs but do not pin absolute paths. Consider, as a
  follow-up, optionally pinning to `/opt/homebrew/bin` / `/usr/local/bin` or
  recording the resolved absolute path on first probe.
- **stderr is surfaced** in `last_error` on non-zero exit (first line only),
  which could echo a CLI's error text into the UI; it is not persisted to the
  vault.
- **Provider file integrity.** `cli_providers.json` ships inside the signed app
  bundle (read-only at runtime); a user editing the in-bundle copy is out of
  scope (they could also just run the CLI directly).

## Verdict
The implementation is conservative and matches the codebase's existing security
posture (no-shell, allowlist, fail-closed, Bunker guard). 6 unit tests cover the
validation + execution paths. **Recommended before shipping:** a human review of
this file + a decision on PATH pinning. The `v0.7.15` tag is intentionally held
pending that review and the founder's go.
