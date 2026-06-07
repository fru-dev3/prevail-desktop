---
name: aireadylife-wealth-flow-build-net-worth-summary
type: flow
trigger: called-by-op
description: >
  Aggregates all asset balances and outstanding liabilities into a net worth table
  with month-over-month delta for each line item. Asset categories: liquid (checking,
  savings, HYSA), tax-advantaged retirement (401k, Roth IRA, Traditional IRA),
  tax-advantaged other (HSA, 529), taxable investments (brokerage), and real estate
  equity. Liabilities listed individually. Flags any account with unexplained
  movement greater than $500 vs. prior month snapshot.
---

# aireadylife-wealth-build-net-worth-summary

**Trigger:** Called by `aireadylife-wealth-net-worth-review`
**Produces:** Net worth table at `vault/wealth/02_briefs/YYYY-MM-net-worth.md`

## What It Does

Reads all account balance records from `vault/wealth/00_current/` — one file per account, updated during the monthly sync — and all liability records from `vault/wealth/00_current/` to build a complete, categorized net worth snapshot.

**Asset aggregation.** Accounts are grouped into five categories: Liquid (checking, savings, money market, HYSA — cash available without penalty), Tax-Advantaged Retirement (401k, Traditional IRA, SEP-IRA, SIMPLE IRA, Roth IRA, Roth 401k — note that Roth balances are after-tax, while traditional balances are pre-tax and will be taxed on withdrawal), Tax-Advantaged Other (HSA, FSA, 529 plans), Taxable Investments (brokerage accounts at Fidelity, Vanguard, Schwab, M1, Robinhood, etc.), and Real Estate Equity (current estimated property value minus outstanding mortgage balance — read from config.md estimated values and from `vault/wealth/00_current/` for mortgage balance). Other Assets are listed separately if configured (vehicle value, business equity stake).

**Liability aggregation.** Each liability is listed individually: mortgage (with outstanding balance and current interest rate), auto loan, student loans, personal loans, credit card balances (sum of all cards). Total liabilities is the sum of all outstanding balances.

**Net worth calculation.** Total assets − total liabilities. The result is compared to the prior month's snapshot (read from the prior month's net worth file in `vault/wealth/02_briefs/`). MoM delta is shown as both a dollar amount and a percentage change.

**Per-line delta.** Every account line shows: current balance, prior month balance, and MoM delta ($ and %). Any account where the delta exceeds $500 without a clearly expected explanation (e.g., known large paycheck deposit, known annual expense) is annotated with "Review — unexplained movement."

**Context annotations.** The flow reads a notes field from each account file where the user can pre-annotate expected large movements (e.g., "401k: Q1 employer match hits in February"). Annotated movements are shown as "Expected — [note]" rather than flagged.

## Triggers

- "net worth review"
- "monthly wealth check"
- "how is my net worth trending"
- "show my account balances"
- "what is my net worth"
- "build the net worth table"
- "wealth snapshot"

## Steps

1. Read all account balance files from `vault/wealth/00_current/` and parse: account name, institution, account type, current balance, prior month balance, notes
2. Read all liability records from `vault/wealth/00_current/` and parse: debt name, type, outstanding balance, interest rate
3. Group assets into five categories; sum category totals and grand total
4. Sum all liabilities for total liabilities figure
5. Compute net worth = total assets − total liabilities
6. Read prior month's net worth from `vault/wealth/02_briefs/YYYY-MM-net-worth.md` (prior month file)
7. Calculate MoM delta: current net worth minus prior net worth, and percent change
8. For each account line, calculate delta and flag lines with |delta| > $500 without a matching annotation
9. Write formatted net worth table to `vault/wealth/02_briefs/YYYY-MM-net-worth.md`
10. Return list of flagged accounts (unexplained movements) to calling op

## Input

- `vault/wealth/00_current/` — one file per account with current and prior balance
- `vault/wealth/00_current/` — all liability records
- `vault/wealth/01_prior/` — prior period records for trend comparison
- `vault/wealth/02_briefs/` — prior month net worth file (for MoM comparison)
- `vault/wealth/config.md` — real estate estimated values, account type classifications

## Output Format

Markdown document at `vault/wealth/02_briefs/YYYY-MM-net-worth.md`:
- Header: snapshot date, total assets, total liabilities, net worth, MoM delta ($), MoM delta (%)
- Assets table: Category | Account | Institution | Balance | Prior Month | Delta | Flag
- Liabilities table: Debt | Type | Balance | Rate | Prior Month | Delta
- Net Worth summary line
- Flagged accounts section with annotation or "Review — unexplained movement"

## Configuration

Required fields in `vault/wealth/config.md`:
- Account list with account type classification for each (liquid, retirement, other-tax-advantaged, taxable, real estate, other)
- `real_estate_estimated_value` — estimated current market value per property
- `unexplained_movement_threshold` — flag threshold in dollars (default: $500)

## Error Handling

- If an account file is missing for an account listed in config: flag "Missing balance data for [account name] — add to vault/wealth/00_current/ and re-run"
- If prior month net worth file doesn't exist (first run): show current snapshot without MoM comparison; note "First snapshot — MoM comparison available next month"
- If a liability record is missing the interest rate: include balance but mark rate as "unknown — update in vault/wealth/00_current/"

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/wealth/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/wealth/00_current/` (all account files)
- Reads from: `~/Documents/aireadylife/vault/wealth/00_current/` (all liability files)
- Reads from: `~/Documents/aireadylife/vault/wealth/02_briefs/` (prior month file)
- Reads from: `~/Documents/aireadylife/vault/wealth/config.md`
- Writes to: `~/Documents/aireadylife/vault/wealth/02_briefs/YYYY-MM-net-worth.md`
