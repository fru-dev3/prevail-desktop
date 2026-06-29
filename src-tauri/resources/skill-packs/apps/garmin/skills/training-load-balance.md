---
id: training-load-balance
runner: llm
trigger: on-demand
outputs:
  - { path: data/garmin-load-balance-${date}.md, kind: markdown }
---
# Training load balance

Train for capability and a long runway — keep load in the zone that builds rather than breaks.

1. **Read the load.** From the latest data/garmin-health-*.json, pull training load and any acute-versus-chronic or load-focus metric over the last few weeks.
2. **Check the ramp.** Compare recent load against your baseline and flag a spike that outpaces what you've adapted to.
3. **Check the mix.** Look at the balance of low, high, and anaerobic effort and name what's overcooked or missing.
4. **Steer it.** Recommend how to adjust the coming week's load and mix to stay in a productive range without digging a hole.

Output: a load-balance read with your current ramp, the effort mix, and a concrete adjustment for the week ahead.
