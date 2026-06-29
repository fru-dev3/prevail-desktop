---
id: meeting-worth-it-check
runner: llm
trigger: on-demand
description: Before accepting any meeting: what decision does it produce, and is there a cheaper format?
source: seed
---

# Meeting worth-it check

Run on any invite before accepting.

1. **Decision test.** What decision or unblocked work does this meeting produce? If the answer is "alignment" with no decision, it is a memo.
2. **Cheapest format.** Could this be a comment thread, a 5-line update, or a 15-minute call instead of an hour?
3. **Role test.** Am I needed for the decision, or just informed by it? If informed, ask for notes.
4. **Cost it.** An hour with five people is five hours. Say the number.

Output: accept / shorten / decline-with-alternative, and the one-line reply.
