---
id: symptom-log-triage
runner: llm
trigger: on-demand
description: Turn a running symptom log into a clear read: pattern, likely triggers, and whether to see a doctor.
source: seed
---
# Symptom log triage

Run when a symptom has recurred enough to take seriously, not at the first twinge.

1. **The pattern.** From data/symptom-log.csv, lay the episodes in date order with severity and duration. Is it getting more frequent, more intense, or settling on its own?
2. **Triggers and correlates.** Cross-reference data/vitals.csv (sleep, resting HR) and any food, stress, or activity notes to surface what tends to precede an episode.
3. **Reassure vs escalate.** Apply a simple rule: clear red-flag features or a worsening trend means book a visit now; otherwise set a concrete watch-window with the threshold that would change the answer.
4. **Prepare the handoff.** If escalating, draft the timeline and triggers into the format the doctor-visit-prep skill expects, so nothing is lost in the retelling.

Output: the episode timeline, the likely triggers, and a clear see-a-doctor-or-watch decision with its threshold.

Note: this is an organizing aid for your own records, not medical advice; anything acute or alarming warrants prompt professional care.
