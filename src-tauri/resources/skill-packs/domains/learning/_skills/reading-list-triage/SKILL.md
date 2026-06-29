---
id: reading-list-triage
runner: llm
trigger: on-demand
description: Cut the reading backlog to a short, honest queue, read now, someday, or let go.
source: seed
---

# Reading-list triage

Run monthly, or whenever the to-read pile starts feeling like a debt.

1. **Gather the list.** Pull everything from data/reading-list.md and the unread rows of data/books.csv into one view, no triage works while the list is scattered.
2. **Sort into three.** Each item is Now (serves a current goal or a clear curiosity), Someday (genuine but not yet, give it a date to revisit), or Let go (saved on impulse, no longer true). Be honest; a list you'll never finish is just guilt.
3. **Pick the next three.** From Now, choose the three to actually read next, ordered, including at least one bedtime read to share with Maya.
4. **Protect the habit.** Confirm a recurring reading block exists; a steady habit clears a backlog that willpower never will.

Output: the triaged list and the next three reads in order, written back to data/reading-list.md.
