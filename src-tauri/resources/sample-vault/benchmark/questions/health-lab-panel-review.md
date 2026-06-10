---
id: health-lab-panel-review
domain: health
council: false
expected_decision: The three priorities are insulin resistance (HOMA-IR 3.5 + HbA1c 5.8), elevated ApoB/Lp(a) cardiovascular risk, and vitamin D deficiency, in that order
expected_verdict_keywords: [HOMA-IR, ApoB, Lp(a), insulin, vitamin D]
attachments: [health-lab-panel.md]
---

## Prompt

Read the attached lab panel and the prior year comparison. Which 2-3 results need follow-up, in what priority order, and what should I bring up with my doctor?

## Notes

The panel is designed so a competent reader prioritizes correctly across MANY flagged values. The flags are deliberately abundant, most labs show 5-10 things "out of range" but only a few materially predict outcomes. A good answer prioritizes signal over noise.

**The three highest-priority findings:**

1. **Insulin resistance (HOMA-IR 3.5 + HbA1c 5.8% + fasting glucose 102):** This is pre-diabetes drifting toward type 2. HbA1c rose from 5.6 → 5.8 in one year. This is the single highest-actionable finding because intervention (diet + exercise) has the strongest evidence for reversing the trajectory.

2. **Cardiovascular: ApoB 124 + Lp(a) 92 + hs-CRP 3.4:** ApoB is the better predictor of cardiovascular risk than LDL alone (LDL of 152 is the surface flag, but ApoB tells you about the actual atherogenic particle count). Lp(a) is genetically determined, knowing the number matters because it can't be lifestyle'd away but it does change risk math.

3. **Vitamin D deficient (22 ng/mL, was 28 last year):** Simple supplement fix. Mention it but it's the lowest-priority of the three.

**What a good answer surfaces vs ignores:**

- ALT 48 (mildly elevated) is likely NAFLD secondary to insulin resistance, flag as connected to #1, not as separate
- TC/HDL 5.7 is concerning but the ApoB / Lp(a) story is more specific
- Triglycerides 162 also connected to insulin resistance
- Thyroid, CMP, CBC: all fine; flag the abundance of normal results as the signal that the patient isn't broadly unhealthy, they have a specific metabolic problem
- Ferritin, B12, magnesium: all normal; don't waste prioritization on these

**Specific doctor questions:**
- "What's my 10-year cardiovascular risk given ApoB 124 and Lp(a) 92? Does this warrant a statin or PCSK9 conversation?"
- "Should I do a CGM trial to understand my glucose response?"
- "Do you treat at HbA1c 5.8 or wait for 6.0?"

A good answer:
- Picks 2-3 priorities, not 7
- Leads with the insulin resistance cluster, not the cholesterol
- Names ApoB (not just LDL) for cardiovascular
- Mentions Lp(a) as genetically-determined / not lifestyle
- Acknowledges vitamin D as easy but not the headline

A bad answer:
- Lists every flagged value as equal priority
- Treats LDL as the cardiovascular story without bringing up ApoB
- Misses the YoY trend (HbA1c rising, hs-CRP rising)
- Recommends "lifestyle changes" generically without naming the metabolic specifics
