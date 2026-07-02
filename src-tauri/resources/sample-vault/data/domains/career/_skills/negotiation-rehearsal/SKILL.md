---
id: negotiation-rehearsal
runner: llm
trigger: on-demand
description: Rehearse a comp or scope negotiation: position, anchors, walk-away, and the exact opening lines.
source: seed
---

# Negotiation rehearsal

Run before any comp review, offer call, or scope negotiation.

1. **Position.** Pull the current comp from data/compensation-history.csv and the RSU schedule. State plainly what is being asked for and why it is justified by shipped work, not tenure.
2. **Anchors.** Set three numbers: the ask (ambitious but defensible), the target (satisfied), and the walk-away (below this, decline or escalate).
3. **Their side.** List the strongest objections the other side will raise and one crisp response to each. No filler responses; if an objection has no good answer, say so and plan around it.
4. **Opening lines.** Draft the first two sentences verbatim. Negotiations are won in the framing.

Output: the three numbers, the objection table, and the opening lines.
