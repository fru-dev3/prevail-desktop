---
name: gdrive
type: app
description: >
  Reads and writes files in configured Google Drive folders via the Drive API.
  Used by vision-agent to archive monthly scorecards, quarterly OKR documents, and annual
  reviews to a shared or backed-up Drive folder. Configure OAuth credentials and folder IDs
  in vault/vision/config.md. Optional — all vision data lives locally in vault/vision/ first;
  Drive is a backup and sharing layer.
---

# Google Drive — Vision Plugin

**Auth:** OAuth2 via Google Drive API (`GDRIVE_CREDENTIALS`)
**URL:** https://drive.google.com
**Configuration:** Set credentials and folder IDs in `vault/vision/config.md`

## Data Available

- List files in configured vision/planning/scorecard Drive folders
- Read prior year annual review documents (PDF, Google Doc, markdown)
- Read prior quarterly planning documents for retrospective context
- Write monthly scorecard files to scorecards Drive folder
- Write quarterly OKR documents to goals Drive folder
- Write annual review to annual reviews Drive folder
- Create new Google Docs from markdown content

## Configuration

Add to `vault/vision/config.md`:
```
gdrive_credentials: vault/vision/keys/gdrive-oauth.json
gdrive_scorecards_folder_id: YOUR_SCORECARDS_FOLDER_ID
gdrive_goals_folder_id: YOUR_GOALS_FOLDER_ID
gdrive_annual_reviews_folder_id: YOUR_ANNUAL_REVIEWS_FOLDER_ID
```

To get folder IDs: open the folder in Google Drive → the ID is in the URL after `/folders/`.

## Key API

```
GET  https://www.googleapis.com/drive/v3/files?q='{folderId}'+in+parents&fields=files(id,name,modifiedTime)
POST https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart
PATCH https://www.googleapis.com/drive/v3/files/{fileId}
Scopes: https://www.googleapis.com/auth/drive.file
```

## Used By

- `aireadylife-vision-op-monthly-scorecard` — archive completed monthly scorecard to Drive scorecards folder
- `aireadylife-vision-op-annual-review` — read prior year documents and write new annual review to Drive
- `aireadylife-vision-op-quarterly-planning` — archive finalized quarterly OKR document to Drive goals folder

## Vault Output

- `vault/vision/00_current/` — local copy always written first; Drive is secondary archive
- `vault/vision/01_prior/` — local annual review; mirrored to Drive annual reviews folder
