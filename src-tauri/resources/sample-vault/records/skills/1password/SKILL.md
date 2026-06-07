---
name: 1password
type: app
description: >
  Accesses the 1Password vault via the local CLI (`op`) using a service account token.
  Used by records-agent to audit document metadata stored in secure notes, check expiry
  dates on ID items, and log newly obtained documents. Read-only access is preferred;
  configure service account token in vault/records/config.md.
---

# 1Password

**Auth:** Local CLI (`op`) with service account token stored in `~/.ai/env/.env`
**URL:** https://1password.com
**Configuration:** Set service account token and vault name in `~/Documents/aireadylife/vault/records/config.md`

## Data Available

- **Vault item list:** All items in the configured vault with title, category (login, secure note, document, identity), creation date, and last-updated date
- **Secure note content:** Field values from structured secure notes — expiry dates, document holder names, storage locations
- **Login item names:** Audit only — can list login titles without reading passwords (never read or log passwords)
- **Document attachments:** Metadata for documents stored in 1Password (filename, upload date) — can confirm a scan exists without reading the file
- **Tag-based filtering:** Filter items by tag to retrieve all "documents" or "IDs" tagged items
- **Item field values:** Read specific field values from secure notes (e.g., `expiry_date`, `document_number`, `storage_location`) for structured document records

## Configuration

Add to `~/Documents/aireadylife/vault/records/config.md`:
```
op_service_account_token: ops_YOUR_SERVICE_ACCOUNT_TOKEN   # stored in ~/.ai/env/.env
op_vault_name: Personal
```

Add to `~/.ai/env/.env`:
```
OP_SERVICE_ACCOUNT_TOKEN=ops_YOUR_SERVICE_ACCOUNT_TOKEN
```

## Key CLI Commands

```bash
# List all items in vault
op item list --vault "Personal" --format json

# Get a specific item's fields
op item get "Passport - Alex" --fields label=expiry_date,label=holder

# List items by tag
op item list --vault "Personal" --tags "documents,ids" --format json

# List document attachments
op document list --vault "Personal" --format json

# Get field value from a secure note
op item get "Document: US Passport" --fields label=expiry_date --format json
```

## Security Guidelines

- The service account token must be read-only — configure it with read access only at 1password.com/teams → Service Accounts
- Never log, print, or store the token in any vault file — keep it exclusively in `~/.ai/env/.env`
- Never read or log passwords from login items — the records agent uses 1Password for document metadata only
- Token expiry: service account tokens can be set to expire; check the expiry date and rotate before it lapses

## Notes

- Service account setup: 1password.com/teams → Integrations → Service Accounts → Create Service Account → assign Read Access to the Personal vault
- The `op` CLI must be installed: `brew install 1password-cli`
- Authenticate: `export OP_SERVICE_ACCOUNT_TOKEN=ops_...` then commands work without interactive sign-in
- 1Password's document feature allows storing scanned PDFs directly — these appear in `op document list` results

## Used By

- `aireadylife-records-document-audit` — list all document items in the vault and check expiry fields against today; flag those nearing expiration
- `aireadylife-records-log-document` — create or update a secure note with document metadata (expiry, storage location, holder) when a new document is obtained

## Vault Output

`~/Documents/aireadylife/vault/records/00_current/` (audit results cross-referenced back to vault records)
