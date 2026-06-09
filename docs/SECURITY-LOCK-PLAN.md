# Plan: App Login + Vault Encryption

Status: **DESIGN ONLY — not implemented.** Per your instruction, this is the
think-through before we build anything. Read it, tell me which option to ship,
and I'll implement the chosen phase.

## What you asked for

1. An optional username + password "profile" set from Settings (a Security
   page). If a user creates it, they must log in with that profile before they
   can see the app or its data.
2. That same login should encrypt the vault data at rest, so the markdown files
   on disk can't just be opened and read by anyone with the Mac.

You already spotted the hard part yourself: *the vault is just markdown files on
disk, so a login screen alone protects nothing — someone can bypass the app and
read the files directly.* That's exactly right, and it's why login and
encryption have to be designed together. A password that doesn't encrypt is
theater.

## Threat model (be honest about what this defends against)

| Threat | Login only | Login + encryption at rest |
| --- | --- | --- |
| Someone opens the app on your unlocked Mac | Blocks | Blocks |
| Someone copies the vault folder to a USB stick | **No protection** | Protected (ciphertext) |
| Someone with a backup / cloud sync of the vault | **No protection** | Protected |
| Lost/stolen Mac, FileVault off | **No protection** | Protected |
| Lost/stolen Mac, FileVault on | (OS already protects at rest) | Defense in depth |
| Malware running as your user while app is unlocked | No protection | No protection (key is in memory) |

Takeaway: **login without encryption only helps against a casual person poking
at an already-unlocked, logged-in Mac.** The real value is encryption at rest.
macOS FileVault already covers the stolen-laptop case for the whole disk — so
the marginal value here is: protecting the vault inside an unlocked machine,
inside backups, and inside any future cloud sync.

## Design decisions

### 1. Key derivation
- User password -> **Argon2id** (memory-hard) -> 256-bit master key.
  - Rust crate: `argon2`. Parameters tuned to ~250ms on target hardware.
  - Store only: salt, Argon2 params, and a verifier (encrypt a known constant so
    we can check the password without storing it). Never store the password or
    the raw key.
- Master key encrypts a random **per-vault data key** (envelope encryption).
  This lets the user change their password without re-encrypting every file —
  we only re-wrap the data key.

### 2. What gets encrypted
- All vault content files: `*.md`, `*.jsonl`, `_log/`, `_journal/`, `_meta/`,
  threads, artifacts.
- File **names/paths stay clear** (or are hashed — see open questions). Encrypt
  contents, not the directory tree, in phase 1. Full filename encryption is a
  phase-2 nicety.
- Encryption: **AES-256-GCM** per file (or XChaCha20-Poly1305 via `ring` /
  `aes-gcm` crate), random nonce per write, authenticated.

### 3. Where the key lives at runtime
- Derived on login, held **in memory only** for the session.
- Optionally cached in the **macOS Keychain** (Secure Enclave-backed) so Touch
  ID can unlock without retyping — opt-in, off by default. This is the nice UX
  path and reuses the keychain module already in the codebase
  (`ingestion/keychain.rs`).
- On lock / quit / idle-timeout, zeroize the key from memory.

### 4. The "files are readable on disk" problem
This is the crux you raised. Options:

- **Option A — Encrypt-in-place (recommended).** Files on disk are ciphertext
  (`.md.enc` or a content envelope). The app decrypts on read, encrypts on
  write. Editing in Obsidian/Finder no longer works (the files are opaque),
  which is the point. We provide an explicit **Export (decrypt)** action for
  when the user wants plaintext.
- **Option B — Encrypted container.** Keep plaintext markdown but inside an
  encrypted volume/sparsebundle or a single encrypted archive that's mounted
  only while the app is unlocked. More macOS-specific, more moving parts.
- **Option C — Encrypt only at rest on lock.** Plaintext while unlocked,
  encrypted when locked. Worst of both: there's always a window of plaintext on
  disk. **Not recommended.**

Option A is the honest answer to your concern and pairs naturally with the
embedded-vault plan (`VAULT-EMBED-PLAN.md`): once the vault lives inside
app-managed storage AND is encrypted, "just files on the desktop someone can
read" stops being true.

## What this breaks (and must be handled)

- **External editing (Obsidian, Finder, git):** gone for encrypted vaults. This
  is a real tradeoff — the markdown-on-disk openness is currently a feature.
  Make encryption **opt-in per vault**, not forced.
- **The CLI / Telegram bridge / Paperclip / OpenClaw** (your shared `~/.ai`
  ecosystem) read these files directly. Encryption breaks every external
  consumer unless they also get the key. Phase 1 should scope encryption to the
  *desktop-app-managed* vault only, and keep the shared `~/.ai` flows on
  plaintext, or give them a decrypt shim.
- **Search/indexing** must run on decrypted content in memory.
- **Sync (#6) and WebUI:** the data key must be available wherever decryption
  happens. Since the WebUI proxies invokes to the desktop (which holds the key),
  the remote browser keeps working without ever seeing the key. Good — the
  architecture already fits.
- **Backups:** encrypted backups are safe to store anywhere, but a lost password
  = unrecoverable data. Need a recovery code / key-escrow choice at setup.

## Recommended phased rollout

- **Phase 0 (cheap, ship first): App lock only, no encryption.**
  - Settings -> Security -> "Require a passcode to open Prevail."
  - Argon2 verifier stored; gate the UI (desktop + WebUI login already exists).
  - Clearly labeled: "This locks the app window. It does NOT encrypt your files
    yet — turn on FileVault for at-rest protection." Honesty prevents false
    confidence.
- **Phase 1: Opt-in vault encryption (Option A).**
  - Envelope encryption, AES-GCM per file, Argon2id KDF, in-memory key.
  - Migration: encrypt an existing plaintext vault in place with a progress UI +
    a verified backup first. Recovery code generated at setup.
  - Touch ID unlock via Keychain (opt-in).
- **Phase 2: Polish.**
  - Filename/path encryption, idle auto-lock, per-domain encryption,
    plaintext export, decrypt shim for the `~/.ai` ecosystem.

## Open questions for you

1. **Scope:** encrypt only the desktop-app vault, or also the shared `~/.ai`
   vault that OpenClaw/Paperclip read? (The latter is a much bigger blast
   radius.)
2. **Recovery:** if the user forgets the password, are they OK losing the data,
   or do we want a recovery code / escrow?
3. **Touch ID:** want the Keychain/Touch ID convenience path in phase 1, or
   keep it password-only first?
4. **Default:** off for everyone (opt-in), or on-by-default for new vaults?

My recommendation: ship **Phase 0** now (low risk, real UX value, sets up the
Security page), then do **Phase 1 opt-in, desktop-vault-only, with a recovery
code and Touch ID**. Don't touch the shared `~/.ai` plaintext flows until we've
given OpenClaw/Paperclip a decrypt path.
