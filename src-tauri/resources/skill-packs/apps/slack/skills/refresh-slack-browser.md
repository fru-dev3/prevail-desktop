---
id: refresh-slack-browser
runner: browser-agent
trigger: refresh
favorite: true
method: browser
capability: refresh-slack
session: profile
start_url: https://app.slack.com/client
domain_allow: [app.slack.com, slack.com]
success_url_contains: slack.com
goal: Open Slack in the logged-in session and read unread channels and DMs, mentions, and recent threads where you are involved (channel, author, timestamp, gist). Read-only: never post, react, or mark anything as read.
outputs:
  - { path: data/slack-messages-${date}.json, kind: replace }
---
# Refresh Slack (browser, favorite)

Read unreads, mentions, and recent threads from Slack using the logged-in
browser session, no bot token required. Favorite. Falls through to the Slack
Web API method when the browser is blocked.

Read-only. Capture channel, author, timestamp, and gist, then write a normalized
JSON document. Never post, react, or mark as read.
