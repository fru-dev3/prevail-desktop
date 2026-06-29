---
id: unread-and-mentions-digest
runner: llm
trigger: on-demand
outputs:
  - { path: data/slack-unread-digest-${date}.json, kind: replace }
---
# Unread and Mentions Digest
Cut through the scroll to what actually needs you.
1. **Load.** Read the newest `data/slack-messages-*.json` and `data/slack-mentions-*.json`.
2. **Filter.** Keep unread threads, direct @-mentions, and DMs addressed to you.
3. **Rank.** Order by likely urgency, questions to you, explicit requests, and deadlines first.
4. **Context.** Note who is waiting and on what for each item.
Output: a digest of items awaiting your reply, ordered by urgency.
