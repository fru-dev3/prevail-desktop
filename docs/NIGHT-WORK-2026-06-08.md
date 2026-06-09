# Overnight work log — 2026-06-08

Everything you flagged while testing v0.5.0, worked through in one session.
Shipped items are committed + pushed to `main`. Two items were design-only by
your request.

## Shipped (committed + pushed)

1. **Security: scrubbed the bundled vault.** Removed
   `src-tauri/resources/sample-vault/benchmark/` — its run files leaked your
   absolute paths (`/Users/frunde/...`) and personal-scenario prompts into the
   shipped DMG. The Benchmark tab still works; new installs just start with no
   sample runs.
   - **On the Telegram "gateway" concern:** the bot token is NOT bundled — it
     lives in the macOS Keychain (`prevail.providers/telegram`), and the chat_id
     lives in this machine's localStorage. Neither ships in the DMG. What you
     saw pre-filled was your own machine's local data persisting between the dev
     and release builds, not something baked into the distributed app. A fresh
     install on another Mac starts empty. **You do not need to rotate the token
     on account of the build** (rotate only if it leaked some other way). I
     double-checked git history too — no token/chat_id was ever committed.

2. **Bunker Mode locks Web access.** In the Modes popover, Web access now shows
   off + "locked" with an explanation whenever Bunker Mode is on. (The send path
   already forced it off; this fixes the misleading UI that let it look on.)

3. **"About me" -> "Pro Profile"** in Settings. "About" is unchanged.

4. **Homepage hook is one line:** "Your private AI that learns you and gets
   sharper every time you use it." Alternatives if you want to swap:
   - "An AI that learns your life and gets sharper every session."
   - "The more you use it, the more it becomes yours."

5. **Council drag-and-drop fixed.** You couldn't drop a domain onto the Council
   composer because the textarea had no drop handler and the native text-drop ate
   it. Now it attaches as context just like Chat (Shift = full context bundle).

6. **Cross-platform sync (theme + domains).**
   - Theme/palette now persist on the desktop and the WebUI inherits them
     (round-trips both ways).
   - The web view now always inherits the desktop's authoritative vault (and
     refreshes on focus), so the domains you set up on the desktop show up in the
     browser instead of an empty setup.

## Design-only (your call before I build)

7. **App login + vault encryption** -> `docs/SECURITY-LOCK-PLAN.md`.
   Recommendation: ship a Phase-0 app lock now, then opt-in AES-256-GCM +
   Argon2id encryption (desktop vault only) with a recovery code + Touch ID.

8. **Embedded (in-app) vault** -> `docs/VAULT-EMBED-PLAN.md`.
   Recommendation: embedded-by-default for new installs + opt-in non-destructive
   migration, keep an external-folder escape hatch, then layer encryption.

## The one decision that gates 7 and 8

Your `~/.ai` ecosystem (OpenClaw / Paperclip) reads the vault as plaintext from
a known path. Embedding the vault inside the app and/or encrypting it breaks that
unless we keep a plaintext mirror or give those tools a decrypt shim. Tell me how
you want those to keep their access and I'll finalize the build plan.

## To actually ship items 1-6 to users

These are source changes on `main`. They reach users on the next signed +
notarized DMG release (the changes don't auto-deploy to an installed app). When
you're ready, run the existing release flow (`DEPLOY.md`).
