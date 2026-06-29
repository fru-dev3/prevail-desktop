---
id: refresh-slack
runner: llm
trigger: refresh
outputs:
  - { path: data/slack-messages-${date}.json, kind: replace }
  - { path: data/slack-mentions-${date}.json, kind: replace }
  - { path: data/slack-channels-${date}.json, kind: replace }
---
# Refresh Slack
Pull the threads, decisions, and pings that matter so your AI knows what your team is waiting on you to do. Strictly read-only, never post, react, or mark as read.
1. **Channels.** List the channels and DMs you're in, capturing name, type, and your last-read timestamp.
2. **Messages.** Read recent messages per channel within a window, capturing author, timestamp, text, and thread links.
3. **Mentions.** Collect direct @-mentions of you and unread threads.
4. **Save.** Write each dataset to its `data/slack-*-${date}.json` file.
Output: a dated snapshot of recent Slack messages, mentions, and channel/unread state.
