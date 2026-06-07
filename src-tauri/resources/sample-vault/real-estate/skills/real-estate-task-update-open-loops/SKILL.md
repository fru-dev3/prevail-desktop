---
name: aireadylife-real-estate-task-update-open-loops
type: task
description: >
  Writes all real-estate flags (market shifts, affordability changes, buy-window signals, interesting
  listings) to ~/Documents/aireadylife/vault/real-estate/open-loops.md and resolves items that
  are no longer relevant.
---

# aireadylife-real-estate-update-open-loops

**Trigger:** Called by real-estate ops and flows at the end of every run
**Produces:** Updated `~/Documents/aireadylife/vault/real-estate/open-loops.md` with current action items

## What It Does

This task maintains the real-estate domain's open-loops file as the active watchlist for market signals, purchasing considerations, and decision-pending items. It is called at the end of every real estate op and flow, and its output is read by other life plugins (calendar, wealth) to surface real estate action items in broader context.

Flags written to open-loops.md fall into five categories. Market shifts: when a target market's inventory drops more than 10% month-over-month, DOM compresses below 21 days, or price growth exceeds 5% MoM — these are time-sensitive signals that the market may be entering a competitive phase. Affordability changes: when a rate increase reduces the user's maximum purchase price by more than $20,000, or when income changes shift the affordability ceiling, this is flagged so the user understands how their buying power has moved. Buy-window signals: when three or more favorable conditions align simultaneously (falling rates, falling inventory, price-to-rent ratio below 18), a high-priority buy-window flag is written and marked urgent. Listing follow-ups: any property saved in the vault with status "watching" or "toured" that has been in that status for more than 30 days without an update gets flagged for decision. Pre-approval expiry: most mortgage pre-approval letters are valid for 60–90 days; if the vault records a pre-approval expiration date, a flag appears 3 weeks before expiry.

Each flag entry includes: flag type, description of the trigger condition, financial context (e.g., "Affordability ceiling dropped $25,000 due to rate increase from 6.75% to 7.00%"), recommended action, and a suggested action-by date. Urgency is labeled critical (buy-window signal or pre-approval expiring within 14 days), high (rate-driven affordability change of >$20,000, market shift in primary target), medium (listing follow-up overdue, secondary market shift), or monitor (general trend worth tracking).

On every run, the task also resolves items that are no longer applicable: a listing that sold and was marked sold in the vault, a rate that has returned to prior levels, a market signal that normalized. Resolved items are moved to `vault/real-estate/open-loops-archive.md` rather than deleted.

## Steps

1. Receive flag data from calling op or flow (flag type, description, financial context, recommended action)
2. Read existing `~/Documents/aireadylife/vault/real-estate/open-loops.md` to check for existing items of the same type
3. If an identical flag already exists and is unresolved: update the timestamp and context rather than creating a duplicate
4. If no existing flag: append new structured entry with urgency, description, action, and action-by date
5. Scan all existing open items against current vault data to identify resolved conditions
6. Move resolved items to `~/Documents/aireadylife/vault/real-estate/open-loops-archive.md` with resolution date and outcome
7. Count total open items by urgency level; return summary to calling op

## Input

- Flag data passed from calling op (flag type, description, financial context, recommended action, urgency)
- `~/Documents/aireadylife/vault/real-estate/open-loops.md` (existing items)
- `~/Documents/aireadylife/vault/real-estate/00_current/` (listing status for resolution check)
- `~/Documents/aireadylife/vault/real-estate/config.md` (pre-approval expiry if stored)

## Output Format

Each entry in `open-loops.md`:
```markdown
## [FLAG-TYPE] — [Short title] — [Urgency]
**Date flagged:** YYYY-MM-DD
**Context:** [financial context sentence]
**Action:** [recommended action]
**Action by:** YYYY-MM-DD
**Status:** open
```

Summary returned to calling op: "X items in open loops (Y critical, Z high, W medium, V monitor)"

## Configuration

No additional configuration required beyond vault existing and config.md populated.

## Error Handling

- If open-loops.md does not exist: create it with the first entry
- If open-loops-archive.md does not exist: create it when the first item is resolved
- If calling op passes a flag with missing context fields: write the flag with available data; mark fields as "unknown" rather than blocking the write

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/real-estate/open-loops.md`
- Reads from: `~/Documents/aireadylife/vault/real-estate/00_current/`
- Writes to: `~/Documents/aireadylife/vault/real-estate/open-loops.md`
- Writes to: `~/Documents/aireadylife/vault/real-estate/open-loops-archive.md`
