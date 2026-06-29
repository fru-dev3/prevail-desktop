---
id: decisions-and-followups-log
runner: llm
trigger: on-demand
outputs:
  - { path: data/slack-decisions-log-${date}.json, kind: replace }
---
# Decisions and Follow-ups Log
Track what your team agreed and what you owe.
1. **Load.** Read the newest `data/slack-messages-*.json`.
2. **Extract.** Pull statements that read as decisions or commitments.
3. **Assign.** Separate action items owed by you from those owed by others, keeping the source thread link.
4. **Status.** Mark each follow-up as open or apparently resolved.
Output: a log of decisions and open follow-ups with owners and source links.
