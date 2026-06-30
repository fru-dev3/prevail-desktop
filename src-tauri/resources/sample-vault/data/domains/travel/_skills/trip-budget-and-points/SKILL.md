---
id: trip-budget-and-points
runner: llm
trigger: on-demand
description: Price the trip honestly and decide where points and miles beat cash without chasing them.
source: seed
---

# Trip budget and points

Run while the trip is still being booked, before the big charges land.

1. **Tally the real cost.** Sum the booked anchors plus a daily spend estimate times days, plus a 15% buffer. Pull confirmed prices from data/trips/ and check the total against the wealth domain.
2. **Inventory the points.** List the miles and card points available and what they're realistically worth here — flights and hotels usually redeem best; don't burn a stash on low-value spend.
3. **Cash vs. points, per anchor.** For each big-ticket item, decide which currency wins on value, then book that one. Points are a tool, not a scavenger hunt.
4. **Set the spend line.** A daily cash budget for the trip so the buffer stays a buffer.

Output: the full trip budget, the points-vs-cash call per anchor, and the daily spend line.
