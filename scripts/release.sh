#!/usr/bin/env bash
# One-command release for the Prevail desktop app.
#
#   build (self-contained, signed) -> notarize+staple app & dmg ->
#   TEST the dmg through Gatekeeper -> publish to the website (direct
#   download, versioned save-name) -> publish/refresh the GitHub release.
#
# Apple creds come from 1Password at runtime (nothing secret is stored here).
# The version is read from tauri.conf.json and stamped into the site so the
# download URL stays stable while the saved filename carries the version.
#
# Usage:  bash scripts/release.sh            # full release
#         SKIP_BUILD=1 bash scripts/release.sh   # reuse the last build
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"               # desktop repo root
SITE="$(cd "$HERE/../fd-apps-prevail-site" 2>/dev/null && pwd || true)"
OP_ITEM="o4smftszeclcwy54c6tofu4kny"                    # "Prevail - Apple Notarization"
REPO="fru-dev3/prevail-desktop"
ARCH="aarch64"

step() { printf '\n\033[1;33m== %s ==\033[0m\n' "$1"; }
die()  { printf '\033[1;31mrelease: %s\033[0m\n' "$1" >&2; exit 1; }

[ -n "${SITE:-}" ] || die "cannot find fd-apps-prevail-site next to the desktop repo"
command -v op >/dev/null || die "1Password CLI (op) not found"
command -v gh >/dev/null || die "GitHub CLI (gh) not found"

VERSION="$(python3 -c "import json;print(json.load(open('$HERE/src-tauri/tauri.conf.json'))['version'])")"
[ -n "$VERSION" ] || die "could not read version from tauri.conf.json"
TAG="v$VERSION"
DMG="$HERE/src-tauri/target/release/bundle/dmg/Prevail_${VERSION}_${ARCH}.dmg"
step "Releasing Prevail $VERSION ($TAG)"

step "Apple credentials (1Password)"
export APPLE_SIGNING_IDENTITY="$(op item get "$OP_ITEM" --fields label=signing-identity --reveal)"
export APPLE_ID="$(op item get "$OP_ITEM" --fields label=apple-id --reveal)"
export APPLE_PASSWORD="$(op item get "$OP_ITEM" --fields label=app-specific-password --reveal)"
export APPLE_TEAM_ID="$(op item get "$OP_ITEM" --fields label=team-id --reveal)"
[ -n "$APPLE_SIGNING_IDENTITY" ] && [ -n "$APPLE_PASSWORD" ] || die "missing Apple creds in 1Password"
echo "signing as: $APPLE_SIGNING_IDENTITY"

# Updater signing key (for the in-app auto-updater feed). The build produces
# Prevail.app.tar.gz + .sig when createUpdaterArtifacts is on; these env vars
# let `tauri build` sign them. Key lives at ~/.prevail/updater.key.
UPDATER_KEY="$HOME/.prevail/updater.key"
if [ -f "$UPDATER_KEY" ]; then
  export TAURI_SIGNING_PRIVATE_KEY="$(cat "$UPDATER_KEY")"
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
  echo "updater artifacts will be signed"
else
  echo "WARN: $UPDATER_KEY missing — auto-update artifacts will be unsigned/skipped"
fi

if [ "${SKIP_BUILD:-0}" != "1" ]; then
  step "Build (sign + notarize + staple app; bundles self-contained engine sidecar)"
  ( cd "$HERE" && npm run tauri build -- --bundles app dmg )
else
  step "Skipping build (SKIP_BUILD=1)"
fi
[ -f "$DMG" ] || die "DMG not found at $DMG"

step "Notarize + staple the DMG"
xcrun notarytool submit "$DMG" --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID" --wait
xcrun stapler staple "$DMG"
xcrun stapler validate "$DMG"

step "GATE: Gatekeeper test on a quarantined copy (must be Notarized Developer ID)"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
cp "$DMG" "$WORK/dl.dmg"
xattr -w com.apple.quarantine "0181;00000000;release-test;$(uuidgen)" "$WORK/dl.dmg"
MNT="$(hdiutil attach "$WORK/dl.dmg" -nobrowse -readonly | grep -o '/Volumes/.*' | head -1)"
ASSESS="$(spctl -a -vvv "$MNT/Prevail.app" 2>&1 || true)"
ENGINE="$("$MNT/Prevail.app/Contents/MacOS/prevail" --version 2>&1 | head -1 || true)"
hdiutil detach "$MNT" >/dev/null 2>&1 || true
echo "$ASSESS"
echo "bundled engine: $ENGINE"
echo "$ASSESS" | grep -q "source=Notarized Developer ID" || die "Gatekeeper REJECTED the build — NOT publishing"
echo "$ENGINE" | grep -qi "prevail" || die "bundled engine did not run — NOT publishing"
echo "Gatekeeper + self-contained engine: PASS"

step "Publish to website (stable URL, versioned save-name)"
cp "$DMG" "$SITE/public/Prevail-mac-arm64.dmg"
cat > "$SITE/src/version.ts" <<TS
// Current downloadable desktop version. Stamped automatically by the
// desktop repo's scripts/release.sh from src-tauri/tauri.conf.json — do
// not edit by hand. The download URL stays stable (/Prevail-mac-arm64.dmg);
// this only sets the versioned filename the browser saves the file as.
export const APP_VERSION = "$VERSION";
TS
( cd "$SITE" && npm run build >/dev/null )   # sanity-build before pushing
( cd "$SITE" && git add public/Prevail-mac-arm64.dmg src/version.ts \
  && git commit -q -m "release: Prevail $VERSION (signed, notarized, self-contained)" \
  && git push )
echo "site pushed — Netlify will deploy prevail.sh"

step "Build the auto-update feed (latest.json)"
MACOS_DIR="$HERE/src-tauri/target/release/bundle/macos"
TARBALL="$MACOS_DIR/Prevail.app.tar.gz"
SIGFILE="$TARBALL.sig"
UPDATE_ASSETS=()
if [ -f "$TARBALL" ] && [ -f "$SIGFILE" ]; then
  SIG="$(cat "$SIGFILE")"
  PUB_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  LATEST_JSON="$WORK/latest.json"
  python3 - "$VERSION" "$SIG" "$PUB_DATE" "$REPO" "$TAG" > "$LATEST_JSON" <<'PY'
import json, sys
version, sig, pub_date, repo, tag = sys.argv[1:6]
url = f"https://github.com/{repo}/releases/download/{tag}/Prevail.app.tar.gz"
print(json.dumps({
    "version": version,
    "notes": f"Prevail {version}",
    "pub_date": pub_date,
    "platforms": {"darwin-aarch64": {"signature": sig, "url": url}},
}, indent=2))
PY
  UPDATE_ASSETS=("$TARBALL" "$SIGFILE" "$LATEST_JSON")
  echo "latest.json built for darwin-aarch64"
else
  echo "WARN: updater artifacts not found ($TARBALL) — auto-update feed skipped this release"
fi

step "Publish GitHub release $TAG"
if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  gh release upload "$TAG" "$DMG" ${UPDATE_ASSETS[@]+"${UPDATE_ASSETS[@]}"} --repo "$REPO" --clobber
else
  gh release create "$TAG" --repo "$REPO" --target main --title "$TAG" --generate-notes "$DMG" ${UPDATE_ASSETS[@]+"${UPDATE_ASSETS[@]}"}
fi

step "Done — Prevail $VERSION released"
echo "  website:  https://prevail.sh/Prevail-mac-arm64.dmg  (saves as Prevail-$VERSION-arm64.dmg)"
echo "  release:  https://github.com/$REPO/releases/tag/$TAG"
