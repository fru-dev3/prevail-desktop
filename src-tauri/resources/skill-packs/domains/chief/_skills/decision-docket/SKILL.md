---
id: decision-docket
runner: llm
trigger: on-demand
description: Turn a fuzzy 'we should think about X' into a decision docket: options, owner, deadline.
source: seed
---

# Decision docket

Run whenever something has been "under consideration" for more than two weeks.

1. **Frame it.** One sentence: what is actually being decided, and what happens by default if nobody decides.
2. **Options.** Two or three real options with the strongest case for each. Include "do nothing" honestly costed.
3. **Owner and date.** Who decides, by when. A decision without a date is a wish.
4. **Reversibility.** Say whether it is reversible. Reversible decisions get decided fast and cheap; irreversible ones get the full treatment.

Output: the docket, ready to drop into the decisions ledger once called.
