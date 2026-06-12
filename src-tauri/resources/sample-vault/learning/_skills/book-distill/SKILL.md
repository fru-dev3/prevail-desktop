---
id: book-distill
runner: llm
trigger: on-demand
description: Turn a finished book into five permanent notes and one applied change.
source: seed
---

# Book distill

Run within a week of finishing any book (data/books.csv).

1. **Five notes.** The five ideas worth keeping, each rewritten in your own
   words with the situation where it applies. Quotes are not notes.
2. **Argue back.** The strongest point you disagree with and why. A book that
   met no resistance was not read carefully.
3. **One change.** The single behavior or decision this book changes, starting
   this week. If there is none, say so honestly; not every book earns one.
4. **File it.** Where each note connects to an existing goal or domain.

Output: the five notes, the objection, and the one change.
