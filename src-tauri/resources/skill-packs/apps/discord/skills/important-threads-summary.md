---
id: important-threads-summary
runner: llm
trigger: on-demand
outputs:
  - { path: data/discord-threads-summary-${date}.json, kind: replace }
---
# Important Threads Summary
Catch up on the conversations that carry weight.
1. **Load.** Read the newest `data/discord-messages-*.json`.
2. **Spot signal.** Identify high-signal threads, heavy reactions, many participants, or sustained discussion.
3. **Summarize.** For each, capture the gist and any open question or call to action.
4. **Order.** Lead with the communities and projects you care about most.
Output: a list of key threads each with a short summary and status.
