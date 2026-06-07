#!/usr/bin/env bash
# Build the prevail engine as a standalone binary and place it where Tauri
# expects the `externalBin` sidecar. Runs as part of `beforeBuildCommand`
# so a `tauri build` always bundles a fresh, self-contained engine — the
# downloaded app never depends on a separately-installed `prevail` CLI.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"            # desktop repo root
# Engine repo location: $PREVAIL_CLI_DIR override (used by CI) else the sibling
# checkout used in local dev.
if [ -n "${PREVAIL_CLI_DIR:-}" ]; then
  CLI="$(cd "$PREVAIL_CLI_DIR" 2>/dev/null && pwd || true)"
else
  CLI="$(cd "$HERE/../fd-apps-prevail-cli" 2>/dev/null && pwd || true)"
fi

if [ -z "${CLI:-}" ] || [ ! -f "$CLI/package.json" ]; then
  echo "prepare-sidecar: cannot find the prevail-cli engine repo (set PREVAIL_CLI_DIR or check it out next to the desktop repo)" >&2
  exit 1
fi

TRIPLE="$(rustc -Vv | sed -n 's/host: //p')"
echo "prepare-sidecar: building prevail engine for $TRIPLE"
( cd "$CLI" && bun build --compile --outfile=dist/prevail src/index.tsx )

mkdir -p "$HERE/src-tauri/binaries"
cp "$CLI/dist/prevail" "$HERE/src-tauri/binaries/prevail-$TRIPLE"
echo "prepare-sidecar: sidecar ready -> src-tauri/binaries/prevail-$TRIPLE ($(du -h "$HERE/src-tauri/binaries/prevail-$TRIPLE" | cut -f1))"
