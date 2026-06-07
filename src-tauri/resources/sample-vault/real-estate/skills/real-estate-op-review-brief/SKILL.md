---
name: aireadylife-real-estate-op-review-brief
type: op
cadence: monthly
description: >
  Monthly real estate review brief. Compiles market conditions for all target markets,
  buy vs. rent verdict, affordability ceiling update, active listings of interest, and
  portfolio expansion opportunities into a single briefing document.
  Triggers: "real estate brief", "housing update", "market analysis", "real estate summary".
---

# aireadylife-real-estate-review-brief

**Cadence:** Monthly (1st of month, after monthly sync) or on-demand
**Produces:** Real estate brief — market conditions, affordability update, buy vs. rent verdict, action items

## What It Does

This op generates the monthly real estate briefing document — a concise, decision-ready summary of where things stand across all tracked dimensions: the housing market in target neighborhoods, the user's current buying power, the buy vs. rent verdict, and any active listings or opportunities being monitored.

The brief opens with a headline section showing the most important number: the current maximum purchase price the user qualifies for, the 30-year rate used in that calculation, and whether affordability has improved or worsened since last month. This headline is followed by the buy vs. rent verdict — a single plain-language sentence ("Renting is more cost-effective in Minneapolis MN over a 7-year horizon at today's prices and rates; break-even would occur at year 11") with the supporting data on one line.

The market conditions section presents the target market snapshot: median price, active inventory, months of supply, and DOM for each configured neighborhood. Any significant market shifts flagged by the market scan (>5% MoM change in any metric) are highlighted. Markets that have crossed into buyer's market territory (>6 months supply) are noted as potential acquisition opportunities. Markets where inventory is dropping rapidly and DOM has compressed below 21 days are flagged as competitive — a signal to be pre-approved and ready to move quickly.

The active listings section surfaces any specific properties saved in the vault that are still active. For each listing: current status (still active, price reduced, pending, sold), days on market since saved, any price history changes, and a recommendation on whether to revisit, offer, or pass. Listings sitting more than 60 days with no price reduction may have hidden issues — this is flagged.

Action items are sorted by urgency and categorized: things to do this week (renew pre-approval if expiring, tour a flagged listing), things to do this month (update rate in config, run investment property analysis), and things to monitor (markets approaching thresholds).

## Triggers

- "Give me my real estate brief"
- "Real estate update"
- "What's happening in the housing market?"
- "Monthly real estate summary"
- "Buy vs rent update"
- "Real estate review"
- "How's the market this month?"

## Steps

1. Read affordability analysis from `~/Documents/aireadylife/vault/real-estate/00_current/YYYY-MM-affordability.md`
2. Read prior month affordability to calculate delta; note dollar change in max purchase price
3. Read market snapshots from `~/Documents/aireadylife/vault/real-estate/00_current/YYYY-MM-market-report.md`
4. Identify markets in buyer's territory (>6 months supply) vs. seller's territory (<3 months)
5. Read buy vs. rent analysis from `~/Documents/aireadylife/vault/real-estate/00_current/` and state break-even year
6. Read active listings from `~/Documents/aireadylife/vault/real-estate/00_current/` and update DOM counts
7. Flag any saved listings with >60 days DOM and no price change as potential issues
8. Read open-loops.md for existing flags; include unresolved items in action items section
9. Compile all sections into structured brief
10. Write brief to `~/Documents/aireadylife/vault/real-estate/02_briefs/YYYY-MM-realestate-brief.md`
11. Call `aireadylife-real-estate-update-open-loops` to record any new flags from the brief

## Input

- `~/Documents/aireadylife/vault/real-estate/00_current/YYYY-MM-affordability.md`
- `~/Documents/aireadylife/vault/real-estate/00_current/YYYY-MM-market-report.md`
- `~/Documents/aireadylife/vault/real-estate/00_current/`
- `~/Documents/aireadylife/vault/real-estate/01_prior/` — prior period records for trend comparison
- `~/Documents/aireadylife/vault/real-estate/open-loops.md`

## Output Format

```
# Real Estate Brief — [Month Year]

## Buying Power
Max Purchase Price: $X | Rate: X.XX% | Change from Last Month: +/- $X

## Buy vs. Rent Verdict
[Single sentence verdict] | Break-even: Year X | 7yr cost delta: $X favor [buy/rent]

## Market Conditions
| Market | Median Price | MoM | Inventory | DOM | Months Supply | Signal |

## Active Listings
| Address | Days Tracked | Current DOM | Price | Change | Status | Action |

## Open Loops
[Unresolved flags from prior months with dates]

## Action Items — This Week
- [Urgent items]

## Action Items — This Month
- [Near-term items]

## Watching
- [Monitor items]
```

## Configuration

Required: `~/Documents/aireadylife/vault/real-estate/config.md` populated and vault synced at least once.

## Error Handling

- If vault does not exist: direct to frudev.gumroad.com/l/aireadylife-real-estate
- If monthly sync has not been run: note data may be stale; offer to run sync first
- If no listings saved: omit listings section; note how to save a listing using the log-listing task
- If prior month brief missing: skip delta comparison; note first brief

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/real-estate/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/real-estate/00_current/`, `00_markets/`, `01_listings/`, `open-loops.md`
- Writes to: `~/Documents/aireadylife/vault/real-estate/02_briefs/YYYY-MM-realestate-brief.md`
- Writes to: `~/Documents/aireadylife/vault/real-estate/open-loops.md`
