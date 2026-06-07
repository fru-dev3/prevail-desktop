---
name: aireadylife-wealth-op-net-worth-review
type: op
cadence: monthly
description: >
  Monthly net worth snapshot. Aggregates all asset balances (checking, savings, HYSA,
  brokerage, 401k, Roth IRA, Traditional IRA, HSA, real estate equity) and subtracts
  all liabilities (mortgage, auto, student loans, credit cards) to produce net worth
  with month-over-month delta per line item. Annotates any account that moved more
  than $5,000 in either direction. Triggers: "net worth review", "monthly wealth
  check", "how is my net worth trending", "net worth snapshot".
---

# aireadylife-wealth-net-worth-review

**Cadence:** Monthly (1st of month)
**Produces:** Net worth snapshot at `vault/wealth/02_briefs/YYYY-MM-net-worth.md`; updated account totals in `vault/wealth/00_current/`

## What It Does

The net worth review is the single most important monthly wealth operation: it produces the authoritative net worth number and tells the story behind it. It runs on the first of each month, after statements and balance records have been updated in the vault.

The op calls `aireadylife-wealth-build-net-worth-summary` to aggregate all asset categories (liquid, tax-advantaged retirement, tax-advantaged other, taxable investments, real estate equity) and subtract all outstanding liabilities. The result is a structured table where every account appears as a line item with its current balance, prior month balance, and MoM delta. Any account where the delta exceeds $5,000 in either direction — the threshold for "meaningfully large movement" — is automatically annotated. The annotation uses context from the account notes field: expected movements (paycheck, employer match, known large payment) are labeled "Expected — [description]"; movements without a matching annotation are labeled "Annotate — what drove this?"

The op also checks whether the emergency fund (liquid assets: checking + savings + HYSA) covers at least 3 months of essential monthly expenses. If coverage has dropped below 3 months, an open-loop flag is generated. If coverage dropped below 3 months for the second consecutive month, the flag is elevated to HIGH severity.

All flags are consolidated via `aireadylife-wealth-update-open-loops`. The summary is written to `vault/wealth/02_briefs/YYYY-MM-net-worth.md` and also updates the current state file `vault/wealth/00_current/current-net-worth.md` with just the headline number (current net worth and date) for quick reference by other ops.

## Calls

- **Flows:** `aireadylife-wealth-build-net-worth-summary`
- **Tasks:** `aireadylife-wealth-update-open-loops`

## Apps

None (reads from vault; account balances must be updated manually or via configured app downloads before this op runs)

## Vault Output

- `vault/wealth/02_briefs/YYYY-MM-net-worth.md` — full net worth table
- `vault/wealth/00_current/current-net-worth.md` — headline number for quick reference
- `vault/wealth/open-loops.md` — unexplained movement flags and emergency fund alerts

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/wealth/00_current/` — active records and current state
- Reads from: `~/Documents/aireadylife/vault/wealth/01_prior/` — prior period records for trend comparison
- Reads from: `~/Documents/aireadylife/vault/wealth/02_briefs/` — prior briefs for period-over-period context
