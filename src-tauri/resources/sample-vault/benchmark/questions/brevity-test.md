---
id: brevity-test
domain: vision
council: false
expected_decision: One short sentence picking a side, no preamble, no bullet list, no qualifications
expected_verdict_keywords: [invest, prepay, mortgage, sentence, bottom line]
---

## Prompt

Give me the bottom line in ONE sentence. No preamble, no caveats, no bullets. Just commit:

Should I prepay my 6% mortgage or invest the cash at an expected 7% return? I have 8 months of emergency fund and a 30-year horizon. Pick one and tell me why in the same sentence.

## Notes

This question tests INSTRUCTION-FOLLOWING (specifically brevity). The substantive answer is obvious — invest, because the spread is positive and the liquidity floor is met. The interesting question is whether the model FOLLOWS THE FORMAT.

**Correct answer shape (any of these is fine):**
> Invest — at a positive 1-2% after-tax spread over a 30-year horizon with 8 months of liquidity already in place, the math wins.

> Invest — your liquidity floor is met and the long-run spread (~1.5% after-tax) compounds to meaningfully more than the prepayment savings over 30 years.

**Wrong answer shape (these all fail even if they pick the right side):**
- Any preamble like "Great question!" or "Let me think about this..."
- A bulleted list with multiple points
- A multi-sentence response with caveats ("It depends on...")
- A response that asks a clarifying question
- A response that says "here's a one-sentence answer" and then writes three paragraphs
- A response with footnotes, parentheticals, or em-dashes used to smuggle in additional sentences disguised as one

**Why this matters:**
Most production AI use cases involve telling the model HOW to respond, not just what to say. A model that produces correct substance in the wrong format wastes the user's time and breaks downstream pipelines. The point of this benchmark question is to test whether the model can SHUT UP — pick a side, say it, stop.

A good answer:
- One sentence
- Picks "invest"
- Names the reason in the same sentence (spread, liquidity, horizon)
- Does NOT have a preamble
- Does NOT have a bullet list

A bad answer:
- Pulls "it depends" — picking no side
- Has any preamble whatsoever
- Has more than one sentence
- Adds bullet points "for clarity"
- Asks for more information instead of answering
