---
id: training-load-trend
runner: llm
trigger: on-demand
description: Track weekly load over the last several weeks to catch ramps that risk injury or stagnation.
source: seed
---
# Training load trend

Run every two to three weeks to keep the build sustainable.

1. **Weekly totals.** From data/training-log.csv, sum each of the last six weeks by volume (distance and minutes) and by intensity mix (easy vs quality).
2. **The ramp rate.** Compute each week's change against the prior. Sustained jumps over 10% are where injuries hide; flag any week that spiked.
3. **Monotony and rest.** Check that hard and easy days actually differ and that rest days exist. A flat grind of medium efforts builds fatigue without fitness.
4. **Call the next block.** Decide whether to keep building, hold for a consolidation week, or back off, and by how much.

Output: the six-week load table, the ramp-rate flags, and the verdict for the next block.
