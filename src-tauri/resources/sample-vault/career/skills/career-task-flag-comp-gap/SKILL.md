---
name: aireadylife-career-task-flag-comp-gap
type: task
cadence: quarterly
description: >
  Writes a structured compensation gap flag to vault/career/open-loops.md when current TC falls below market P50 for role, level, and metro. Includes current TC, market P50, dollar gap, gap percentage, severity tier, benchmark sources, and a tiered action plan (negotiate at review / passive market engagement / active exploration).
---

## What It Does

Called by `aireadylife-career-flow-build-comp-summary` when the benchmarking analysis finds that total compensation is below the market P50. A comp gap flag is not just a notification — it is a structured action brief that tells you exactly how large the problem is, how serious it is, and exactly what to do about it based on the severity.

**Severity tiers and action plans:**

*Low severity (gap under 10% vs. P50):* Indicates you are within a reasonable range of market median. The gap is likely within normal variance and may close on its own through a standard merit review. Recommended action: document the comp gap data (saving the benchmark sources and the gap amount) and bring it to your next scheduled performance review conversation. Prepare a comp conversation script that references market data, your contributions in the prior period, and a specific target. No external market exploration needed unless other signals exist.

*Medium severity (gap 10-25% vs. P50):* Indicates meaningful under-market compensation that is unlikely to close without deliberate action. The gap is large enough to represent real financial cost (a 15% gap on a $150K salary = $22,500/year). Recommended actions: (1) initiate a proactive comp conversation with your manager outside of the normal review cycle, armed with specific market data; (2) begin passive market engagement — activate job alerts, update your LinkedIn profile, and let your network know you are open to conversations. The goal of passive engagement at this stage is to develop BATNA, not to necessarily leave.

*High severity (gap above 25% vs. P50):* Indicates the employer's compensation structure is substantially below market for your role and level. Gaps of this magnitude typically do not close through internal negotiation alone — the employer's compensation bands may cap what is achievable. Recommended action: begin active market exploration with a 90-day target timeline for external offers, which will give you either a real BATNA to negotiate with or a path to a market-rate offer elsewhere. Note: do not quit before having alternatives in hand.

**Preventing duplicate flags:** Before writing a new flag, checks open-loops.md for an existing comp gap entry. If one exists, the existing entry is updated with current data rather than creating a duplicate. If the severity tier has changed since the prior quarter, the update notes the escalation or de-escalation.

**Financial exposure framing:** Includes the annualized dollar cost of the gap (gap_pct × current_base) as context. A 20% gap framed as "$25,000/year in foregone compensation" lands differently than a percentage.

## Steps

1. Receive gap data from calling flow: current_TC, market_P50, gap_amount, gap_pct, severity_tier, benchmark_sources.
2. Check `vault/career/open-loops.md` for existing comp gap entry — if found, prepare update rather than new entry.
3. Calculate annualized dollar cost of the gap (gap_amount).
4. Select action plan based on severity tier.
5. Write (or update) structured flag entry to `vault/career/open-loops.md`.
6. Return confirmation to calling flow.

## Input

- Data passed by calling flow: current_TC, market_P50, gap_amount, gap_pct, benchmark_sources
- `~/Documents/aireadylife/vault/career/open-loops.md` — existing entries for deduplication

## Output Format

Entry written to `vault/career/open-loops.md`:

```
## [COMP GAP] — [Severity: Low / Medium / High] — Updated [YYYY-MM-DD]

Current TC: $X
Market P50 for [Role] / [Level] / [Metro]: $X
Gap: -$X (-X% below P50)
Annual cost of gap: $X/year
Market P25-P75 range: $X–$X

Benchmark sources:
- Levels.fyi ([date]): P50 = $X for [role/level/company tier]
- Glassdoor ([date]): Median = $X for [role/metro]

Action plan ([Severity]):
[Specific tiered action plan text]

Status: Open — created [date] / Updated [date]
Next review: [date of next quarterly comp review]
```

## Configuration

No configuration required. Reads from open-loops.md at `vault/career/open-loops.md`.

## Error Handling

- **Gap is positive (TC above P50):** Do not write a comp gap flag. Optionally write a brief "comp is healthy" note to the monthly brief but do not clutter open-loops with non-issues.
- **Severity cannot be determined (insufficient market data):** Write a "comp data insufficient" flag instead, noting which data source failed and what data is needed to complete the benchmarking.

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/career/open-loops.md`
- Writes to: `~/Documents/aireadylife/vault/career/open-loops.md`
