---
id: medication-and-refill-tracker
runner: llm
trigger: on-demand
description: Keep medications and supplements current: what's active, refills due, and interactions to flag.
source: seed
---
# Medication and refill tracker

Run monthly, and before any new prescription starts.

1. **The active list.** From data/medications.csv, list every current medication and supplement with dose, frequency, and the reason it's taken. Drop anything discontinued so the list stays true.
2. **Refills due.** For each, estimate days of supply remaining and flag any that need a refill or a renewal appointment in the next two weeks, so none lapses.
3. **Interactions and timing.** Note any combinations worth raising with the doctor or pharmacist, and any timing rules (with food, away from other doses) that are easy to slip on.
4. **Adherence honestly.** Mark which are taken as prescribed and which slip, since a med not taken can't work — and that's worth saying out loud at the next visit.

Output: the current med list with doses, the refills due in the next two weeks, and any interaction or timing flags.
