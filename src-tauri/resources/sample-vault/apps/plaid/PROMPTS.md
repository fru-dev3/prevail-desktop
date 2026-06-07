# Plaid — Prompt Reference

## Daily

1. **Balance Pulse:** "Pull current balances from every Plaid-linked
   institution. Compare to the last balance snapshot in
   vault/wealth/state.md. Flag any account that moved more than $500 since
   yesterday. Output a one-screen balance table."

## Weekly

2. **Transaction Categorization Check:** "Pull this week's transactions
   from /transactions/get across all 4 items. Identify any transaction
   over $100 that is uncategorized or that Plaid mis-categorized. Suggest
   a category for each."

## Monthly

3. **Monthly Sync to Wealth:** "Pull last month's transactions and ending
   balances from Plaid. Update vault/wealth/01_prior/<YYYY-MM>.md with
   the canonical totals per account. Add anything material to
   wealth/open-loops.md."

4. **Recurring Detection Audit:** "Run /transactions/recurring/get for all
   items. Cross-reference with vault/wealth/state.md subscription list.
   Flag missing entries, dead entries, and apparent duplicates."

## Tax-time

5. **Schedule C Export:** "Filter Mercury LLC transactions for the tax
   year. Bucket into Schedule C line items. Export to
   vault/tax/00_current/schedule-c-<year>.csv with category, date, amount,
   description."
