# Release — Prevail desktop

Releases are cut automatically by GitHub Actions. Pushing a tag that matches
`v*` triggers `.github/workflows/release.yml`, which builds, Developer ID-signs,
and notarizes the macOS app (universal: Apple Silicon + Intel), then creates a
GitHub release with the DMG attached.

## Cut a release

```bash
VERSION=$(node -p "require('./package.json').version")
git tag "v$VERSION"
git push origin "v$VERSION"
```

Watch the run under the repo's **Actions** tab. On success the release appears
under **Releases** with the signed, notarized DMG.

## Required repository secrets

Add these under **Settings → Secrets and variables → Actions → New repository
secret**:

| Secret | What it is | Where to get it |
| --- | --- | --- |
| `APPLE_CERTIFICATE` | Base64 of the exported Developer ID Application `.p12` | Export from Keychain, then `base64 -i cert.p12 \| pbcopy` |
| `APPLE_CERTIFICATE_PASSWORD` | Password protecting that `.p12` | Set during the Keychain export |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Fru Nde (TXN399AHT5)` | Exact name of the cert |
| `APPLE_ID` | Apple ID email used for notarization | Apple developer account |
| `APPLE_PASSWORD` | App-specific password for notarization | 1Password (see below) |
| `APPLE_TEAM_ID` | `TXN399AHT5` | Apple Developer → Membership |
| `KEYCHAIN_PASSWORD` | Any strong string for the temporary CI keychain | Generate yourself |

## App-specific password

The notarization app-specific password (`APPLE_PASSWORD`) lives in 1Password,
item **"Prevail - Apple Notarization"**. Copy it from there into the
`APPLE_PASSWORD` repo secret. Do not commit it anywhere.

To generate a new one: <https://appleid.apple.com> → Sign-In and Security →
App-Specific Passwords. Then update both the 1Password item and the repo secret.

## Exporting the certificate

1. In **Keychain Access**, find **Developer ID Application: Fru Nde (TXN399AHT5)**.
2. Right-click → **Export** → save as `.p12` with a password.
3. Encode for the secret: `base64 -i cert.p12 | pbcopy` and paste into
   `APPLE_CERTIFICATE`; put the export password in `APPLE_CERTIFICATE_PASSWORD`.
