---
name: appfolio
type: app
description: >
  Downloads owner statements, lease documents, maintenance requests, and tenant ledgers from an
  AppFolio owner portal via Playwright. Used by estate-agent for cash flow review and tenant
  management when a property management company uses AppFolio. Configure portal URL in vault/estate/config.md.
---

# AppFolio

**Auth:** Playwright + Chrome cookies (headless=False required — owner portal uses session cookies)
**URL:** Configured per property management company (format: `https://YOURCOMPANY.appfolio.com/ownerweb`)
**Configuration:** Set owner portal URL and Chrome profile in `~/Documents/aireadylife/vault/estate/config.md`

## Data Available

- **Monthly owner statements (PDF):** The primary financial document showing rent collected, management fees, maintenance charges, and net distribution to owner for the month. Contains the same data as a Stessa cash flow report but sourced directly from the property manager.
- **Rental income and expense breakdown per property:** Line-item detail within owner statements — can be parsed to feed into the estate cash flow analysis.
- **Lease documents:** Current signed leases (PDF), move-in reports, move-out inspection reports with photos.
- **Maintenance requests:** Open, in-progress, and completed maintenance items with vendor notes, cost, and completion date. This is the most valuable data source for the maintenance review op.
- **Tenant ledger and payment history:** Every payment made by each tenant — rent, late fees, deposits — with dates. Source of truth for the tenant payment review.
- **1099 forms:** Year-end 1099-MISC or 1099-NEC issued to vendors for maintenance work (useful for your own tax filing coordination).

## Configuration

Add to `~/Documents/aireadylife/vault/estate/config.md`:
```
appfolio_portal_url: https://YOURCOMPANY.appfolio.com/ownerweb
appfolio_chrome_profile: /Users/YOU/Library/Application Support/Google/Chrome/Default
```

## Key Data Workflows

**Monthly owner statement pull:** Log in to owner portal → Statements → select property and month → Download PDF → Parse for rent collected, management fee, maintenance charges, and net distribution. Use to verify or supplement manually logged expense data in the vault.

**Maintenance request download:** Owner portal → Maintenance → filter by property → export or read open work orders. This feeds directly into the estate maintenance review — vendor name, quoted cost, status, and completion date are all available here if the property manager uses AppFolio for work order tracking.

**Tenant payment history:** Owner portal → Tenants → select tenant → Ledger → shows all transactions. Compare against scheduled rent to identify late payments and patterns. This is the authoritative record for tenant payment history.

## Notes

- Requires headless=False — AppFolio owner portals use modern authentication that breaks headless Chrome sessions
- Portal URL is specific to each property management company's AppFolio account — get it from your property manager
- If owner portal is not available, request owner statements by email from property manager and log data manually
- AppFolio is used by mid-to-large property management companies; smaller companies may use Buildium, Rent Manager, or manual email statements

## Used By

- `aireadylife-estate-cash-flow-review` — download and parse monthly owner statements; cross-reference with logged expenses
- `aireadylife-estate-tenant-review` — check tenant payment history and current lease status
- `aireadylife-estate-maintenance-review` — pull open work orders from AppFolio to compare against vault maintenance records

## Vault Output

`~/Documents/aireadylife/vault/estate/00_current/` (cash flow data)
`~/Documents/aireadylife/vault/estate/00_current/` (work order data)
`~/Documents/aireadylife/vault/estate/00_current/` (payment history data)
