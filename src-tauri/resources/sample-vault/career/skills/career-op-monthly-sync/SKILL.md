---
name: aireadylife-career-op-monthly-sync
type: op
cadence: monthly
description: >
  Full career data sync on the 1st of each month. Refreshes compensation records from payroll portal, updates the job application pipeline, syncs LinkedIn profile activity and recruiter messages, organizes career documents into vault, and triggers the monthly career review brief. Triggers: "career monthly sync", "sync career data", "refresh career vault", "update career vault".
---

## What It Does

Full monthly career sync that keeps the vault current across every data source the career domain depends on. Runs on the 1st of each month, touching four data layers in sequence: payroll data, pipeline data, LinkedIn activity, and document organization — then capping with a review brief that synthesizes the refreshed data into actionable insights.

**Payroll sync:** Pulls the most recent pay stub from the configured payroll portal (ADP Workforce Now or Workday) via Playwright and extracts: gross pay, net pay, YTD earnings, current 401k deduction and YTD contributions, and all benefit deductions. Saves to `vault/career/00_current/pay-stubs/`. If the most recent pay stub shows a compensation change (raise, bonus payout, or deduction change), this is flagged for the Chief of Staff to route to the Wealth plugin.

**Pipeline sync:** Calls `aireadylife-career-flow-review-pipeline` to audit all active pipeline items for staleness. Applications with no response in 7+ business days are flagged for follow-up. Opportunities at the same stage for 14+ days without a next step are marked stalled. Watch-list items from prior month's market scan that have since closed are archived.

**LinkedIn activity sync:** Checks LinkedIn profile views and search appearance statistics (visible in LinkedIn Premium or via profile analytics) and logs them to `vault/career/00_current/linkedin-activity.md`. Scans the LinkedIn inbox for any pending recruiter messages or connection requests from people at target companies and logs them as pipeline items or network contacts.

**Document organization:** Scans the vault for any unsorted documents in the root `vault/career/` directory and routes them to the correct subfolder based on document type (pay stubs → `02_compensation/pay-stubs/`, equity statements → `02_compensation/equity/`, offer letters → `05_archive/` or `00_current/`).

Ends by triggering `aireadylife-career-op-review-brief` to produce the monthly brief with the freshly synced data.

## Triggers

- "career monthly sync"
- "sync career data"
- "refresh career vault"
- "update my career files"
- "run career sync"

## Steps

1. Read `vault/career/config.md` — confirm payroll portal type (ADP or Workday), LinkedIn profile URL, and Chrome profile path.
2. Connect to payroll portal via Playwright (headless=False) — navigate to pay statements, download most recent pay stub PDF to `vault/career/00_current/pay-stubs/YYYY-MM-paystub.pdf`.
3. Extract key fields from pay stub: gross pay, net pay, YTD gross, 401k deduction and YTD, all benefit deductions.
4. Compare gross pay to prior month — if changed by more than 1%, flag compensation event for routing.
5. Call `aireadylife-career-flow-review-pipeline` — get pipeline status report with stale and stalled flags.
6. For each stale application flagged (7+ days no response): add follow-up action item to open loops.
7. For each stalled opportunity (14+ days same stage): mark for decision — advance, deprioritize, or archive.
8. Connect to LinkedIn via Playwright — check profile views and search appearances for the month.
9. Scan LinkedIn inbox for unread recruiter messages — log any to `vault/career/00_current/` or `vault/career/00_current/recruiter-contacts.md`.
10. Scan `vault/career/` root for unsorted documents — route each to correct subfolder.
11. Update `vault/career/00_current/status.md` with sync timestamp and summary of changes.
12. Call `aireadylife-career-op-review-brief` to produce the monthly brief with refreshed data.
13. Call `aireadylife-career-task-update-open-loops` with all flags from this sync run.

## Input

- `~/Documents/aireadylife/vault/career/config.md` — portal URLs, Chrome profile, LinkedIn handle
- ADP / Workday payroll portal (via Playwright)
- LinkedIn (via Playwright for activity and inbox)
- `~/Documents/aireadylife/vault/career/00_current/` — current pipeline state
- `~/Documents/aireadylife/vault/career/01_prior/` — prior period records for trend comparison

## Output Format

**Sync Summary** — written to `vault/career/00_current/status.md`

```
## Career Sync — [Month Year]
Sync completed: [timestamp]

Payroll: Pay stub downloaded. Gross pay: $X. YTD: $X. 401k deduction: $X.
Compensation change: None / [Description of change]

Pipeline: X applications active. X flagged for follow-up. X stalled.
LinkedIn: X profile views. X recruiter messages reviewed.
Documents: X files organized.

Brief: Generated at vault/career/02_briefs/[file].
```

## Configuration

Required fields in `vault/career/config.md`:
- `payroll_portal` — adp or workday
- `payroll_portal_url` — specific URL for your employer's portal
- `payroll_chrome_profile` — path to Chrome profile with saved session
- `linkedin_profile_url` — your LinkedIn profile URL
- `linkedin_chrome_profile` — path to Chrome profile with saved LinkedIn session

## Error Handling

- **Payroll portal login expired:** Note that pay stub sync failed, prompt user to re-authenticate via Chrome (headless=False), then retry. Do not block the rest of the sync.
- **LinkedIn bot detection triggered:** Skip LinkedIn sync for this run, note in sync summary. Recommend the user log in manually and re-run LinkedIn portion only.
- **No new pay stub available:** If most recent pay stub already exists in vault (same pay period), skip download and note in summary.
- **Playwright not configured:** Fall back to prompting the user to download the pay stub manually and place it in `vault/career/00_current/pay-stubs/`.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/career/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/career/config.md`, `~/Documents/aireadylife/vault/career/00_current/`
- Writes to: `~/Documents/aireadylife/vault/career/00_current/pay-stubs/`, `~/Documents/aireadylife/vault/career/00_current/status.md`, `~/Documents/aireadylife/vault/career/00_current/linkedin-activity.md`, `~/Documents/aireadylife/vault/career/open-loops.md`
