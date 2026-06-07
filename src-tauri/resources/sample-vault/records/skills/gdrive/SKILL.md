---
name: gdrive
type: app
description: >
  Reads and writes document scans and records files to configured Google Drive folders via
  the Drive API. Used by records-agent for storing scanned document copies and retrieving
  them during audits. Configure OAuth credentials and folder IDs in vault/records/config.md.
---

# Google Drive

**Auth:** OAuth2 via Google Drive API credentials (`GDRIVE_CREDENTIALS` from `~/.ai/env/.env`)
**URL:** https://drive.google.com
**Configuration:** Set credentials file path and folder IDs in `~/Documents/aireadylife/vault/records/config.md`

## Data Available

- **File listing in configured folders:** File name, created date, modified date, MIME type, size
- **Upload new document scans:** PDF or image files uploaded to the appropriate subfolder by document type
- **Download existing document files:** Retrieve scanned copies for verification or printing
- **Organize into subfolders:** Create and manage the folder hierarchy (IDs, Legal, Financial, Insurance, Vehicles)
- **Search files by name:** Find a specific document scan without browsing the full folder tree
- **Share file or folder:** Generate a shareable link (for attorney sharing, emergency access, etc.) — do this only when explicitly requested

## Configuration

Add to `~/Documents/aireadylife/vault/records/config.md`:
```
gdrive_credentials: ~/Documents/aireadylife/vault/records/00_current/gdrive-oauth.json
gdrive_records_folder_id: YOUR_RECORDS_FOLDER_ID
gdrive_ids_subfolder_id: YOUR_IDS_SUBFOLDER_ID
gdrive_legal_subfolder_id: YOUR_LEGAL_SUBFOLDER_ID
gdrive_scans_folder_id: YOUR_SCANS_FOLDER_ID
```

Add to `~/.ai/env/.env`:
```
GDRIVE_CREDENTIALS_PATH=~/Documents/aireadylife/vault/records/00_current/gdrive-oauth.json
```

## Recommended Google Drive Folder Structure

```
My Drive/
└── aireadylife-Records/
    ├── IDs/
    │   ├── Passports/
    │   ├── Driver-Licenses/
    │   └── Global-Entry/
    ├── Legal/
    │   ├── Wills/
    │   ├── POA/
    │   └── Healthcare-Directives/
    ├── Financial/
    │   └── Tax-Returns/
    ├── Insurance/
    └── Vehicles/
```

## Key API Operations

```
# List files in a folder
GET https://www.googleapis.com/drive/v3/files
  ?q='{folderId}'+in+parents+and+trashed=false
  &fields=files(id,name,createdTime,mimeType)

# Upload a file
POST https://www.googleapis.com/upload/drive/v3/files
  ?uploadType=multipart
  (with file content and metadata)

# Search by name
GET https://www.googleapis.com/drive/v3/files
  ?q=name+contains+'passport'+and+'{folderId}'+in+parents
```

**Required scopes:** `https://www.googleapis.com/auth/drive.file` (read/write to files created by the app) or `https://www.googleapis.com/auth/drive` (full Drive access — use drive.file scope unless broader access is needed)

## Notes

- Google Drive is used as the cloud/remote backup for document scans — 1Password holds the metadata and the secure note; Drive holds the actual scanned file
- This separation means 1Password can be audited without downloading files, and Drive can be searched for specific scans without the metadata
- Keep document scan files named consistently: `{holder-initials}-{document-type}-{expiry-date}.pdf` (e.g., `AS-passport-2028-06.pdf`) for easy retrieval
- GDPR/CCPA: if documents contain data of EU or California residents, ensure the Drive folder privacy settings are appropriate (not publicly shared)

## Used By

- `aireadylife-records-log-document` — upload a scanned document to the appropriate Drive subfolder after adding the document record to the vault
- `aireadylife-records-document-audit` — verify that a scan exists in Drive for each document in the vault; flag documents with no digital scan on file

## Vault Output

`~/Documents/aireadylife/vault/records/00_current/` (audit results noting scan file IDs and Drive links)
