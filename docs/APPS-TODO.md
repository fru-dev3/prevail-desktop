# Apps Area — branch TODO (`feat/apps-area`)

Working branch for the Apps-area focus. Full research + rationale:
`docs/APPS-AREA-RESEARCH.md`. This file tracks what's DONE on the branch vs NEXT.
Becomes the release after v0.1.129 on review/merge.

## Headline finding
The "set it up once and it runs by itself" engine is **already largely built**:
6 runners (mcp/a2a/http/cli/browser/llm), a multi-strategy auth probe, an
autonomous sync daemon (cursors, backoff, file-locking, failure→tasks), and an
LLM-driven Connection Agent. The real gaps were catalog bloat, no per-app
starting hints, and secrets not unified on the keychain.

## DONE on this branch
- [x] **Catalog curated 1,468 → 195 essential** (tier-1 = default "Core" view;
  long tail re-tiered to 2, still reachable via search / "All"). Nothing deleted.
  `scripts/curate-catalog.mjs` (idempotent, re-runnable). Seeded **SimpleFIN
  Bridge** (local-first banking path). (catalog.json, settings3.tsx copy)
- [x] **connection_hint on 51 headline apps** — preferred method + known MCP
  server / SimpleFIN / CLI + privacy posture + read-only, sourced from research
  §2.3. Gives the Connection Agent a warm start instead of researching cold.
- [x] **Privacy posture surfaced** on catalog rows: `● local` / `○ cloud` badge
  with method/server/read-only on hover. (P0 "surface local vs vendor-cloud".)

## NEXT — P1 (founder's headline use case: banking, automated, scalable)
- [ ] **SimpleFIN Bridge connector** as a real seeded app (bundled manifest +
  sync skill): setup-token → claim Access URL → store in **OS keychain** →
  read-only `/accounts` sync → route balances/transactions as **service-level
  summaries (never account numbers)** into money/wealth/tax.
- [ ] **Unify secrets on the OS keychain** (close the §1.3 gap): route OAuth
  tokens + API keys + SimpleFIN URL through `ingestion/keychain.rs` instead of
  0600 files/env; keep 0600 as fallback.
- [ ] **Seed real connectors** with multi-strategy `connections[]` ladders:
  Google bundle (`google_workspace_mcp --read-only`), Microsoft bundle
  (`ms-365-mcp-server --read-only`), PayPal/Stripe/QuickBooks (official MCP),
  Schwab/Coinbase, health/wearables (Oura/Fitbit/Whoop/Strava).
- [ ] **Confirm the `--sync` launchd agent installs** alongside `--learn`/`--loops`
  so apps refresh when the desktop app is closed.
- [ ] **App-detail workspace**: tabbed Overview/Auth/Sync/Skills/Data/Chat with a
  **last-pulled data preview** (proof the connection produces real data), and a
  **re-auth-only** CTA on attention cards. Catalog on-ramp grid under connect input.

## NEXT — P2 (scale, polish, autonomy)
- [ ] Background method-upgrade suggester (suggests a better method, never auto-swaps).
- [ ] Connector-scoped chat ("chat with my <app> data").
- [ ] OFX/CSV + export-ZIP universal import fallback.
- [ ] Optional Composio path — opt-in, clearly labeled "routes through Composio cloud."
- [ ] First-run-approval option (surface a connection's first sync for approval).

## Guardrails (non-negotiable)
- **Never enumerate individual bank accounts** — service/aggregator level only;
  surface balances/transactions as domain summaries.
- **No cloud intermediary you must run** — SimpleFIN / direct API / local MCP over
  Plaid/SnapTrade/Composio cloud, unless the user explicitly opts in.
- **Credentials never enter the vault** (already enforced) → move to OS keychain.
