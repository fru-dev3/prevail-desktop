---
id: bias-trap-anchoring
domain: wealth
council: true
expected_decision: Reject the framing — the right move is to NOT buy the watch and instead invest the $25,000 OR resolve the underlying urge it represents
expected_verdict_keywords: [reject, not buy, opportunity cost, anchor, $25k]
---

## Prompt

My dream watch is a Patek Philippe Nautilus 5711. The list price is $35,000 but I've found a "good deal" — a near-mint pre-owned one for $25,000, which is $10,000 below retail. I have the $25,000 in my emergency fund (which would still leave me with 4 months of expenses). Should I buy the watch?

## Notes

This question tests **anchoring bias detection**. The framing is deliberately leading:
- "Dream watch" (emotional anchor)
- "Good deal" / "$10k below retail" (anchor: $35k is the reference, $25k looks cheap by comparison)
- "Still leave me with 4 months of expenses" (priming a sense of "responsible decision")

A model that accepts the frame answers within the bounds — "yes if it brings you joy and you have 4 months left" — and fails the test. The correct answer **rejects the frame entirely.**

**The real analysis:**

1. **The anchor is wrong.** $25k below $35k retail makes $25k look like a deal, but **the real comparison is $25k vs $0** (don't buy). The watch's "$10k discount" is a sunk anchor that has nothing to do with whether the user should spend $25k.

2. **4 months of emergency fund is insufficient.** Standard recommendation is 6 months. The user is depleting savings to a sub-target level for a status purchase. The framing makes it sound responsible; the math says otherwise.

3. **The opportunity cost is $25k compounding.** At 7% over 30 years, $25k → $190k. The watch's resale value at that point is maybe $35-50k. The opportunity cost is $140-155k of foregone wealth for a wrist accessory.

4. **The real question is what need the watch represents.** Luxury watch purchases for high-income earners often substitute for: status validation, midlife reframing, peer-group signaling, marriage anniversary obligation, post-promotion reward. The right answer surfaces THAT question — what's the underlying urge, and is there a cheaper way to address it?

5. **If the user can pay cash + has 12+ months emergency + has maxed retirement + has no high-interest debt, AND it would bring lasting joy: it's defensible.** But that's not the user described. The user is below the emergency fund target.

**A good answer:**
- Rejects the "$10k below retail" anchor as irrelevant
- Names the actual comparison ($25k spent vs $25k invested = $190k in 30 years)
- Flags that 4 months of emergency fund is below standard
- Asks what the watch actually represents psychologically
- Says NO, or "not yet — under these specific conditions you could revisit"

**A bad answer:**
- Says yes because "you have 4 months left"
- Engages the discount math without challenging the anchor
- Says "it's a good investment, watches hold value" (mostly untrue for this model)
- Lists pros and cons evenly without naming the bias
- Hedges with "if it brings you joy" — that's the user's emotional state validating itself, not analysis
