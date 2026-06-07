---
name: aireadylife-wealth-task-extract-account-balance
type: task
cadence: called-by-op
description: >
  Reads a specific account's current balance, prior-period balance, and institution
  name from vault/wealth/00_current/ and returns the structured record to the calling
  flow. Called by wealth flows that need a targeted balance lookup without loading the
  entire accounts directory. Accepts account nickname (e.g., "Fidelity 401k") or
  account type (e.g., "primary checking") as lookup key.
---

# aireadylife-wealth-extract-account-balance

**Cadence:** Called by wealth flows that need a specific account balance
**Produces:** Structured balance record returned in memory to the calling flow

## What It Does

A utility task called by wealth flows — particularly `aireadylife-wealth-build-net-worth-summary` and `aireadylife-wealth-analyze-investment-performance` — that need to look up a specific account's balance without iterating through every account file in `vault/wealth/00_current/`. This is especially useful when a flow only needs one or two account balances (e.g., the cash flow review needs the checking balance to verify a deposit was received) rather than the full portfolio aggregate.

The task accepts a lookup key — either an account nickname as configured in config.md (e.g., "Fidelity 401k", "Ally HYSA", "M1 Brokerage") or an account type (e.g., "primary checking", "emergency fund", "ira-roth") — and returns a standardized balance record containing: account nickname, institution name, account type (checking/savings/HYSA/brokerage/401k/IRA-roth/IRA-traditional/HSA/529/other), last-updated date, current balance, and prior period balance.

The "prior period balance" is the balance recorded at the end of the previous month — used by calling flows for MoM delta calculations. The task reads from the account's structured file in `vault/wealth/00_current/[account-nickname].md` which is maintained in a consistent format across all accounts.

When the balance record's last-updated date is more than 35 days ago (meaning the account wasn't updated during the most recent monthly sync), the task flags the stale data to the calling flow with a "STALE — last updated [date]" tag so the calling flow can handle it appropriately (typically by prompting the user to update before the summary is run).

The consistent return format — a standardized balance record — means flows don't need to know the internal file structure of each account file. Adding a new account or renaming an existing account requires only updating the account file and config.md; no flow code needs to change.

## Apps

None

## Vault Output

- None (read-only task; returns data to calling flow in memory)
- No vault writes; the account file itself is not modified
