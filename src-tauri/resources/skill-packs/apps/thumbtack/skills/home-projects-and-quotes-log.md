---
id: home-projects-and-quotes-log
runner: llm
trigger: on-demand
outputs:
  - { path: data/thumbtack-projects-log-${date}.json, kind: replace }
---
# Thumbtack Home Projects & Quotes Log
A running record of home projects and the people who did good work.
1. **Load data.** Read the latest thumbtack-projects-*.json and thumbtack-pros-*.json snapshots.
2. **Log projects.** Build a timeline of home projects with category, date, status, and what it cost.
3. **Compare quotes.** For each project, line up the quotes received and the spread between them.
4. **Rank trusted pros.** Surface the pros you actually hired and would call again, with their category and contact context.
Output: a home-projects log JSON with a project timeline, quote comparisons, and a trusted-pro shortlist.
