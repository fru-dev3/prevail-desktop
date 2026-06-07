---
name: aireadylife-content-task-log-revenue
type: task
cadence: as-received
description: >
  Records a revenue event to vault/content/ with: platform, amount, date, type
  (AdSense, sponsorship, product sale, subscription). Builds the historical record
  used by monthly revenue reviews.
---

## What It Does

Records individual revenue events to the vault so `aireadylife-content-flow-build-revenue-summary` has clean, structured data to aggregate from. The log is the single source of truth for all content revenue — if it is not logged here, it will not appear in monthly revenue reviews, YTD calculations, or revenue trend analysis.

Each log entry captures: the platform (YouTube AdSense, newsletter platform, Gumroad, direct, other), the revenue amount and currency, the date earned or paid, the revenue type (AdSense CPM payout, direct sponsorship fee, digital product sale, paid subscription renewal, tip/donation, affiliate commission), the product name or campaign name when relevant (for Gumroad product-level tracking and sponsorship source tracking), and optional notes.

Revenue entry cadences differ by type: AdSense payments arrive monthly in arrears (typically around the 21st of the month for the prior month's earnings) and are logged as a single monthly batch entry. Gumroad product sales can be logged as individual transactions when they occur or as a monthly batch from the dashboard export. Newsletter sponsorship fees are logged when the payment is received, not when the campaign runs. Paid subscription MRR is logged monthly when the platform reports the figure.

Writes to the platform-specific subfolder using a consistent filename convention so monthly revenue reviews can find and aggregate files automatically. Returns the file path and a confirmation to the calling op or user.

## Triggers

- "log revenue"
- "record my YouTube earnings"
- "I got paid from Gumroad"
- "newsletter sponsorship received"
- "log a product sale"
- Called by `aireadylife-content-op-revenue-review` after each monthly review cycle

## Steps

1. Identify the revenue event: ask for platform, amount, date, and type if not provided
2. Validate: amount must be a positive number; platform must be a recognized value; date must be parseable
3. Determine the target subfolder: YouTube = 00_youtube/, newsletter = 01_newsletter/, Gumroad = 02_gumroad/
4. Determine file type: monthly batch (if this covers a full month's earnings from one platform) or individual transaction
5. For monthly batch: check if a revenue file already exists for this platform and month; if yes, ask whether to append or replace
6. For individual transaction: generate a unique filename with date and type
7. Write the structured revenue record with all fields
8. Return file path and confirmation

## Input

User-provided or calling-op-provided:
- Platform (required): YouTube, newsletter, Gumroad, direct, other
- Amount (required): positive dollar value
- Date (required): date of payment or transaction
- Revenue type (required): AdSense, sponsorship, product-sale, subscription-mrr, affiliate, tip
- Product or campaign name (recommended for Gumroad and sponsorship entries)
- Notes (optional)

## Output Format

Monthly batch file at `~/Documents/aireadylife/vault/content/{subfolder}/{YYYY-MM}-{platform}-revenue.md`:
```
# Revenue Record — {Platform} | {Month} {Year}

platform: {platform}
period: {YYYY-MM}
revenue_type: {type}
amount: ${X,XXX.XX}
currency: USD
date_paid: {YYYY-MM-DD}
product_name: {name or "N/A"}
campaign_name: {name or "N/A"}
notes: {optional}
```

Individual transaction file at `~/Documents/aireadylife/vault/content/{subfolder}/{YYYY-MM-DD}-{platform}-{type}.md`:
Same fields with single-transaction data.

## Configuration

Optional in `~/Documents/aireadylife/vault/content/config.md`:
- `revenue_platforms` — recognized platform names (prevents typos in log files)
- `gumroad_products` — list of product names for consistent product-level tracking

## Error Handling

- If amount is zero or negative: "Revenue amount must be positive. Is this a refund? Log refunds as a negative amount with type 'refund'."
- If platform is unrecognized: ask "Which platform is this from? Recognized platforms: YouTube, newsletter, Gumroad, direct, other."
- If a monthly batch file already exists for the same platform and month: "A revenue record for {platform} in {month} already exists. Update the existing record, or log this as a separate transaction?"

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/content/config.md`, target subfolder for duplicate check
- Writes to: `~/Documents/aireadylife/vault/content/00_current/` or `01_newsletter/` or `02_gumroad/` depending on platform
