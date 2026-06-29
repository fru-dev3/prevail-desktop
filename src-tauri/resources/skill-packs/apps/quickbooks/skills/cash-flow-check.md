---
id: cash-flow-check
runner: llm
trigger: on-demand
outputs:
  - { path: data/quickbooks-cash-flow-check-${date}.json, kind: replace }
---
# Cash Flow Check
Where the cash actually went, so runway and timing aren't a surprise.
1. **Load.** Read the latest `data/quickbooks-balance-sheet-*.json` and any synced cash-flow report, plus `data/quickbooks-invoices-*.json`.
2. **Net position.** Total cash across bank accounts and compare against the prior snapshot to get net cash change.
3. **Inflows vs outflows.** Break the period into operating inflows (collected revenue) and outflows (expenses, payroll, liabilities paid).
4. **Runway.** Estimate months of runway at the current burn, and flag upcoming obligations (AP, recurring expenses) against expected AR collection.
Output: a cash-flow check with net cash change, burn estimate, runway, and timing risks.
