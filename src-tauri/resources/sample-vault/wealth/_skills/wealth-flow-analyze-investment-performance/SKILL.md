---
name: aireadylife-wealth-flow-analyze-investment-performance
type: flow
trigger: called-by-op
description: >
  Reviews all investment accounts — 401k, Roth IRA, Traditional IRA, HSA (invested),
  taxable brokerage — and calculates 30-day and YTD returns per account. Derives
  current asset allocation (stocks domestic, stocks international, bonds, cash,
  real estate) and compares to configured target allocation. Flags any asset class
  more than 5 percentage points off target with specific rebalancing amounts. Checks
  401k contribution pace against the 2025 IRS limit of $23,500.
---

# aireadylife-wealth-analyze-investment-performance

**Trigger:** Called by `aireadylife-wealth-investment-review`
**Produces:** Investment performance summary at `vault/wealth/00_current/YYYY-MM-performance.md`

## What It Does

Reads all investment account records from `vault/wealth/00_current/` — one directory per account containing holdings snapshots, historical value records, and contribution logs — and produces a comprehensive performance and allocation analysis.

**Per-account returns.** For each investment account (identified by type and institution in config), the flow calculates: 30-day simple return ((current value − value 30 days ago) / value 30 days ago), YTD simple return ((current value − value on January 1) / January 1 value), and total return since inception where data allows. Dollar P&L is shown alongside percentage return. Contributions made during the period are noted separately so return is not inflated by new money.

**Asset allocation derivation.** Holdings records list each position by ticker or fund name. The flow maps each holding to an asset class category using the embedded fund taxonomy: domestic equity funds (e.g., FXAIX, VFIAX, VTI, SWTSX), international equity funds (e.g., VXUS, IXUS, FZILX), bond funds (e.g., BND, VBTLX, AGG), real estate/REITs (VNQ, VGSIX), cash and money market (SPAXX, FDRXX). When a holding is not in the embedded taxonomy, the user is prompted to classify it manually in the holdings record.

**Allocation drift check.** Actual allocation percentages across the entire invested portfolio (sum of all taxable and tax-advantaged accounts) are compared to the target allocation in config.md. Any asset class more than 5 percentage points from target is flagged for rebalancing. The flag includes: the asset class, current %, target %, over/under, the dollar amount to add or trim to restore target, and the specific account(s) best suited for the rebalancing trade (preference: tax-advantaged accounts first for rebalancing to avoid taxable events).

**401k contribution pace.** Reads YTD contribution total from the 401k holdings record and compares to the 2025 IRS limit ($23,500; $31,000 if age 50+). Annualizes the current contribution rate and flags if the projected full-year contribution will miss the limit by more than $500. Includes the math: "At your current rate of $X/paycheck biweekly, you'll contribute $Y by year-end — $Z below the limit. Increase to $Z/paycheck to max out."

**IRA contribution tracking.** Reads IRA contribution log and compares YTD contributions to the 2025 limit ($7,000; $8,000 if 50+). Flags the April 15 deadline for prior-year IRA contributions.

## Triggers

- "investment review"
- "check my portfolio"
- "am I due for rebalancing"
- "how are my investments doing"
- "portfolio performance"
- "allocation check"
- "401k pace"
- "am I on track to max my IRA"

## Steps

1. Read all investment account holdings files from `vault/wealth/00_current/` — current holdings snapshot and historical value records
2. Calculate 30-day return per account using current value and value 30 days prior
3. Calculate YTD return per account using current value and January 1 value
4. Map each holding to an asset class using embedded fund taxonomy
5. Sum holdings by asset class across all accounts; compute portfolio-level allocation percentages
6. Compare actual allocation to target allocation from config.md; calculate drift per class
7. Flag any asset class with |drift| > 5% and calculate the rebalancing dollar amount
8. Read YTD 401k contributions from contribution log and compare to IRS limit; compute pace
9. Read IRA contribution log and compare to limit; flag if April 15 deadline is approaching
10. Write formatted performance summary and allocation analysis to `vault/wealth/00_current/YYYY-MM-performance.md`

## Input

- `vault/wealth/00_current/[account-name]/holdings.md` — current holdings for each account
- `vault/wealth/00_current/[account-name]/values.csv` — historical account values by date
- `vault/wealth/00_current/[account-name]/contributions.md` — YTD contribution log
- `vault/wealth/01_prior/` — prior period records for trend comparison
- `vault/wealth/config.md` — target allocation, account types, IRS limit overrides for catch-up contributions

## Output Format

Markdown document at `vault/wealth/00_current/YYYY-MM-performance.md`:
- Performance table: Account | Institution | Type | 30-Day Return | YTD Return | Current Value | YTD Contributions
- Allocation table: Asset Class | Target % | Actual % | Drift | Dollar Amount | Status (OK / REBALANCE)
- 401k section: YTD Contributions | Annual Pace | IRS Limit | Gap | Suggested Increase
- Rebalancing recommendations section (if any drift > 5%)

## Configuration

Required in `vault/wealth/config.md`:
- `target_allocation` — target percentages per asset class (must sum to 100)
- `401k_contribution_per_paycheck` — current contribution amount
- `paycheck_frequency` — biweekly | semi-monthly | monthly | weekly
- `age` — for catch-up contribution limit eligibility (50+)
- `ira_type` — roth | traditional | both

## Error Handling

- If a holding cannot be mapped to an asset class: list as "Unclassified — update holdings record" and exclude from allocation calculation; note total unclassified value
- If value history doesn't extend back 30 days or to January 1: compute return for available period and note the date range used
- If no investment accounts are configured: report "No investment accounts configured — add accounts to vault/wealth/config.md"

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/wealth/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/wealth/00_current/` (all account subdirectories)
- Reads from: `~/Documents/aireadylife/vault/wealth/config.md`
- Writes to: `~/Documents/aireadylife/vault/wealth/00_current/YYYY-MM-performance.md`
