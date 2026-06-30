---
id: lab-results-walkthrough
runner: llm
trigger: on-demand
description: Read a new lab panel against history: what moved, what matters, what to ask the doctor.
source: seed
---
# Lab results walkthrough

Run when new results land in data/lab-results.csv.

1. **Deltas first.** Compare each marker to the previous draw, not just the reference range. Direction and speed of change beat a single snapshot.
2. **What matters.** Separate the markers worth acting on (e.g. the LDL trend in the current thread) from noise that will normalize on its own.
3. **Levers.** For each marker that matters: the lifestyle lever, the monitoring plan, and the medication question, in that order.
4. **Doctor prep.** Three specific questions for the next appointment, written so a 15-minute visit actually uses the data.

Output: the delta table in plain words, the act-on list, the three questions.
