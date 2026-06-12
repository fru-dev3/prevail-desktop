---
id: doctor-visit-prep
runner: llm
trigger: on-demand
description: Walk in with a one-page brief: symptoms timeline, current data, and the decisions to leave with.
source: seed
---

# Doctor visit prep

Run two days before any appointment.

1. **Timeline.** Symptoms or concerns in date order, with severity and what
   made each better or worse. Vague recall wastes the visit.
2. **Data.** The relevant numbers from data/vitals.csv and lab history, plus
   medications and doses as actually taken.
3. **Decisions wanted.** The two or three decisions to leave the room with
   (test? referral? dose change? watch and wait until when?).
4. **The question you avoid.** Include the uncomfortable question; it is
   usually the important one.

Output: a one-page brief to read in the waiting room.
