---
name: aireadylife-tax-task-extract-income-ytd
type: task
cadence: called-by-op
description: >
  Reads YTD income totals from vault/tax/ across all income source types and returns
  a structured breakdown for use by estimated tax flows. Income categories: W-2 wages
  (gross and YTD withholding), 1099-NEC self-employment income, rental income (net
  of expenses), short-term capital gains, long-term capital gains, qualified dividends,
  ordinary dividends, interest income, and other income. Also returns total YTD federal
  withholding and prior quarterly estimated payments.
---

# aireadylife-tax-extract-income-ytd

**Cadence:** Called by `aireadylife-tax-build-estimate` and other flows needing YTD income figures
**Produces:** Structured YTD income summary returned in memory to the calling flow

## What It Does

A utility task called whenever a flow needs current year-to-date income and withholding figures. Rather than each flow reading every income document independently, this task centralizes income extraction and returns a clean, standardized record.

**W-2 income.** Reads W-2 pay stub records from `vault/tax/00_current/YYYY/` — either downloaded portal pay stubs or the user's most recent W-2 if available. Extracts: YTD gross wages, YTD federal income tax withheld, YTD Social Security withheld, YTD Medicare withheld, YTD state income tax withheld. If multiple employers are active (job change during the year), reads each separately and sums.

**Self-employment income (1099-NEC).** Reads 1099-NEC records and any freelance income logs from `vault/tax/00_current/` or `vault/tax/00_current/`. Returns gross 1099 income and deductible business expenses associated with each payer if available.

**Rental income.** If the estate plugin is installed and cross-plugin sharing is configured, reads net rental income from `vault/wealth/` or estate records. Otherwise reads from any rental income logs in `vault/tax/`. Returns gross rent received and deductible expenses (mortgage interest, property tax, depreciation, maintenance) for net rental income.

**Capital gains.** Reads realized gains and losses from brokerage records in `vault/wealth/00_current/` (if cross-plugin sharing is configured) or from 1099-B records in `vault/tax/00_current/`. Separates short-term gains (≤1 year holding period, taxed as ordinary income) from long-term gains (>1 year, taxed at preferential rates). Net capital gain/loss after applying losses against gains.

**Dividends and interest.** From 1099-DIV records: qualified dividends (preferential tax rate) and ordinary dividends (ordinary income rate). From 1099-INT records: bank interest income.

**YTD withholding and prior payments.** Total federal income tax withheld from W-2 records. Total estimated payments made YTD from `vault/tax/00_current/payment-log.md`. Prior year overpayment applied to current year (from config if applicable).

**Return structure.** The task returns a structured record (not a vault-written document) with all the above fields populated and labeled, so the calling flow (`aireadylife-tax-build-estimate`) can immediately use the data without additional parsing.

## Apps

None

## Vault Output

- None (read-only task; returns data to calling flow in memory)
- No vault writes
