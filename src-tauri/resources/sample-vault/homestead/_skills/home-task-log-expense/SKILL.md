---
name: aireadylife-home-task-log-expense
type: task
cadence: as-received
description: >
  Records a home expense to vault/home/00_current/ with date, category (utilities/repairs/
  supplies/services), subcategory, vendor, amount, notes, and receipt reference. Category
  tagging feeds directly into monthly budget variance calculations.
---

# aireadylife-home-log-expense

**Cadence:** As-received (when a bill is paid, a repair is completed, or a service is rendered)
**Produces:** New expense record in `~/Documents/aireadylife/vault/home/00_current/YYYY-MM-expenses.md`

## What It Does

This task creates a structured expense record each time a home-related payment is made. Its purpose is to ensure the monthly expense review has complete, categorized data for every dollar spent on the home — preventing the end-of-month scramble to reconstruct spending from bank statements, and ensuring the budget tracking is always current.

Expenses are tagged to one of four categories, each with subcategories for additional granularity:

**Utilities:** Electric, gas, water/sewer, internet, cable (when home-bundled). These are the baseline monthly home operating costs. Logging them consistently enables the year-over-year utility trend analysis that catches rate increases before they become invisible line items in the monthly budget.

**Repairs:** Any contractor or parts expense for restoring a home system or component to working condition. Subcategories: HVAC, plumbing, electrical, appliances, roofing, structural, other. The subcategory tagging enables the repair-per-system accumulation tracking that signals approaching replacement thresholds.

**Supplies:** Consumables for the home — cleaning products, HVAC filters, light bulbs, hardware store purchases for DIY projects, garden supplies. These are typically small but accumulate meaningfully across a year.

**Services:** Recurring or one-time service provider payments — lawn mowing, snow removal, house cleaning, pest control, gutter cleaning, chimney sweeping, window washing, pool service, HOA fees (if applicable). Services differ from repairs in that they maintain condition rather than restore function.

Each record also captures: date paid, vendor or payee name, amount, a brief note describing what was purchased or repaired, and a receipt reference (invoice number, vendor confirmation, or file path to a scanned receipt). The receipt reference field is particularly useful for warranty claims — knowing the exact purchase date and having the receipt reference enables warranty lookups without digging through email.

For expenses above $1,000, the task automatically asks if this is a home improvement project (capital expenditure) that may increase the home's cost basis. Home improvements that increase the cost basis reduce capital gains taxes when the home is eventually sold — for homeowners who may benefit from the $250,000/$500,000 Section 121 exclusion, home improvements above the exclusion limit can reduce taxable gain. The task prompts the user to consider logging large home improvements separately for tax basis tracking purposes.

## Steps

1. Collect: date, expense category and subcategory, vendor name, amount, brief description
2. Collect receipt reference (invoice number, file path, or "no receipt")
3. If amount > $1,000: ask if this is a home improvement; note capital basis tracking opportunity
4. Append structured expense record to `~/Documents/aireadylife/vault/home/00_current/YYYY-MM-expenses.md`
5. If the expense is linked to an open maintenance item: note the connection in the record
6. Confirm record saved; note it will appear in the next monthly expense review

## Input

User provides: date, description, vendor, amount, category
Optional: subcategory, receipt reference, related maintenance item

## Output Format

```markdown
## Expense: YYYY-MM-DD — {Vendor}
- **Category:** {utilities / repairs / supplies / services}
- **Subcategory:** {e.g., HVAC, plumbing, electric, lawn}
- **Vendor:** {vendor name}
- **Amount:** $X.XX
- **Receipt Ref:** {invoice # or "no receipt"}
- **Note:** {brief description}
- **Related Item:** {maintenance item slug if applicable}
- **Capital Basis Note:** {if applicable}
```

## Configuration

No additional configuration required beyond vault existing. Category choices are standardized and do not require config.md customization.

## Error Handling

- If category is ambiguous: present options and ask user to select; do not guess
- If date not provided: use today's date with a "(date assumed)" note
- If amount not provided: do not save; amount is required for budget tracking to work
- If month's expense file does not exist yet: create it with the first entry

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/home/00_current/` (to check for related open items)
- Writes to: `~/Documents/aireadylife/vault/home/00_current/YYYY-MM-expenses.md`
