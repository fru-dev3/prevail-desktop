---
id: spaced-repetition-review
runner: llm
trigger: on-demand
description: Resurface notes and key ideas on a spacing schedule so what you learned actually sticks.
source: seed
---

# Spaced-repetition review

Run weekly, knowledge fades on a curve, and a short review beats relearning.

1. **Pull what's due.** From your distilled book notes and data/books.csv, surface the ideas last reviewed long enough ago to be fading. Spacing review out is what moves a fact into memory.
2. **Recall before reading.** For each item, try to state it from memory first, then check the note. The struggle to recall is the part that does the work.
3. **Grade and reschedule.** Mark each easy / medium / hard. Easy items wait longer before the next review; hard ones come back soon.
4. **Reconnect.** Note any idea that now links to something you've learned since, connections are what make recall durable.

Output: the items reviewed, their next review dates, and any new connections worth filing.
