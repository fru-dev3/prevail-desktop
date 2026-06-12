---
id: packing-and-docs-check
runner: llm
trigger: on-demand
description: T-minus-3-days check: documents, money, health, and the pack list that fits the actual trip.
source: seed
---

# Packing and docs check

Run three days before departure (trips in data/trips.csv).

1. **Documents.** Passport validity (6 months past return for many countries),
   visas or entry forms, tickets, insurance, and offline copies of all four.
2. **Money.** Cards that work at the destination, one backup, a small cash
   amount, and the bank travel notice if needed.
3. **Health.** Prescriptions in original packaging for the full trip plus
   three days, any destination-specific items, and the insurance emergency
   number saved offline.
4. **Pack to the weather.** Check the actual forecast, then pack for the real
   trip: every item earns its place or stays home.

Output: the four checklists with anything missing flagged in the first line.
