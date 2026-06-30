---
id: sync-vault-cli
runner: cli
trigger: on-demand
capability: sync-vault
command: op
args:
  - "item"
  - "list"
  - "--format=json"
save: 1password-items-${date}.json
---
# Sync vault inventory (op CLI fallback)

Headless fallback for the sync-vault capability via the 1Password CLI (op). Its
access method is "other" (a local CLI), so it ranks after browser in the pack.
Requires `op` installed and signed in (`op signin`). Lists item METADATA as
JSON; it does not print secret values. Read-only.
