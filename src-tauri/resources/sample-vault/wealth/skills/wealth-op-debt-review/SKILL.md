---
name: aireadylife-wealth-op-debt-review
type: op
cadence: quarterly
description: >
  Quarterly debt review. Calculates payoff timelines and total remaining interest cost
  for all outstanding loans (mortgage, auto, student, credit card, personal). Ranks by
  interest rate (avalanche method). Models $100/month and $500/month extra-payment
  scenarios showing interest savings and payoff acceleration. Flags debt milestones.
  Triggers: "debt review", "payoff timeline", "how much interest am I paying",
  "model extra payments", "debt summary".
---

# aireadylife-wealth-debt-review

**Cadence:** Quarterly (1st of January, April, July, October)
**Produces:** Debt summary table at `vault/wealth/00_current/YYYY-MM-debt-summary.md`; milestone flags in `vault/wealth/open-loops.md`

## What It Does

Runs quarterly to give a complete picture of all outstanding liabilities and the true cost of carrying them. The quarterly cadence is right for debt: balances change monthly but the strategic picture (which debt to attack, how much extra to pay, when debts will be paid off) doesn't require monthly re-analysis. More frequent review would add noise; annual review would miss mid-year milestone opportunities.

The op calls `aireadylife-wealth-build-debt-summary` to read all debt records, calculate payoff timelines and total remaining interest at current pace, rank by interest rate, and model extra-payment scenarios. The key insight the summary surfaces: the total remaining interest figure is the motivation. A $25,000 car loan at 7.5% APR might have $4,200 of interest remaining — that's the actual cost to the borrower, not the monthly payment.

**Extra-payment modeling.** The avalanche method applies extra payments to the highest-rate non-mortgage debt first. The $100/month scenario is calibrated for modest budget flexibility; the $500/month scenario represents a more aggressive paydown commitment. For each scenario, the review shows: months saved on the target debt, total interest saved on the target debt, and the projected cascade effect where the freed payment amount rolls into the next-highest-rate debt. This cascade visualization is the key motivator for the avalanche method.

**Debt milestones.** When any debt's outstanding balance crosses a pre-configured milestone during the quarter, `aireadylife-wealth-flag-savings-milestone` is called. Common milestones: mortgage principal drops below $400k, $350k, $300k; student loan paid below $10k; auto loan fully paid off. Each milestone flag suggests where to redirect the freed monthly payment.

**Debt-to-income ratio.** The review reports current DTI and compares to the prior quarter. DTI improvement over time is a positive trend; DTI increasing (new debt added or income decreased) is flagged.

## Calls

- **Flows:** `aireadylife-wealth-build-debt-summary`
- **Tasks:** `aireadylife-wealth-flag-savings-milestone`, `aireadylife-wealth-update-open-loops`

## Apps

None

## Vault Output

- `vault/wealth/00_current/YYYY-MM-debt-summary.md` — debt table with payoff timelines and scenarios
- `vault/wealth/open-loops.md` — milestone flags and DTI alerts

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/wealth/00_current/` — active records and current state
- Reads from: `~/Documents/aireadylife/vault/wealth/01_prior/` — prior period records for trend comparison
- Reads from: `~/Documents/aireadylife/vault/wealth/02_briefs/` — prior briefs for period-over-period context
