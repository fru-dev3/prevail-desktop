# Omega — the app-wide learned knowledge layer

**Status:** building v1 on branch `feat/omega` (desktop + prevail-cli). NOT merged/released.
**One line:** a single vault-level `omega.md` that captures durable, cross-cutting lessons,
preferences, and meta-patterns learned across EVERY domain and the app itself, injected into
every model turn at the precedence just below the Ideal State.

## Why

Today Prevail has four knowledge layers, but a gap:

| Layer | Scope | Source | In every prompt? |
|---|---|---|---|
| `ideal-state.md` | app-wide | **authored** (your constitution: vision + values) | yes, HIGHEST precedence |
| `user.md` | app-wide | authored (who you are) | yes (profile, opt-in) |
| `_meta/intents_distilled.json` | cross-domain | learned (intents/goals only) | indirectly (loops) |
| `<domain>/_memory.md` | per-domain | learned (distilled chats) | yes, but domain-only |

The **learned** layer (`_memory.md`) stops at the domain boundary. The **app-wide** layer
(`ideal-state.md`) is authored, not learned. Nothing is the *learned, above-everything* layer:
cross-cutting lessons ("decisions consistently favor X"), durable preferences ("answer tersely
everywhere"), and meta-patterns true across all domains + settings + the app.

**Omega is the learned counterpart to `ideal-state.md`.** Name: alpha/omega = above everything.
(In-vault `omega.md`; conceptually mirrors the user's personal cross-system `~/.ai/OMEGA.md`,
one level down and app-scoped.)

## Precedence (the order that matters)

Injected ahead of framework / domain state / domain memory, in this order:

1. `ideal-state.md` — what you WANT. Wins all conflicts. (unchanged)
2. **`omega.md` — what we've LEARNED across everything.** (new, this layer)
3. operating manual / framework
4. domain state + `_memory.md` (domain-only learned)
5. conversation history + the message

Ideal State always wins a conflict with Omega; Omega informs, it does not override stated values.

## Files

- `<vault>/omega.md` — the file. Beside `ideal-state.md`. Human-readable markdown.
  Two regions:
  - a free-form top the user authors/curates by hand (and "remember this everywhere" appends to),
  - a managed block delimited by `<!-- omega:auto:start -->` / `<!-- omega:auto:end -->` that the
    distiller owns (rewritten each pass; never clobbers the user's hand-written part).
- `<vault>/_meta/omega_distill_cursor.json` — idempotency cursor (mirrors intents distiller).

## Components

### A. Injection (engine + desktop) — the core; makes Omega real everywhere
- **Engine (`prevail-cli/src/cli-bridge.ts`):** add `findOmega(vaultPath)` (cache + refresh,
  same pattern as `findIdealState`), `buildOmegaPreamble(omega)`. Inject right AFTER the
  constitution: claude via `--append-system-prompt` (`[constitution, omega, manual]`), other CLIs
  prepended to the prompt. Char-budget capped (~3000). This covers chat, council, suggestions,
  surface, and every headless daemon path automatically.
- **Desktop (`chatpanel.tsx` send path):** prepend `buildOmegaPreamble(omegaMd)` after
  `userPreamble` (ideal-state) and before `memoryPreamble`. Load via `read_omega` per vault.

### B. Read/write (Rust `src-tauri/src/idealstate.rs` sibling, or new `omega.rs`)
- `read_omega(vault)` → contents or a starter template (mirror `read_ideal_state`).
- `write_omega(vault, body)` → write + snapshot a version (reuse the ideal-state versioning if easy).
- Register both in `lib.rs`.

### C. Distiller (engine) — makes it LEARNED, not just authored
- `prevail-cli`: `distillOmega({ vault, provider, model })` reads across ALL domains
  (`enumerate_domain_dirs`): each `_memory.md` + `state.md` head + `_meta/intents_distilled.json`,
  and (cheap model call) lifts ONLY cross-cutting, durable items into a tight list:
  lessons, preferences, recurring patterns, meta-notes. Writes the managed block in `omega.md`.
  Idempotent via the cursor (skip if nothing materially changed). Mirror `intents_distill`.
- CLI subcommands: `prevail omega distill` and `prevail omega read`.
- Tauri command `omega_distill(vault, provider, model)` + a "Distill now" button.

### D. UI (desktop)
- New **Omega** settings page under "Memory & Routines" (nav id `omega`), mirroring the Ideal
  State page but lighter: prominent intro, the rendered markdown (auto block visually distinct
  from the authored part), an Edit toggle, a "Distill now" button, version history.
- "Remember everywhere" affordance from chat (later): appends a one-liner to the authored region.

### E. Automation (daemon) — optional in v1, fast-follow
- An `omega_daemon` toggle on the Routines page: re-distill on a cadence / after N new
  per-domain memory updates. Reuse the intent-daemon cadence pattern. Default ON, low frequency
  (it is meta; it should change slowly).

## Guardrails (the thing to get right)
- **Tight budget.** Hard char cap on the injected preamble (~3000). An app-wide file in every
  prompt is the easiest way to bloat context and degrade answers.
- **High bar for inclusion.** The distiller keeps ONLY durable + cross-cutting items. Domain-specific
  facts stay in `_memory.md`. If it's not true across ≥2 domains or about the app/user globally,
  it does not belong in Omega.
- **Dedup + decay.** The managed block is rewritten whole each pass (no unbounded growth); stale
  items age out when no longer supported by evidence.
- **Never override Ideal State.** Omega is below it in precedence and in the header wording.
- **User owns it.** The hand-authored region is never touched by the distiller.

## v1 scope (this branch)
- A + B + C + D (file, injection in engine + desktop, read/write, distill command + Distill button,
  Omega UI page). 
- E (daemon automation) wired if time permits; otherwise documented as the immediate next step.

## Out of scope (later)
- "Remember everywhere" inline chat action, per-item provenance/evidence links, an Omega ↔ Ideal
  State "promote a learned pattern into a stated value" flow.
