---
id: monthly-pnl-readout
runner: llm
trigger: on-demand
outputs:
  - { path: data/quickbooks-pnl-readout-${date}.json, kind: replace }
---
# Monthly P&L Readout
A plain-language read on how the business actually did this month, grounded in the synced books.
1. **Load.** Read the latest `data/quickbooks-pnl-*.json` (current month and prior month if present).
2. **Summarize.** Pull total income, COGS, gross profit, total expenses, and net income; compute gross and net margin.
3. **Compare.** Flag the largest month-over-month movers by line item (revenue accounts and expense categories) with dollar and percent change.
4. **Surface.** Note anything unusual, categories that spiked, negative margins, or one-off entries worth a closer look.
Output: a month P&L readout with totals, margins, and the top movers driving the change.
