---
name: aireadylife-content-flow-build-revenue-summary
type: flow
trigger: called-by-op
description: >
  Aggregates revenue from all content channels into a single monthly summary
  with MoM comparison, identifying the top channel and flagging declines >20%.
---

## What It Does

Reads revenue data from all three monetization vault locations and produces a unified monthly revenue report for the content business. Revenue from a content business comes from multiple streams with very different characteristics: YouTube AdSense is passive and platform-controlled (RPM fluctuates 20-50% seasonally, peaks in Q4), newsletter revenue includes both predictable MRR from paid subscriptions and variable sponsorship fees, and digital product revenue from Gumroad is driven by promotional activity and traffic quality.

From `~/Documents/aireadylife/vault/content/00_current/`, extracts AdSense earnings for the current month and prior month. RPM (revenue per thousand views) is tracked separately from total earnings to distinguish whether revenue changes are driven by views volume or advertiser rate changes. From `~/Documents/aireadylife/vault/content/00_current/`, extracts sponsorship revenue and paid subscription MRR separately — combining them would obscure whether the subscription base is growing or whether sponsorship activity is driving the revenue. From `~/Documents/aireadylife/vault/content/00_current/`, extracts digital product sales by individual product so that top-performing and underperforming products are visible, not just totals.

Sums all streams to produce total content revenue for the month. Calculates MoM delta in both dollar amount and percentage for each channel and for the total. Identifies the single top-contributing channel (the one responsible for the largest share of total revenue). Flags any channel that declined more than 20% MoM with the channel name, decline percentage, and a note about whether this is likely seasonal (e.g., YouTube RPM decline in January is expected) or anomalous (decline during normally strong periods). Returns the full summary to the calling op.

## Triggers

Called internally by `aireadylife-content-op-revenue-review`. Not invoked directly by the user.

## Steps

1. Read YouTube AdSense data from `~/Documents/aireadylife/vault/content/00_current/` for current and prior month; extract total earnings, views, and RPM
2. Read newsletter revenue from `~/Documents/aireadylife/vault/content/00_current/` for current and prior month; extract sponsorship revenue and subscription MRR separately
3. Read Gumroad product sales from `~/Documents/aireadylife/vault/content/00_current/` for current and prior month; extract sales by product (name, units, revenue, refunds)
4. Calculate total revenue per channel: YouTube total, newsletter total (sponsorship + MRR), Gumroad total
5. Sum all channels to produce total content revenue for the month
6. Calculate MoM dollar delta and percentage change per channel and for the total
7. Calculate revenue share % per channel (this channel's revenue / total × 100)
8. Identify top revenue channel (highest revenue contribution this month)
9. Flag any channel with >20% MoM revenue decline; note whether the timing suggests seasonal effect
10. Calculate YTD total content revenue if prior months' data is available
11. Return full structured revenue summary to calling op

## Input

- `~/Documents/aireadylife/vault/content/00_current/{YYYY-MM}.md` — AdSense earnings, views, RPM
- `~/Documents/aireadylife/vault/content/00_current/{prior YYYY-MM}.md` — prior month YouTube data
- `~/Documents/aireadylife/vault/content/00_current/{YYYY-MM}.md` — sponsorship fees, MRR
- `~/Documents/aireadylife/vault/content/00_current/{prior YYYY-MM}.md` — prior month newsletter data
- `~/Documents/aireadylife/vault/content/00_current/{YYYY-MM}.md` — product sales by product
- `~/Documents/aireadylife/vault/content/00_current/{prior YYYY-MM}.md` — prior month Gumroad data
- `~/Documents/aireadylife/vault/content/01_prior/` — prior period records for trend comparison

## Output Format

```
## Revenue Summary — {Month} {Year}

| Channel              | This Month | Prior Month | Delta   | Share  |
|----------------------|------------|-------------|---------|--------|
| YouTube AdSense      | $XXX       | $XXX        | ▲ +X%  | XX%    |
| Newsletter (MRR)     | $XXX       | $XXX        | → 0%   | XX%    |
| Newsletter (Sponsor) | $XXX       | $0          | —      | XX%    |
| Gumroad — [Product A]| $XXX       | $XXX        | ▼ -X%  | XX%    |
| Gumroad — [Product B]| $XXX       | $XXX        | ▲ +X%  | XX%    |
| **Total**            | **$X,XXX** | **$X,XXX**  | **±X%**| 100%   |

**Top Channel:** {channel name} (XX% of total)
**RPM (YouTube):** $X.XX (prior: $X.XX)

## Flags
🟡 [Channel] declined {X}% MoM — {seasonal/anomalous} — investigate or monitor
```

## Configuration

Required file fields in each monthly analytics file:
- YouTube: `adsense_earnings`, `views`, `rpm`
- Newsletter: `sponsorship_revenue`, `subscription_mrr`, `paid_subscribers`
- Gumroad: `product_name`, `units_sold`, `gross_revenue`, `refunds`, `net_revenue` per product

## Error Handling

- If a channel's current month file is missing: include the channel in the table with "$0" and note "No data — add analytics file to vault/content/{subfolder}/."
- If prior month file is missing for a channel: populate MoM column with "N/A" for that channel.
- If a Gumroad product has a refund rate >10%: flag it separately as "refund rate elevated — check product description alignment with customer expectations."

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/content/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/content/00_current/`, `~/Documents/aireadylife/vault/content/00_current/`, `~/Documents/aireadylife/vault/content/00_current/`
- Writes to: returns data to calling op; no direct file writes
