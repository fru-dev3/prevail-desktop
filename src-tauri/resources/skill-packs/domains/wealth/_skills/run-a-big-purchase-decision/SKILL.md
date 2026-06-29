---
id: run-a-big-purchase-decision
runner: llm
trigger: on-demand
description: Decide whether to make a large one-off purchase now or wait, using the emergency-fund-first framework.
source: seed
---
# Run a big-purchase decision

A reusable framework for any large, one-off spend (appliance, repair, upgrade). Work through it in order.

1. **Is it affordable at all?** Confirm the emergency fund can absorb the cost without touching investments. If not, the decision is "wait and save," not "buy now."
2. **Replace-now vs wait.** If affordable, the question is timing, not money. Weigh the cost of failure (emergency pricing, downtime, knock-on damage) against the savings from waiting.
3. **Seasonality & risk window.** Is there a peak-demand window approaching (summer HVAC, winter heating) where a failure would be worse and pricing higher? Buying ahead of it is usually cheaper than an emergency replacement.
4. **Restore the buffer.** After the spend, set a concrete plan to refill the emergency fund back to its target (months of expenses).

Output: a clear recommendation, the dollar impact, and the buffer-restore plan.
