---
id: spend-and-habits-review
runner: llm
trigger: on-demand
outputs:
  - { path: data/uber-spend-habits-${date}.md, kind: markdown }
---
# Spend and habits review

See what you actually spend on rides and the habits behind the meter.

1. **Total the spend.** From the latest data/uber-rides-*.json, sum fares over the last 90 days and show the monthly burn.
2. **Break it down.** Split spend by ride tier and by time of day, and show average fare and rides per week.
3. **Find the surge tax.** Surface how much of the total came from surge pricing and which times or routes triggered it most.
4. **Name the swaps.** Flag short or recurring trips where transit, walking, or a scheduled ride would have saved money without much friction.

Output: a ride spend review with the monthly total, tier and timing breakdown, surge cost, and a few honest swaps.
