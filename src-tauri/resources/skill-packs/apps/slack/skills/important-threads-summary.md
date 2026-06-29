---
id: important-threads-summary
runner: llm
trigger: on-demand
outputs:
  - { path: data/slack-threads-summary-${date}.json, kind: replace }
---
# Important Threads Summary
Catch up on the conversations that carry weight.
1. **Load.** Read the newest `data/slack-messages-*.json`.
2. **Spot signal.** Identify high-signal threads — many participants, decisions being made, or long sustained discussion.
3. **Summarize.** For each, capture the outcome and any open question still hanging.
4. **Order.** Lead with threads relevant to your work.
Output: a list of key threads each with a one-to-two line summary and status.
