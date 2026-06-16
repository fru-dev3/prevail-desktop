#!/usr/bin/env bash
# Deploy gate — fail the build if any real/personal data leaked into the SHIPPED
# demo vault. The demo vault must be 100% synthetic (the "Alex Rivera" persona);
# the founder's real identity (email, name, home path) must NEVER reach users.
#
# Runs in CI before sign/notarize so a leak blocks the release. Run locally with:
#   bash scripts/scrub-gate.sh
#
# Why this exists: a benchmark reply once captured the founder's real connected
# calendar (redacted@example.com) and got committed into the shipped sample-vault.
# This gate makes that class of leak impossible to ship silently again.
set -euo pipefail

TARGET="${1:-src-tauri/resources/sample-vault}"

if [ ! -d "$TARGET" ]; then
  echo "scrub-gate: target '$TARGET' not found — skipping."
  exit 0
fi

# Real-identity fingerprints that must never appear in the synthetic demo vault.
# (Scoped to the SHIPPED vault only — release tooling/docs legitimately carry the
# Apple Developer ID, so we do not scan those here.)
PATTERNS=(
  'fru\.dev3'       # real email local-part
  'Fru Nde'         # real legal name (also the Developer ID — never in vault data)
  'Fru Louis'       # legacy real-name variant
  '/Users/[a-z]'    # any real home-dir path (frunde or otherwise) — runtime leak
)

# Synthetic personas + placeholders that ARE allowed in the demo vault.
ALLOW='your_email|example\.com|alex\.rivera|jordan|maria@austincpa|you@|user@|name@'

fail=0

for p in "${PATTERNS[@]}"; do
  hits=$(grep -rinE "$p" "$TARGET" 2>/dev/null || true)
  if [ -n "$hits" ]; then
    echo "❌ scrub-gate: matched forbidden pattern /$p/ in $TARGET:"
    echo "$hits" | head -8 | sed 's/^/   /'
    fail=1
  fi
done

# Any consumer email address that isn't an allowlisted synthetic one.
leaked=$(grep -rhoiE '[a-z0-9._%+-]+@(gmail|icloud|yahoo|outlook|hotmail|me|proton)\.(com|me)' "$TARGET" 2>/dev/null | grep -viE "$ALLOW" | sort -u || true)
if [ -n "$leaked" ]; then
  echo "❌ scrub-gate: non-synthetic email address(es) in $TARGET:"
  echo "$leaked" | sed 's/^/   /'
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  echo ""
  echo "Deploy blocked: scrub real/personal data from the demo vault before releasing."
  echo "Replace it with the synthetic Alex Rivera persona, then re-run."
  exit 1
fi

echo "✓ scrub-gate: $TARGET is clean of personal data ($(find "$TARGET" -type f | wc -l | tr -d ' ') files scanned)."
