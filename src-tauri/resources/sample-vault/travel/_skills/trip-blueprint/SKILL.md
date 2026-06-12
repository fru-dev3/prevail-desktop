---
id: trip-blueprint
runner: llm
trigger: on-demand
description: Turn a trip idea into a booked plan: dates, budget, the three anchors, and what stays unplanned.
source: seed
---

# Trip blueprint

Run when a trip moves from idea to intent (see the Lima and Portland threads).

1. **Frame.** Dates, budget ceiling, and the trip's one purpose (rest,
   adventure, people, food). Trips fail by trying to be everything.
2. **Three anchors.** Book the three things that must be true: flights, beds,
   and the one experience that justifies the destination. Everything else
   stays loose on purpose.
3. **Budget honestly.** Anchors plus a daily spend estimate times days, plus
   15% buffer. Check it against the wealth domain before booking.
4. **The skip list.** Name the famous things you are choosing to skip, so the
   trip is yours and not the checklist's.

Output: the frame, the three anchors with prices, the budget, the skip list.
