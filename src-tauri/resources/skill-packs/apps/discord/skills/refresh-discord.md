---
id: refresh-discord
runner: llm
trigger: refresh
outputs:
  - { path: data/discord-messages-${date}.json, kind: replace }
  - { path: data/discord-mentions-${date}.json, kind: replace }
  - { path: data/discord-channels-${date}.json, kind: replace }
---
# Refresh Discord
Pull the server and DM threads so the people and projects you care about don't get lost in the scroll. Strictly read-only — never send, react, or edit.
1. **Servers.** List the servers (guilds) and channels you can read, capturing names and IDs.
2. **Messages.** Read recent messages per channel within a window, capturing author, timestamp, content, and reactions.
3. **Direct.** Collect @-mentions of you and DM threads.
4. **Save.** Write each dataset to its `data/discord-*-${date}.json` file.
Output: a dated snapshot of recent Discord messages, mentions, and DMs.
