---
id: refresh-books
runner: llm
trigger: refresh
outputs:
  - { path: data/quickbooks-pnl-${date}.json, kind: replace }
  - { path: data/quickbooks-balance-sheet-${date}.json, kind: replace }
  - { path: data/quickbooks-ar-aging-${date}.json, kind: replace }
  - { path: data/quickbooks-invoices-${date}.json, kind: replace }
---
# Refresh QuickBooks Books
Pull the core financial reports so the books behind your work are already in order when it's time to plan or file. Read-only.
1. **Authenticate.** Use the connected Intuit QuickBooks OAuth token and resolve the active `realmId` (company) via `company_info` / `qbo_payroll_get_company_info`.
2. **Pull reports.** Call `profit_loss_generator` (current month + YTD), `qbo_accounting_get_balance_sheet`, and `cash_flow_generator` for the period.
3. **Pull receivables.** Call `qbo_accounting_get_ar_aging_summary` and `qbo_accounting_get_ar_aging_detail`, plus `qbo_sales_get_invoices` (open invoices with due dates).
4. **Save raw.** Write each report as-is to its `data/quickbooks-*-${date}.json` file. Never create, send, update, or delete invoices, estimates, or payments.
Output: a dated snapshot of P&L, balance sheet, cash flow, AR aging, and open invoices.
