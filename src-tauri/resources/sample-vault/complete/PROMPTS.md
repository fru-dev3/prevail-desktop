# AI Ready Life: Complete — Prompt Reference

All 20 domains. See each domain's individual PROMPTS.md for the full prompt set.
This file covers the highest-value prompts per domain and cross-domain workflows.

---

## Chief (Start Here)

**Daily Life Brief:** "Run my daily brief. Read the current state from all active vaults under vault/ and produce a prioritized brief: top 3 items that need action today, open loops by domain, upcoming deadlines in the next 7 days, and any anomalies flagged since the last brief."

**Weekly Life Review:** "Run my weekly life review across all domains. For each active domain, give a one-paragraph status and the top action item. Highlight any cross-domain dependencies — e.g., a tax deadline that affects wealth, or a career event that affects calendar."

**System Health Check:** "Check the health of my AI Ready Life setup. For each installed domain, confirm config.md is filled in, vault folders exist, and the most recent brief is less than 30 days old. Flag any domain that is stale or misconfigured."

---

## Health

**Health Brief:** "Give me a health brief using vault/health/00_current/. Cover: lab status, medication refills due, upcoming preventive care, and top 2 action items."

**Lab Summary:** "Review my latest lab results in vault/health/00_current/. Classify each biomarker as Normal, Borderline, or Critical. Output a table: Biomarker | Result | Reference Range | Status | Trend."

**Medication Refill Audit:** "List all medications in vault/health/00_current/ with refill due dates. Flag any due within 7 days."

---

## Wealth

**Net Worth Snapshot:** "Build my current net worth using vault/wealth/00_current/. Total assets, total liabilities, net worth. Compare to prior period if available in vault/wealth/01_prior/."

**Monthly Cash Flow:** "Review my monthly cash flow using vault/wealth/00_current/. Summarize income, expenses by category, and net. Flag any category over budget."

**Investment Review:** "Review my investment portfolio in vault/wealth/00_current/. Show balance, return since last review, and flag any position that moved more than 10%."

---

## Tax

**Document Check:** "Check my tax document status in vault/tax/00_current/. List expected documents, mark each received or missing, flag anything overdue."

**Quarterly Estimate:** "Compute my quarterly estimated tax using vault/tax/00_current/. Show YTD income, tax owed, withholding paid, and whether a payment is due."

**Deadline Watch:** "List all upcoming tax deadlines from vault/tax/00_current/. Flag anything within 30 days."

---

## Career

**Career Brief:** "Give me a career brief using vault/career/00_current/. Cover: current role status, active pipeline, comp vs. market, and 3 priority actions."

**Pipeline Review:** "Review my job search pipeline in vault/career/00_current/. List applications by status. Flag any with no activity in 14 days."

---

## Benefits

**Benefits Brief:** "Summarize my current employer benefits using vault/benefits/00_current/. Cover: 401k contribution rate and match, HSA balance and contribution pace, and any open enrollment deadlines."

**401k Review:** "Review my 401k allocation in vault/benefits/00_current/. Show contribution rate, employer match, and whether I'm on track to hit the annual IRS limit."

---

## Brand

**Brand Brief:** "Give me a brand health brief using vault/brand/00_current/. Cover: follower trends, engagement rate by platform, content cadence vs. targets, and top 3 action items."

**Analytics Summary:** "Build my monthly brand analytics summary from vault/brand/00_current/. Compute engagement rate, MoM growth, and flag any platform where cadence missed target."

---

## Business

**P&L Review:** "Review my business P&L using vault/business/00_current/. Show revenue, expenses, and net profit for the current period. Compare to prior period if available in vault/business/01_prior/."

**Compliance Check:** "Check my business compliance status in vault/business/00_current/. List all filings, licenses, and deadlines. Flag anything due within 60 days."

---

## Calendar

**Weekly Agenda:** "Build my weekly agenda using vault/calendar/00_current/. List all deadlines and commitments for the next 7 days, ranked by urgency. Flag any scheduling conflicts."

**Deadline Alert:** "Scan vault/calendar/00_current/ for deadlines approaching within 14 days. Flag any that require prep more than 1 day in advance."

---

## Content

**Content Pipeline Review:** "Review my content pipeline in vault/content/00_current/. Show what's in progress, what's scheduled, and what's overdue. Flag any gap in publishing cadence."

**Revenue Summary:** "Summarize my content revenue using vault/content/00_current/. Break down by channel. Compare to prior period if available."

---

## Estate

**Portfolio Review:** "Review my rental property portfolio using vault/estate/00_current/. Show each property's rent, expenses, and net cash flow. Flag any maintenance items open more than 30 days."

**Cash Flow Analysis:** "Analyze my estate cash flow from vault/estate/00_current/. Show gross rent, operating expenses, NOI, and cash-on-cash return per property."

---

## Explore

**Travel Brief:** "Give me a travel brief using vault/explore/00_current/. List upcoming trips, document expiry dates within 6 months, and any open logistics items."

**Document Check:** "Check all travel documents in vault/explore/00_current/. Flag any passport, visa, or ID expiring within 6 months."

---

## Home

**Monthly Home Review:** "Review my home status using vault/home/00_current/. Cover: open maintenance items, YTD home expenses vs. budget, and seasonal tasks due this month."

**Maintenance Schedule:** "Build a home maintenance schedule from vault/home/00_current/. List all open items by priority and any seasonal tasks due in the next 60 days."

---

## Insurance

**Coverage Audit:** "Audit my insurance coverage using vault/insurance/00_current/. List all active policies with coverage amounts, premiums, and renewal dates. Flag any renewal within 60 days."

**Claims Review:** "Review open insurance claims in vault/insurance/00_current/. Flag any claim with no activity in the past 14 days."

---

## Intel

**Daily Briefing:** "Run my daily intel briefing using vault/intel/00_current/. Scan tracked sources for new developments on my watch topics. Summarize the top 5 items with source and relevance."

**Topic Deep Dive:** "Research [topic] using vault/intel/00_current/ as context. Summarize what I already know, what's new, and what I should read next."

---

## Learning

**Learning Progress Review:** "Review my learning progress using vault/learning/00_current/. Show active courses and books, completion percentage, and time invested. Flag any item with no progress in 14 days."

**Reading Summary:** "Summarize my recent reading from vault/learning/00_current/. List books completed in the past 90 days with key takeaways. Recommend next read based on my active goals."

---

## Real Estate

**Market Scan:** "Scan the real estate market using vault/real-estate/00_current/. Summarize current market conditions for my target area. Flag any listing that meets my criteria."

**Buy vs. Rent Analysis:** "Run a buy vs. rent analysis using vault/real-estate/00_current/. Show the break-even point in years, monthly cost comparison, and recommendation given current market data."

---

## Records

**Document Audit:** "Audit my personal records in vault/records/00_current/. List all identity and legal documents with expiry dates. Flag anything expiring within 6 months."

**Subscription Review:** "Review all active subscriptions in vault/records/00_current/. List each with monthly cost, renewal date, and last-used date. Flag any unused subscription for cancellation."

---

## Social

**Relationship Health Check:** "Review my relationship health using vault/social/00_current/. Identify contacts I haven't reached out to in 90+ days. Flag birthdays and key dates in the next 30 days."

**Outreach Queue:** "Build my outreach queue from vault/social/00_current/. List contacts that are overdue for follow-up, ranked by relationship strength and time since last contact."

---

## Vision

**Quarterly Planning:** "Run my quarterly planning session using vault/vision/00_current/. Review progress on current OKRs, score each key result, and draft objectives for next quarter."

**Annual Review:** "Run my annual life review using vault/vision/00_current/ and vault/vision/01_prior/. Score the year against goals set 12 months ago. Identify top wins, biggest misses, and carry-forward priorities."
