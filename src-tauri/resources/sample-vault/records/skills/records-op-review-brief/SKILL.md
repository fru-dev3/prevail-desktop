---
name: aireadylife-records-op-review-brief
type: op
cadence: monthly
description: >
  Monthly records review brief. Compiles expiring documents (with renewal steps), subscription
  cost review (total spend, unused services, upcoming renewals), document gaps, legal document
  review flags, and storage gaps into a single briefing with action items sorted by urgency.
  Triggers: "records brief", "document review", "subscription audit", "what's expiring".
---

# aireadylife-records-review-brief

**Cadence:** Monthly (1st of month, after monthly sync) or on-demand
**Produces:** Records brief — expiring documents, subscription cost and usage, document gaps, action items

## What It Does

This op generates the monthly records briefing document — a concise, action-oriented summary of everything in the records domain that requires attention. It is designed to answer, in a single read: what's expiring soon, what am I paying for, what am I missing, and what do I need to do this month?

The brief opens with three headline numbers: total monthly subscription spend, number of documents expiring within 90 days (with holder names), and number of open action items. These three numbers tell the user immediately whether this brief is routine (low spend, no expirations, zero open loops) or requires immediate action (passport renewal overdue, large unused subscription renewing this week, will missing for a household member).

The expiring documents section lists every document within its alert window sorted by urgency (most urgent first, calculated by days-to-renewal-deadline, not days-to-expiration). For each document: holder name, document type, expiration date, days until effective deadline (expiration minus renewal lead time), and the specific next action with the renewal portal link. This is meant to be copy-paste actionable: the user reads it, clicks the link, starts the renewal.

The subscription cost section shows the full subscription table from the subscription summary flow: every active subscription, monthly cost, last used, and recommendation. The section is headed with the total monthly and annual recurring spend so the number is visible even to a reader who skims. Subscriptions with renewals in the next 30 days are pulled to the top of the table with the renewal date bolded. Unused subscriptions (no use in 60+ days) are grouped at the bottom with the estimated annual savings from canceling all of them.

The document gaps section flags any important document that is not yet in the vault. This is short and direct: a bulleted list of missing documents, each with one sentence on how to obtain it.

The legal documents section flags any will, POA, or healthcare directive that is overdue for review, with the reason (elapsed time, or a specific life event trigger).

Action items are sorted by urgency across all sections. The user should be able to read the action items section alone and know what to do this month without reading the full brief.

## Triggers

- "Give me my records brief"
- "Records review"
- "What's expiring this month?"
- "Subscription cost review"
- "Do I have all my important documents?"
- "Document update"

## Steps

1. Read monthly sync output from `~/Documents/aireadylife/vault/records/00_current/last-sync.md` to confirm sync has run
2. Read expiration report from `~/Documents/aireadylife/vault/records/00_current/YYYY-MM-expiration-report.md`
3. Read subscription summary from `~/Documents/aireadylife/vault/records/00_current/YYYY-MM-subscription-summary.md`
4. Read open-loops.md for existing unresolved flags
5. Check document inventory for gaps against standard checklist
6. Read legal document review dates; compile review flags
7. Calculate headline numbers: total subscription spend, documents expiring <90 days, open loops count
8. Compile all sections into brief structure
9. Write brief to `~/Documents/aireadylife/vault/records/02_briefs/YYYY-MM-records-brief.md`
10. Call `aireadylife-records-update-open-loops` with any new flags from the brief

## Input

- `~/Documents/aireadylife/vault/records/00_current/YYYY-MM-expiration-report.md`
- `~/Documents/aireadylife/vault/records/00_current/YYYY-MM-subscription-summary.md`
- `~/Documents/aireadylife/vault/records/00_current/`
- `~/Documents/aireadylife/vault/records/01_prior/` — prior period records for trend comparison
- `~/Documents/aireadylife/vault/records/open-loops.md`

## Output Format

```
# Records Brief — [Month Year]

## Headlines
Monthly Subscriptions: $X | Documents Expiring <90 Days: X | Open Actions: X

## Expiring Documents (sorted by urgency)
| Document | Holder | Expires | Deadline | Next Action | Link |

## Subscriptions
Total: $X/mo | $X/yr | Potential savings from canceling low-usage: $X/yr
[Full subscription table with renewals-due-soon at top]

## Document Gaps
- [Missing document] — [how to obtain]

## Legal Documents — Review Recommended
| Document | Holder | Last Reviewed | Reason for Review |

## Action Items — This Week
## Action Items — This Month
## Watching
```

## Configuration

Required: vault populated, config.md complete, monthly sync completed at least once.

## Error Handling

- If vault missing: direct to frudev.gumroad.com/l/aireadylife-records
- If monthly sync hasn't been run: run sync first; offer to do it now
- If subscription registry is empty: omit subscription section; note how to add subscriptions

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/records/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/records/00_current/`, `01_legal/`, `02_subscriptions/`, `open-loops.md`
- Writes to: `~/Documents/aireadylife/vault/records/02_briefs/YYYY-MM-records-brief.md`
- Writes to: `~/Documents/aireadylife/vault/records/open-loops.md`
