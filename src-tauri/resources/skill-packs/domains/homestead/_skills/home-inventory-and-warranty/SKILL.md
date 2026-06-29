---
id: home-inventory-and-warranty
runner: llm
trigger: on-demand
description: Keep a current record of major appliances and systems: age, warranty status, and what's nearing the cliff.
source: seed
---

# Home inventory and warranty

Run twice a year, or after any major purchase or repair.

1. **Catalog the big stuff.** From data/maintenance-log.csv and receipts, list the major appliances and systems (HVAC, water heater, roof, appliances) with purchase date, model, and cost.
2. **Warranty status.** For each, record warranty end date and what it covers. Flag anything expiring in the next six months while action is still cheap.
3. **Aging cliff.** Mark items past two-thirds of expected life. These belong on the watch list before they fail, not after, budget the replacement now.
4. **Records check.** Note where the proof lives (receipt, serial, manual). A warranty you can't document is a warranty you don't have.

Output: the updated inventory with warranty dates, the expiring-soon flags, and the aging-cliff watch list.
