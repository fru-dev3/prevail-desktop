---
name: prevail-chief-task-eod-shutdown
type: task
cadence: daily
description: >
  End-of-day shutdown ritual. Five-minute structured wrap so the next
  morning starts fast. Captures what shipped today, what's parked for
  tomorrow, anything that worried/surprised you, and the ONE thing
  that matters most tomorrow morning. Used as the seed for the next
  daily brief. Triggers: "shutdown", "end of day", "EOD", "wrap up",
  "close the day".
---

# chief-task-eod-shutdown

**Cadence:** Daily (17:30 local — adjustable per user)
**Produces:** `vault/chief/_log/YYYY-MM-DD.md` (appended) + seeds tomorrow's brief

## What It Does

A short structured chat the user runs at end of day. The skill asks 4
questions and writes the answers to the daily log. Should take ≤5 minutes.

1. **What shipped today?** (3 things max — names + the actual outcome,
   not the activity)
2. **What's parked for tomorrow?** (the 1-3 carry-overs, with reasons)
3. **Anything that surprised, worried, or excited you?** (1 line — this
   is the signal that compounds into the weekly review)
4. **What's the ONE thing that matters tomorrow morning?**

Each answer is appended to today's `_log/YYYY-MM-DD.md` with a
`prevail-meta` block so the weekly review can find it. The answer to #4
gets promoted into tomorrow's daily brief as the headline.

## Inputs

- Just the user's answers (interactive)
- Today's existing `_log/YYYY-MM-DD.md` so the skill knows what already
  happened today and doesn't ask the user to re-state it

## Outputs

- Appends to `vault/chief/_log/YYYY-MM-DD.md`
- Sets `vault/chief/00_current/tomorrow-headline.md` = answer to #4
- This file is read by tomorrow morning's `chief-op-daily-brief`
