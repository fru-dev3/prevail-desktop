---
id: policy-inventory
runner: llm
trigger: on-demand
description: Build one clean table of every policy, carrier, coverage, limits, deductible, premium, renewal date.
source: seed
---

# Policy inventory

Run once to establish the baseline, then refresh whenever a policy changes.

1. **Gather every policy.** Pull from data/policies.csv and any declaration pages or carrier emails in the vault. One row per policy: type, carrier, policy number, what it covers.
2. **Capture the numbers that matter.** Coverage limit, deductible, annual premium, and renewal date for each. These four decide every later question.
3. **Flag the blanks.** Mark any missing declaration page, unconfirmed beneficiary, or unknown renewal date as a follow-up, an inventory with holes hides risk.
4. **Sort by renewal date.** So the next decision is always the closest one.

Output: the complete policy table written back to data/policies.csv, with blanks flagged in the first line.
