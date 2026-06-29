---
id: policy-renewal-review
runner: llm
trigger: on-demand
description: Before auto-renewing any policy, coverage still right, price still fair, loyalty-tax check.
source: seed
---

# Policy renewal review

Run when any renewal notice arrives (policies in data/policies.csv).

1. **Life delta.** What changed since last term: assets, income, household, risks? Coverage follows life, not habit.
2. **Loyalty tax.** Get two comparable quotes. Renewal premiums quietly drift upward on the assumption nobody checks.
3. **Deductible math.** Could the emergency fund absorb a higher deductible? Price the premium saved against the extra exposure.
4. **Gaps and overlaps.** Anything double-covered, anything newly uncovered (see the umbrella-policy thread for the worked example).

Output: renew / renegotiate / switch, with the numbers that justify it.
