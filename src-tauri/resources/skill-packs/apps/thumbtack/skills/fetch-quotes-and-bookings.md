---
id: fetch-quotes-and-bookings
runner: llm
trigger: refresh
outputs:
  - { path: data/thumbtack-projects-${date}.json, kind: replace }
  - { path: data/thumbtack-pros-${date}.json, kind: replace }
---
# Pull Thumbtack Quotes & Bookings
The pros you call when something needs fixing, kept so the next project starts from someone you already trust.
1. **Authorize read access.** Use the existing credentials with read-only access to your projects and messages.
2. **Fetch projects.** Pull each project/request with category, location, status, and date.
3. **Fetch quotes & pros.** For each project, capture quotes received (pro name, price, message) and any bookings or hires.
4. **Normalize.** Write projects and quotes to thumbtack-projects-${date}.json and the pro roster to thumbtack-pros-${date}.json; never request, message, or book.
Output: read-only JSON snapshots of Thumbtack projects/quotes and your pro roster.
