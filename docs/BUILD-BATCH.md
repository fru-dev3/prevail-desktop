# Build Batch — coordinated plan across four design docs

The four planned features are interdependent (they all touch where the vault
lives and what "mode" the app is in). This is the order I'd build them in when
you say go, and why. Each links to its full design doc.

| # | Feature | Doc | Risk |
| --- | --- | --- | --- |
| A | Demo -> Production mode + role packages | `DEMO-MODE-PLAN.md` | Med |
| B | Embedded (app-owned) vault | `VAULT-EMBED-PLAN.md` | Med |
| C | Usage & cost analytics | `USAGE-ANALYTICS-PLAN.md` | Low |
| D | App login + vault encryption | `SECURITY-LOCK-PLAN.md` | High |

## The dependency that orders everything

All of A, B, and D answer the same question: **where does the vault live and who
can read it?** So they must be built in one coherent pass, not separately:

- Demo mode (A) needs an **app-owned location** for the throwaway demo vault →
  that's the embed work (B).
- "Switch to production" (A) IS the "choose where the vault lives" decision (B).
- Encryption (D) only makes sense once the vault is app-owned (B) and only
  applies to production vaults (A), never the demo.

**The one thing to confirm before B/D:** do you actively use the standalone
`prevail-cli`/`prevail-tui` against the same vault as the desktop? They open it
by a known path, so embedding (B) and encryption (D) affect them. If the desktop
is your primary surface this is a non-issue — the desktop and its bundled engine
sidecar always know the location/key. (This replaces the earlier `~/.ai` note,
which was a mistaken cross-reference to the unrelated fru-monorepo knowledge
base — it has nothing to do with the Prevail vault.)

## Recommended sequence

1. **C — Usage analytics first.** Lowest risk, fully additive, no dependency on
   the vault-location question. Extends the existing `usage_append`/
   `usage_summary` foundation: add `by_day` + a domain-scoped summary + a domain
   "Usage" tab + a promoted global Stats view. Good standalone win while we
   settle the vault decision.

2. **B — Embedded vault.** Establish the app-owned vault location +
   non-destructive migration + external-folder escape hatch. Everything below
   builds on this.

3. **A — Demo/Production mode + packages.** Auto-demo on first launch (in the
   app-owned demo location from B), demo badge, switch-to-production flow, then
   the `prevail.pack/v1` role packages.

4. **D — Login + encryption.** Phase-0 app lock first, then opt-in
   Argon2id/AES-256-GCM on production vaults, with recovery code + Touch ID. The
   desktop hands its in-memory key to the bundled engine sidecar so chat/council
   keep working on an encrypted vault.

## What I need from you to start
- Whether the standalone CLI/TUI needs to read the encrypted/embedded vault, or
  the desktop is your primary surface (decides how far the key/path plumbing
  goes).
- Confirm the role-package persona list (6-7) and where to host them (GitHub
  Releases recommended).
- Answers to the per-doc "Open questions" sections (or a "use your
  recommendations" and I'll proceed with the defaults I flagged).

Say the word and I'll start at C and work down.
