---
id: contractor-quote-compare
runner: llm
trigger: on-demand
description: Normalize competing contractor quotes so the comparison is real: scope, exclusions, lifetime cost.
source: seed
---

# Contractor quote compare

Run when two or more quotes are in hand for the same job.

1. **Normalize scope.** Line up what each quote actually includes: equipment tier, labor, permits, haul-away, warranty years. Mark every exclusion.
2. **Lifetime cost.** Price plus expected energy/maintenance over 10 years beats sticker price (the HVAC thread is the worked example).
3. **Risk read.** Licensed, insured, lead time, payment schedule. A quote that wants most of the money upfront is a different product.
4. **Negotiation move.** One concrete ask per finalist (price match, warranty extension, scope add) before signing.

Output: the normalized table, lifetime cost ranking, and the chosen ask.
