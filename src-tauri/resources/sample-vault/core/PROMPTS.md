# AI Ready Life: Core — Prompt Reference

Essential prompts across all four Core domains: Health, Wealth, Tax, and Career.

---

## Health

**Weekly Health Review:** "Run my weekly health review. Read vault/health/00_current/ for any new lab results or visit notes from the past 7 days. Flag any biomarkers outside reference ranges. Check open-loops.md for unresolved items. List medication refills due within 7 days. Output a brief with flagged labs, upcoming appointments, and 3 prioritized action items."

**Monthly Health Review:** "Run my monthly health review. Aggregate all data in vault/health/00_current/ for the past 30 days. Review lab trends, visit outcomes, and medication adherence. Summarize: biomarker status, completed and pending preventive care, and 5 action items for next month."

**Lab Summary:** "Review my latest lab results in vault/health/00_current/. For each biomarker, classify as Normal, Borderline, or Critical using standard reference ranges. Output a table: Biomarker | Result | Reference Range | Status | Trend vs. Last Result."

**Medication Refill Audit:** "Read vault/health/00_current/ and identify every prescription with its days-supply and refill due date. Flag any 90-day Rx whose refill window opens within 7 days and any 30-day Rx due within 3 days. Output a sorted table: Medication | Dose | Days Supply | Refill Due | Status."

**Preventive Care Gap:** "Audit my preventive care status against age-appropriate guidelines using vault/health/00_current/. Flag anything overdue by more than 3 months. Output: Screening | Last Date | Due Date | Status."

---

## Wealth

**Net Worth Snapshot:** "Build my current net worth snapshot using vault/wealth/00_current/. List all assets with current balances and all liabilities with outstanding balances. Calculate total assets, total liabilities, and net worth. Compare to prior period if data is available in vault/wealth/01_prior/."

**Monthly Cash Flow Review:** "Review my monthly cash flow using vault/wealth/00_current/. Summarize total income, total expenses by category, and net cash flow. Flag any category where spending exceeds budget. Compare to the prior month if available."

**Investment Performance Review:** "Analyze my investment portfolio in vault/wealth/00_current/. For each account, show current balance, cost basis (if available), and return since last review. Flag any position that has moved more than 10% since last review."

**Debt Paydown Status:** "Review all debt entries in vault/wealth/00_current/. For each liability, show outstanding balance, interest rate, minimum payment, and estimated payoff date at current payment rate. Rank by interest rate and flag the highest-cost debt for accelerated paydown."

---

## Tax

**Document Completeness Check:** "Check my tax document status in vault/tax/00_current/. List all expected documents for this tax year (W-2s, 1099s, K-1s, mortgage interest, charitable contributions, HSA contributions). Mark each as received or missing. Flag anything missing that is typically due by now."

**Quarterly Estimate Review:** "Review my quarterly estimated tax situation using vault/tax/00_current/. Compute YTD income, apply estimated effective tax rate, subtract withholding paid, and determine if a quarterly payment is due. Flag if underpayment penalties may apply."

**Deduction Review:** "Scan vault/tax/00_current/ for logged deductible expenses. Group by category: home office, health, business, charitable, education, investment. Compute the running total for the year and flag any category approaching a significant threshold."

**Tax Deadline Watch:** "List all upcoming tax deadlines in vault/tax/00_current/. Flag any deadline within 30 days. Include federal, state, and entity-level deadlines. Note the action required for each."

---

## Career

**Pipeline Review:** "Review my job search pipeline in vault/career/00_current/. List all active applications by status: Applied, Screening, Interview, Offer, Closed. Flag any application with no activity in the past 14 days. Suggest next actions for each active opportunity."

**Compensation Review:** "Analyze my current compensation using vault/career/00_current/. Show base salary, bonus target, equity vesting schedule, and total compensation. Compare to market data in vault/career/00_current/ if available. Flag any gap versus the 75th percentile for my role and location."

**Skills Gap Analysis:** "Review my skills inventory in vault/career/00_current/. Compare current skill levels to target role requirements if defined. Identify the top 3 skills to develop in the next 90 days and recommend a learning path for each."

**Career Brief:** "Give me a career brief using vault/career/00_current/. Cover: current role status, active pipeline, compensation vs. market, top skills to develop, and 3 priority actions for the next 30 days."

---

## Cross-Domain

**Life Brief:** "Give me a life brief covering all four core domains. Read the most recent briefs or current state from vault/health/00_current/, vault/wealth/00_current/, vault/tax/00_current/, and vault/career/00_current/. For each domain, give a one-paragraph status and top 2 action items. End with 3 cross-domain priorities ranked by urgency."
