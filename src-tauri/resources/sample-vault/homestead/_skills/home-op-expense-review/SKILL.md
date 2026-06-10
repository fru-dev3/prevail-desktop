---
name: aireadylife-home-op-expense-review
type: op
cadence: monthly
description: >
  Monthly home expense review. Tracks utilities, repairs, supplies, and services vs. monthly
  budget. Flags categories 20%+ over budget, trends utilities YoY to catch rate increases, and
  tracks repair costs by system to signal approaching replacement thresholds.
  Triggers: "home expenses", "utility review", "repair costs", "home budget", "what did I spend on the house".
---

# aireadylife-home-expense-review

**Cadence:** Monthly (1st of month)
**Produces:** Home expense summary with category totals, budget variance, utility trends, and repair system tracker

## What It Does

This op reviews all home expenses logged in the vault during the previous month and produces the full financial picture of home operating costs. For homeowners, understanding home expenses is critical to accurate personal budgeting — housing costs extend far beyond the mortgage payment. For renters, tracking utilities and service costs against budget keeps discretionary home spending visible and accountable.

The op categorizes every logged expense into four categories (utilities, repairs, supplies, services), calculates totals against monthly budget, and flags any category running significantly over plan. It trends utility bills against both the prior month and the same month in the prior year — a June electric bill that is 15% higher than last June deserves investigation (rate increase? air conditioner running harder? new appliance?).

Repair tracking is a particularly important function. Repairs accumulate by system across the year. A water heater that required $400 in repairs in January and another $300 in September has cost $700 in a single year — which compares unfavorably against a replacement cost of $800–$1,500. The op calculates YTD repair costs per system and flags when accumulated repair costs exceed 50% of estimated replacement cost as a "consider replacement" signal. It also tracks how repair costs per system compare to the standard 1% annual maintenance rule: if total home maintenance spending exceeds 1% of home value in a year, that is notable (though older homes commonly run 1.5–2% annually).

For homeowners specifically, the op also checks home improvement ROI for any capital project completed in the prior month. Standard improvement ROI benchmarks: kitchen remodel (minor/major): 65–85% of cost recovered at resale; bathroom remodel: 60–75%; deck addition: 60–70%; basement finish: 70–80%; new roof: 60–70% (but lowers buyer risk and enables sale). Any home improvement logged above $5,000 gets noted with the estimated ROI range as context for the investment decision.

## Triggers

- "Review my home expenses"
- "What did I spend on the house this month?"
- "Home budget check"
- "How are my utilities trending?"
- "Run the home expense review"
- "What are my repair costs so far this year?"
- "Home monthly expense summary"

## Steps

1. Read all expense records from `~/Documents/aireadylife/vault/home/00_current/YYYY-MM-expenses.md`
2. Call `aireadylife-home-build-expense-summary` to produce the full expense summary table
3. Read annual budget from config.md; calculate MoM and YTD vs. budget per category
4. Flag categories more than 20% over monthly budget
5. Compare utility amounts to prior month and same-month prior year; calculate YoY delta
6. Calculate YTD repair costs by system; flag any system where YTD repairs > 50% of replacement cost estimate
7. Check if any repair exceeds $2,500 (potential CapEx threshold for homeowners — not deductible unless rental property)
8. Check for any home improvement projects logged above $5,000; note estimated resale ROI range
9. Write expense review to `~/Documents/aireadylife/vault/home/00_current/YYYY-MM-expense-review.md`
10. Call `aireadylife-home-update-open-loops` with budget overrun flags and repair replacement signals
11. Present results with table, headline numbers, and plain-language summary

## Input

- `~/Documents/aireadylife/vault/home/00_current/YYYY-MM-expenses.md`
- `~/Documents/aireadylife/vault/home/00_current/` (prior months for YTD and MoM)
- `~/Documents/aireadylife/vault/home/01_prior/` (prior year same-month for utility YoY)
- `~/Documents/aireadylife/vault/home/config.md` (budget, replacement cost estimates)

## Output Format

**Headline:** Total Monthly Home Spend: $X | vs. Budget: +/-$X (+/-X%)

**Expense Table:** (same as flow output — categories vs. budget vs. prior period)

**Utility YoY Comparison:** Month-over-month and year-over-year per utility

**Repair System Tracker:** YTD by system with replacement cost comparison

**Home Improvement ROI Notes:** For any capital project above $5,000

**Open Loop Flags Added:** Budget overruns, system replacement signals

## Configuration

Required in `~/Documents/aireadylife/vault/home/config.md`:
- `annual_utilities_budget`, `annual_repairs_budget`, `annual_supplies_budget`, `annual_services_budget`
- `home_value` (for 1% maintenance rule check)
- `hvac_replacement_cost`, `water_heater_replacement_cost` (for repair threshold signals)

## Error Handling

- If vault missing: direct to frudev.gumroad.com/l/aireadylife-home
- If no expenses logged for the month: present $0 summary; offer to log expenses using home-task-log-expense
- If budget fields missing from config: run expense summary without variance; note config fields needed

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/home/00_current/`, `04_archive/`, `config.md`
- Writes to: `~/Documents/aireadylife/vault/home/00_current/YYYY-MM-expense-review.md`
- Writes to: `~/Documents/aireadylife/vault/home/open-loops.md`
