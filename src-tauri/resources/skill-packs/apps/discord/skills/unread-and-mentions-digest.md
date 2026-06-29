---
id: unread-and-mentions-digest
runner: llm
trigger: on-demand
outputs:
  - { path: data/discord-unread-digest-${date}.json, kind: replace }
---
# Unread and Mentions Digest
Cut through the scroll to what actually needs you.
1. **Load.** Read the newest `data/discord-messages-*.json` and `data/discord-mentions-*.json`.
2. **Filter.** Keep direct @-mentions, replies to you, and DM threads.
3. **Rank.** Order by likely urgency, direct questions and requests first.
4. **Context.** Note which server/channel and who is waiting on you.
Output: a digest of items awaiting your reply, ordered by urgency.
