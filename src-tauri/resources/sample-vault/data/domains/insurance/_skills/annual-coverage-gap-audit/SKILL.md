---
id: annual-coverage-gap-audit
runner: llm
trigger: on-demand
description: Once-a-year sweep for uncovered liability and protection gaps across home, auto, life, and umbrella.
source: seed
---

# Annual coverage-gap audit

Run yearly, or after any major life or asset change.

1. **List the assets and liabilities.** Home, vehicles, income, dependents, net worth (cross-check the wealth domain). The bigger these are, the more downside a gap creates.
2. **Check liability ceilings.** Compare the auto and homeowners liability limits in data/policies.csv against net worth. When assets outgrow those limits, a $1M umbrella policy (typically $150–300/yr) is usually the highest-leverage gap to close.
3. **Life & disability.** Confirm term-life coverage and beneficiaries match current dependents and obligations. Check disability coverage for the primary earners.
4. **Beneficiary hygiene.** Verify every policy and account beneficiary is current after marriages, births, or moves.
5. **Right-size, don't over-buy.** Flag both gaps and any redundant or over-priced coverage worth trimming.

Output: the prioritized list of gaps to close, with rough annual cost each.
