# Plan: Embedded (In-App) Vault

Status: **DESIGN + a safe first step.** You said the vault should be embedded in
the app, not "a vault staying somewhere else." This is partly a directive and
partly entangled with encryption (`SECURITY-LOCK-PLAN.md`) and the new sync
(#6), so I want your sign-off on the model before relocating where your data
physically lives. I have NOT moved your current vault.

## Current model (what "somewhere else" means today)

- The vault is an **external folder the user picks** (e.g.
  `~/Documents/Prevail Sample Vault`, or `~/Documents/prevail/vault-demo`).
- Its path is remembered in two places: browser/desktop `localStorage`
  (`prevail.desktop.vaultPath`) and a server-side pointer file
  `Application Support/sh.prevail.desktop/bootstrap-vault.txt`.
- Files are plaintext markdown/jsonl, openable by Finder, Obsidian, git, and
  your `~/.ai` ecosystem (OpenClaw, Paperclip).

### Why it's currently external (the benefits we'd be trading away)
- You can edit the vault in Obsidian / any editor.
- It plays with git, iCloud/Dropbox, and your shared `~/.ai` knowledge system.
- It's transparent — no lock-in, "just your files."

### Why you want it embedded
- One less thing to manage / lose / point at the wrong folder.
- It's the precondition for the encryption story: if the vault is app-managed
  AND encrypted, "just files anyone can read on the desktop" stops being true.
- Cleaner onboarding — no folder picker, the app just has a vault.

## Proposed model: app-owned canonical vault, with explicit export

- **Default location:** `Application Support/sh.prevail.desktop/vault/`
  (app-managed, not user-facing). New installs use this automatically — no
  folder picker, no "pick your vault" wizard step.
- The app is the **owner** of this directory. Treat the path as an internal
  detail, surfaced read-only in Settings -> Vault.
- **Import / Export** become first-class:
  - Import an existing external vault (one-time migration into the embedded
    location).
  - Export a decrypted snapshot to a folder/zip when the user wants their files
    out (no lock-in).
- **Power-user escape hatch:** keep "Use an external folder instead" in Settings
  for people who want Obsidian/git, but it's no longer the default.

This satisfies "embedded in the app" while not burning the bridge for users who
rely on plaintext-on-disk.

## Interaction with the work already done

- **Sync (#6):** I just made the WebUI inherit the desktop's vault via
  `bootstrap_vault`. An embedded vault makes this *simpler and more reliable* —
  the path is deterministic and app-owned, so there's no stale-folder drift.
  This plan builds directly on that.
- **Encryption (`SECURITY-LOCK-PLAN.md`):** embedding is what makes encryption
  coherent. Recommend shipping them as one milestone: embedded + opt-in
  encryption.
- **The `~/.ai` ecosystem:** this is the real tension. OpenClaw/Paperclip read
  the vault from a known path today. If we move the canonical vault into
  Application Support and/or encrypt it, those consumers break unless we either
  (a) keep a synced plaintext mirror at the old path, or (b) give them a read
  shim. **This needs a decision before we relocate anything.**

## Migration (must be non-destructive)

1. Detect the current external vault from `bootstrap-vault.txt` / localStorage.
2. Copy (not move) it into the embedded location; verify file count + checksums.
3. Repoint `bootstrap-vault.txt` and localStorage to the embedded path.
4. Leave the original in place, clearly marked, until the user confirms — then
   offer to archive/remove it. **Never delete user data** (per repo hard rules).

## Safe first step I can take now (low risk, reversible)

Make the **default vault for brand-new installs** the embedded location, while
leaving every existing vault exactly where it is:

- New install with no remembered vault -> create + use
  `Application Support/.../vault/` automatically instead of prompting for a
  folder.
- Existing users: untouched. Their `bootstrap-vault.txt` still points at their
  folder.
- Add Settings -> Vault -> "Move vault into the app" button that runs the
  non-destructive migration above on demand.

This ships the embedded model for new users and gives existing users an opt-in
migration, with zero risk to your current data. I did NOT do this yet because it
changes onboarding behavior and should land together with the
embedding/encryption decision below.

## Open questions for you

1. **The `~/.ai` ecosystem:** do OpenClaw/Paperclip need continued plaintext
   access to this vault? If yes, embedding + encryption requires a mirror or
   shim — that's the biggest design fork.
2. **Default for new installs:** embedded (recommended) or keep the folder
   picker?
3. **Bundle as one milestone with encryption,** or ship embedding first
   (plaintext, app-owned location) and add encryption after?

My recommendation: ship **embedded-by-default for new installs + opt-in
migration** first (plaintext, app-owned), keep the external-folder escape hatch,
then layer encryption on top as Phase 1 of the security plan — *after* we settle
how the `~/.ai` ecosystem keeps its access.
