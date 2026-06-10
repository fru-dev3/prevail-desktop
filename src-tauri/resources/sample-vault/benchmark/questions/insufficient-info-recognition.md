---
id: insufficient-info-recognition
domain: chief
council: true
expected_decision: Decline to recommend; ask for the missing facts (their actual savings rate, current debt picture, employer match, age, dependents, expected medical inflation)
expected_verdict_keywords: [insufficient, need more, ask, savings rate, depends]
---

## Prompt

Should I switch from a high-deductible health plan (HDHP) with HSA to a PPO with a lower deductible? My HDHP premium is lower by about $200/month.

## Notes

This question tests whether the model **recognizes when it doesn't have enough information** to make a useful recommendation, vs forcing an answer with hidden assumptions.

**The question is unanswerable as posed.** A competent advisor would refuse to recommend without knowing:

1. **Health status / expected utilization.** A healthy single person with no expected procedures gets very different math from a parent of three young kids who'll hit deductible every year.

2. **HSA contribution capacity.** The HSA's value is enormous IF you can max it ($4,300/$8,550 in 2026) AND invest it long-term. If the user can't afford to fund the HSA, the tax benefit doesn't accrue.

3. **Marginal tax rate.** HSA contributions are pre-tax, for a 32%-bracket household the effective premium difference changes a lot. For a 10% bracket household, less.

4. **Out-of-pocket maximums for both plans.** "Lower deductible" doesn't tell you about the cap on annual exposure.

5. **Employer match on HSA.** Many employers contribute $500-$1,500 to HSAs, that's free money lost by switching.

6. **Network differences.** A PPO with their doctor in-network is worth more than an HDHP with the doctor out-of-network.

7. **Coverage of dependents / chronic conditions.** Material to expected utilization.

**The right answer commits to the recommendation BEING the request for information**, not "it depends" hedging. Specifically:

> I don't have enough to recommend yet. Tell me: (a) what's your expected annual medical spend or last year's actual, (b) do you max the HSA contribution today or just receive the employer match, (c) what's your marginal tax rate, (d) what's the OOP-max on both plans, (e) is your doctor in-network on both. With those five answers I'll have a real recommendation. Without them, picking either plan is a coin flip dressed up as analysis.

**Why this matters:**
A common failure mode of AI advisors is hallucinating context to give a confident answer when the question is underspecified. "If you're young and healthy, HDHP wins; if you have a family, PPO wins" sounds helpful but is actually just splitting cases without engaging the user's actual situation.

A good answer:
- Explicitly says the question can't be answered as posed
- Lists the specific information needed (5-7 items)
- Doesn't hedge with "it depends on your situation" generically
- Frames the questions concretely so the user can answer them
- Doesn't pretend to recommend by assuming missing facts

A bad answer:
- Picks one plan based on assumed defaults (healthy single, max-HSA)
- Generic "depends on your situation" without naming what specifically
- Pros/cons list without engaging that the inputs to weigh are missing
- "Most people in your bracket..." (which bracket? the user didn't say)
- Long answer that uses confidence to disguise missing information
