---
name: aireadylife-home-flow-build-expense-summary
type: flow
trigger: called-by-op
description: >
  Summarizes monthly home expenses by category (utilities, repairs, supplies, services) vs.
  prior month and YTD budget. Flags categories more than 20% over budget. Trends utility
  bills against same month prior year to catch rate increases and seasonal anomalies.
---

# aireadylife-home-build-expense-summary

**Trigger:** Called by `aireadylife-home-expense-review`
**Produces:** Expense summary table with category totals, MoM variance, YTD vs. budget, and flagged overruns

## What It Does

This flow reads all expense records logged in the vault for the current month and assembles them into a structured summary that makes the month's home spending instantly visible and comparable to budget and prior periods.

Home expenses are grouped into four standard categories. Utilities: electricity, gas, water/sewer, internet, cable/streaming TV (when bundled with internet for the home). Repairs: any contractor or parts expense for fixing or restoring something in the home — HVAC repair, plumbing fix, appliance repair, roof patch. Supplies: consumables purchased for home use — cleaning products, hardware, light bulbs, HVAC filters, garden supplies. Services: recurring or one-time service providers — lawn mowing, snow removal, house cleaning service, pest control treatment, gutter cleaning.

For each category, the flow calculates: total spent this month, total spent last month (from prior month's expense file), month-over-month dollar and percentage change, YTD total (sum of all monthly totals from January), and YTD budget remaining (annual budget from config.md ÷ 12 × months elapsed minus YTD total). Any category where the monthly amount exceeds the monthly budget by more than 20% is flagged as a budget overrun — this threshold distinguishes routine variance from genuine overspend.

Utility bills get special trending treatment: the flow compares the current month's utility amounts against the same month in the prior year (pulled from the archive) to surface rate increases or efficiency changes that seasonal comparison masks. A January electric bill that is $40 higher than last January may reflect either a rate increase or unusual cold — the flow notes which months are being compared and the dollar delta so the user can investigate.

Repair expenses are tracked with a running YTD total and system-specific subtotals where the repair category is labeled (e.g., "HVAC: $1,200 YTD"). When a single repair system accumulates more than 50% of an estimated replacement cost within a 12-month period, the flow flags it as an approaching replacement signal: "HVAC repair costs YTD: $1,200 — replacement cost estimate: $5,000–$8,000. Consider whether repair or replacement is more cost-effective."

The single-number headline — total monthly home spend — is always the first output, making the report immediately actionable for budget review conversations.

## Steps

1. Read all expense records from `~/Documents/aireadylife/vault/home/00_current/YYYY-MM-expenses.md`
2. Group expenses by category: utilities, repairs, supplies, services
3. Sum monthly total per category
4. Read prior month expense file for MoM comparison; calculate MoM change per category
5. Read annual budget from `~/Documents/aireadylife/vault/home/config.md`; calculate YTD vs. budget per category
6. Flag any category where monthly spend exceeds monthly budget by more than 20%
7. Pull same-month prior year utility amounts from `~/Documents/aireadylife/vault/home/01_prior/`; calculate YoY delta per utility
8. For repair category: calculate YTD repair total by system (HVAC, plumbing, appliances); flag if system repair YTD > 50% of replacement cost estimate
9. Calculate total monthly home spend as headline number
10. Return formatted summary to calling op

## Input

- `~/Documents/aireadylife/vault/home/00_current/YYYY-MM-expenses.md` — current month expenses
- `~/Documents/aireadylife/vault/home/00_current/YYYY-{prior-MM}-expenses.md` — prior month
- `~/Documents/aireadylife/vault/home/01_prior/` — same-month prior year (for utility YoY)
- `~/Documents/aireadylife/vault/home/config.md` — annual budget by category

## Output Format

**Headline:** Total Monthly Home Spend: $X

**Expense Table:**
| Category | This Month | Last Month | MoM% | YTD | Budget Remaining | Flag |
| Utilities | $X | $X | X% | $X | $X | |
| Repairs | $X | $X | X% | $X | $X | ⚠ OVER BUDGET |
| Supplies | $X | $X | X% | $X | $X | |
| Services | $X | $X | X% | $X | $X | |
| **Total** | **$X** | **$X** | **X%** | **$X** | **$X** | |

**Utility YoY Comparison:**
| Utility | This Month | Same Month LY | Change |

**Repair System Tracker:**
| System | YTD Repairs | Est. Replacement Cost | Signal |

## Configuration

Required in `~/Documents/aireadylife/vault/home/config.md`:
- `annual_utilities_budget`, `annual_repairs_budget`, `annual_supplies_budget`, `annual_services_budget`
- Per-system replacement cost estimates (optional, for repair trend analysis): `hvac_replacement_cost`, `water_heater_replacement_cost`

## Error Handling

- If no expenses logged for the month: output $0 totals; note "No expenses logged — use home-task-log-expense to record expenses"
- If prior month file missing: skip MoM comparison; note "No prior month data"
- If archive missing for YoY utility comparison: skip YoY; note "No prior year data"
- If budget fields not in config: skip budget variance; note "Add budget fields to config.md to enable budget tracking"

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/home/00_current/`
- Reads from: `~/Documents/aireadylife/vault/home/01_prior/`
- Reads from: `~/Documents/aireadylife/vault/home/config.md`
- Writes to: `~/Documents/aireadylife/vault/home/00_current/YYYY-MM-summary.md`
