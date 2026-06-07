---
name: aireadylife-estate-task-log-expense
type: task
cadence: as-received
description: >
  Records a rental property expense to vault/estate/00_current/ with property address,
  date, vendor, IRS-standard expense category, amount, notes, and receipt reference.
  CapEx vs. maintenance classification is flagged automatically for amounts above $2,500.
---

# aireadylife-estate-log-expense

**Cadence:** As-received (logged at the time the expense is incurred or the bill is paid)
**Produces:** Expense record appended to `~/Documents/aireadylife/vault/estate/00_current/{property-slug}-expenses.md`

## What It Does

This task creates a structured expense record for every rental property cost, ensuring the cash flow analysis always has accurate, real-time data and that the tax year-end Schedule E reporting has a complete, categorized expense history ready to hand to a CPA.

Each expense is classified using IRS Schedule E standard categories, which matters because the classification determines the tax treatment. Categories used:

- **Advertising:** listing fees, vacancy marketing costs
- **Auto and travel:** mileage to property for management or maintenance visits (deductible at IRS standard mileage rate — 67 cents/mile in 2024)
- **Cleaning and maintenance:** cleaning between tenants, routine maintenance and minor repairs (< $2,500 threshold)
- **Insurance:** property and liability insurance premium payments
- **Legal and professional:** attorney fees, property management company fees, CPA fees
- **Management fees:** if using a property management company, this is the management fee (typically 8–12% of collected gross rent)
- **Mortgage interest:** interest portion of mortgage payments (principal is not an expense — it is equity)
- **Repairs:** repairs to existing property elements that restore function without extending useful life
- **Supplies:** consumables purchased for the property (light bulbs, HVAC filters, cleaning supplies)
- **Taxes:** property tax payments
- **Utilities:** utilities paid by the landlord (water, gas, electric, trash — for multi-family or when included in rent)
- **Depreciation:** tracked separately via the portfolio review; not logged via this task
- **Capital improvement:** any improvement that extends the useful life or adds value beyond the original condition — must be depreciated, not expensed. Examples: new roof, HVAC replacement, addition, kitchen remodel. Logged here with a CapEx classification flag.

The critical tax distinction between repairs and capital improvements: a repair restores a property element to its original working condition (replace a broken window pane = repair; replace all windows = capital improvement). A capital improvement adds value or extends life and must be depreciated over its useful life (roof: 27.5 years; HVAC: 15 years; appliance: 5–7 years). Any single item above $2,500 (the IRS safe harbor threshold for small businesses) automatically triggers a classification flag recommending the user confirm CapEx vs. repair treatment with their tax professional.

Expenses are appended to a property-specific file (`{property-slug}-expenses.md`) rather than a single flat file, which keeps per-property filtering fast for the cash flow analysis and makes it easy to pull one property's full expense history when needed.

## Steps

1. Collect: property address (or slug), expense date, vendor/payee name, amount, any notes
2. Assign IRS-standard expense category based on nature of expense
3. If amount ≥ $2,500: flag as "CapEx classification review recommended"; add note to record
4. Check if expense relates to an open maintenance item in `~/Documents/aireadylife/vault/estate/00_current/`; if so, cross-reference the maintenance item ID in the expense record
5. Record receipt reference (invoice number, vendor confirmation #, or file path to scanned receipt)
6. Append structured expense record to `~/Documents/aireadylife/vault/estate/00_current/{property-slug}-expenses.md`
7. Confirm record saved; note it will be picked up by the next cash flow review run

## Input

User provides: property address, date, vendor, amount, description
Optional: receipt reference or file path, related maintenance item ID

## Output Format

```markdown
## Expense: YYYY-MM-DD — {Vendor}
**Property:** {property-slug}
**Date:** YYYY-MM-DD
**Vendor/Payee:** {vendor name}
**Category:** {IRS category}
**Amount:** $X.XX
**Receipt Ref:** {invoice # or file path}
**Maintenance Item:** {item ID if applicable}
**Notes:** {description of work or purchase}
**CapEx Flag:** {YES — review classification with tax professional / NO}
```

## Configuration

Required in `~/Documents/aireadylife/vault/estate/config.md`:
- Property slugs that map to each full address (used for file routing)

## Error Handling

- If property address is not recognized: prompt user to confirm which property; do not guess
- If category is ambiguous (e.g., new carpet — repair or improvement?): present both options and note the IRS guideline (new carpet throughout a rental = 5-year depreciable improvement; patch repair of damaged carpet = deductible repair)
- If amount is missing: do not save; prompt user for amount

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/estate/00_current/` (to cross-reference open maintenance items)
- Writes to: `~/Documents/aireadylife/vault/estate/00_current/{property-slug}-expenses.md`
