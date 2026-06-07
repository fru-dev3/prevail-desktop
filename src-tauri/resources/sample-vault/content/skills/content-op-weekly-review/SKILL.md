---
name: aireadylife-content-op-weekly-review
type: op
cadence: weekly
description: >
  Weekly content performance review. Reviews last 7 days of video and newsletter performance,
  flags publishing gaps, and surfaces top action items for the week.
  Triggers: "weekly content review", "content this week", "publishing gap", "content check".
---

## What It Does

Runs every Monday to start the week with a clear picture of last week's content performance and the current week's publishing obligations. This is the operational heartbeat of the content business — lighter than the monthly review but essential for catching publishing gaps and performance signals before they become problems.

Reviews the prior 7 days of content activity: any YouTube videos published (with their initial CTR and view count in the first 48 hours, which is the most predictive window for algorithm performance), any newsletter issues sent (with their open rate in the first 24 hours), any Gumroad sales activity, and any LinkedIn posts with notable engagement. Counts total pieces published across all platforms in the 7-day window.

Flags a publishing health alert if no content was published in the prior 7 days on any primary platform configured in config.md. The algorithmic consequence of a publishing gap varies by platform: YouTube reduces recommendation frequency after 2+ weeks of inactivity; LinkedIn's algorithm deprioritizes accounts that go quiet for 7+ days. A single-week publishing gap is a 🟡 watch; two consecutive weeks is a 🔴 risk.

Surfaces the top 3 action items for the current week based on: what is scheduled to publish, which content is in production, and what SEO or channel opportunity was flagged in the most recent monthly review that has not yet been acted on. The weekly review is the bridge between the monthly strategic review and daily execution.

## Triggers

- "weekly content review"
- "content check"
- "publishing gap"
- "content this week"
- "what should I work on for content"
- "last week's performance"
- "Monday content check"

## Steps

1. Determine the review period: the 7 calendar days ending yesterday (Sunday through Saturday)
2. Read vault/content/00_current/ for the publishing log; identify all content published in the 7-day window by platform
3. Read vault/content/00_current/ for the most recent video's 48-hour metrics (views, CTR, impressions) if a video was published in the window
4. Read vault/content/00_current/ for the most recent issue's 24-hour open rate if an issue was sent in the window
5. Read vault/content/00_current/ for any sales activity in the prior 7 days (units sold, revenue)
6. Count total pieces published per platform; compare to weekly publishing cadence target from config.md (monthly target / 4)
7. Flag any primary platform with zero content in the 7-day window: 🟡 first week, 🔴 second consecutive week
8. Read vault/content/open-loops.md for any unresolved content action items flagged in the most recent monthly reviews
9. Build the top 3 action items for this week: (1) most urgent publishing obligation, (2) most urgent monthly-review action item, (3) opportunity or optimization task
10. Present brief to user; offer to expand on any section

## Input

- `~/Documents/aireadylife/vault/content/00_current/` — publishing log; recent video/newsletter/post records
- `~/Documents/aireadylife/vault/content/00_current/` — most recent video's early performance metrics (if recently published)
- `~/Documents/aireadylife/vault/content/00_current/` — most recent issue's open rate
- `~/Documents/aireadylife/vault/content/00_current/` — 7-day sales data
- `~/Documents/aireadylife/vault/content/01_prior/` — prior period records for trend comparison
- `~/Documents/aireadylife/vault/content/open-loops.md` — current action items from monthly reviews
- `~/Documents/aireadylife/vault/content/config.md` — cadence targets, primary platforms

## Output Format

```
# Content Weekly Check — Week of {date}

## Last 7 Days Published
| Platform    | Published | Target/Wk | Status   |
|-------------|-----------|-----------|----------|
| YouTube     | 1 video   | 2         | 🟡 miss  |
| Newsletter  | 1 issue   | 1         | 🟢       |
| LinkedIn    | 3 posts   | 4         | 🟡 close |

## Performance — Most Recent Content
- YouTube: "[Title]" — 48hr: X,XXX views, X.X% CTR — [strong/weak start]
- Newsletter: Issue #{X} — 24hr open rate: XX% — [above/below avg]
- Gumroad: {X} units / $XXX this week

## Publishing Alert
{None / 🟡 [Platform] has not published in 7 days / 🔴 [Platform] has not published in 14 days}

## This Week's Top 3 Actions
1. {Most urgent publishing obligation — platform, topic, and deadline}
2. {Most urgent open-loop action from monthly reviews}
3. {Optimization or opportunity task}
```

## Configuration

Required in `~/Documents/aireadylife/vault/content/config.md`:
- `platforms_primary` — platforms that trigger publishing gap alerts
- `youtube_cadence_monthly`, `newsletter_cadence_monthly` — targets (divided by 4 for weekly check)
- `publishing_log_location` — path to publishing log within vault/content/00_current/

## Error Handling

- If publishing log is empty or does not exist: "No publishing log found. Add a record to vault/content/00_current/ each time you publish content to enable weekly tracking."
- If most recent video/newsletter metrics are not available: skip performance section and note "Add post-publish metrics to the vault to enable early performance tracking."

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/content/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/content/00_current/`, `~/Documents/aireadylife/vault/content/00_current/`, `~/Documents/aireadylife/vault/content/00_current/`, `~/Documents/aireadylife/vault/content/00_current/`, `~/Documents/aireadylife/vault/content/open-loops.md`, `~/Documents/aireadylife/vault/content/config.md`
- Writes to: `~/Documents/aireadylife/vault/content/00_current/weekly-snapshot.md`
