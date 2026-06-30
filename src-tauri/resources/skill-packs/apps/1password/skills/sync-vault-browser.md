---
id: sync-vault-browser
runner: browser-agent
trigger: refresh
favorite: true
method: browser
capability: sync-vault
session: profile
start_url: https://my.1password.com/
domain_allow: [my.1password.com, 1password.com]
success_url_contains: 1password.com
goal: Open 1Password in the logged-in session and read the INVENTORY of items (title, vault, category, last modified) and which logins are weak, reused, or have an available 2FA upgrade. Read-only: never reveal, copy, or change a secret value; capture metadata only.
outputs:
  - { path: data/1password-items-${date}.json, kind: replace }
---
# Sync vault inventory (browser, favorite)

Read item METADATA (never secret values) from the 1Password web vault using the
logged-in browser session. Favorite for users who have not installed the op CLI.
Falls through to the op CLI method when the browser is blocked.

Read-only and metadata-only. Capture title, vault, category, last modified, and
Watchtower flags (weak, reused, 2FA available). Never reveal, copy, export, or
change a secret value.
