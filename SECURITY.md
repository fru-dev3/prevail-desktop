# Security Policy

## Reporting a vulnerability
Please **do not** open a public issue for security problems. Email
**security@fru.dev** (or DM the maintainer) with details and steps to reproduce.
We aim to acknowledge within 72 hours.

## Threat model & design notes
Prevail is local-first; your vault, chats, and the intent ledger never leave your
machine unless you enable an integration. Key considerations:

- **Vault data** lives on disk in your chosen folder. It is **not encrypted at
  rest** — treat the vault like any sensitive documents folder.
- **Secrets** (provider API keys, notarization creds) are stored in the macOS
  **Keychain** (`prevail.providers`), never in the vault or localStorage. Key
  values are never returned to the frontend (`provider_key_exists` is a presence
  check). The engine redacts API-key/PII patterns before text is persisted or
  sent (`privacy.ts`); enable **Settings → Safety → Redact secrets** for the
  desktop capture path too.
- **Subprocesses** (the engine, the AI CLIs) are spawned with argument arrays
  (no shell), with a scrubbed/enriched env.
- **WebUI (Remote)** is **off by default**. When enabled it binds `127.0.0.1`
  only (reach it remotely via Tailscale/SSH tunnel, never `0.0.0.0`), requires a
  username + password, issues a random per-session token, and **allowlists** the
  commands a browser may invoke (no secrets, no arbitrary file I/O, no
  destructive ops). Only enable it on trusted networks.
- **CSP** is enabled with a strict `script-src 'self'`.

## Supported versions
The latest released version receives security fixes.
