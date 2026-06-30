---
id: refresh-slack-api
runner: api
trigger: on-demand
capability: refresh-slack
auth: [SLACK_TOKEN]
url: https://slack.com/api/users.conversations?types=public_channel,private_channel,im,mpim&limit=100
method: GET
headers:
  - "Authorization: Bearer ${env.SLACK_TOKEN}"
  - "Accept: application/json"
save: slack-channels-${date}.json
summary_path: ok
---
# Refresh Slack (API fallback)

Headless fallback for the refresh-slack capability. Access method derives from
`runner: api`. Lists the conversations the token can see via the Slack Web API
using SLACK_TOKEN (scopes channels:read, groups:read, im:read, mpim:read).
Read-only GET.
