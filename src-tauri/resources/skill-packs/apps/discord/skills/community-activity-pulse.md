---
id: community-activity-pulse
runner: llm
trigger: on-demand
outputs:
  - { path: data/discord-activity-pulse-${date}.json, kind: replace }
---
# Community Activity Pulse
See which servers and channels are alive and which went quiet.
1. **Load.** Read the newest `data/discord-messages-*.json` and `data/discord-channels-*.json`.
2. **Count.** Tally messages and active members per channel over the window.
3. **Trend.** Compare against the prior window to flag rising vs. quieting channels.
4. **Surface.** Note the communities you care about that have gone silent.
Output: a per-channel activity pulse with message counts, active members, and trend.
