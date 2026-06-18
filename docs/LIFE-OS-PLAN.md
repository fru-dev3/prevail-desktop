# Life-OS Plan — Task Board, Decision-Participation Assistant, Journaling & Growth (2026-06-18)

Branch: `feat/life-os`. Design-first; for founder review before building.

Founder's three asks (verbatim intent):
1. **Task board** — tasks done by me, vs assigned to AI vs assigned to "me", in one board.
2. **Decision-participation assistant** — an assistant that remembers my work and asks me
   for the *decisions* on automated tasks; I'm in the decision loop, not the manual labor.
3. **Journaling & growth routine** — a daily "moment/question of the day"; track what I learn
   or want to learn; an assistant that organizes my calendar/time around my **vision** to grow
   across all areas of personal life.

> "Perhaps this is already possible, I just don't see how yet!"

## 0. Answer: is this already possible?
**Mostly yes — the engines exist; the surfaces and a couple of small data-model fields don't.**
We extend, never rebuild. Concretely:
- **Loops already implement "AI does the work, asks me for decisions"** — autonomy levels
  (suggest / tasks / ask / auto) + a real **"Needs your approval" queue** (Execute / Task /
  Dismiss) that records outcomes to `_decisions.jsonl`. (loops.ts:24-36, loopspanel.tsx:239-285,
  daemon-loops.ts:183-190, 298-370.)
- **Tasks already exist** per-domain (`_tasks.md` with `~source` tokens) + a cross-domain board
  (TasksCrossDomainSection) + a taskgen daemon + reminders. (tasks.rs, settings2.tsx:350-401,
  panels.tsx:684-743, taskgen.rs, reminders.rs.)
- **Journaling substrate exists** — `_journal/{decisions,facts}.md` auto-distilled, the
  `_intents.jsonl` → `intents_distilled.json` pipeline, per-domain `goals.md`. (journal.ts,
  daemon-learn.ts, settings2.tsx IntentsSection.)
- **Your "vision" + alignment exist** — `ideal-state.md` (+ omega, per-domain ideal M6) injected
  into every turn; **alignment scoring per life-pillar** (wealth/revenue/health/living/
  relationships). (settings4.tsx, omega.tsx, alignment.ts.)
- **The apps-connector framework exists** (just rebuilt) — so "read my calendar" = wiring the
  **Google Calendar** connector through the same real-connection machinery as PayPal.

What's genuinely missing is **(a)** an owner/status field on tasks, **(b)** a unified
cross-domain **Decision Inbox** + scheduled **check-ins** + open-ended **question-asking**,
**(c)** a journaling-ritual UI + a growth tracker, and **(d)** a wired Google Calendar +
a time-vs-vision alignment pass.

## 1. The unifying idea (avoids redundancy)
All three asks converge on ONE shared surface + two small model additions. Don't build three
separate inboxes:

- **The Decision Inbox** is the single place "things that need *you*" land — from Loops
  (approvals), from AI-assigned **tasks** (pillar 1), from the **calendar/growth** routine
  (pillar 3), and from scheduled **check-ins / questions** (pillar 2). One surface, many feeders.
- **Tasks gain `owner` + `status`** (pillar 1) — and an **AI-owned** task is just a Loop action
  under the hood (reuse loop execution + `_decisions.jsonl`), so "assign to AI" isn't a new
  engine, it's a routing of the task to the loop steward.
- **Journaling/growth/calendar** reuse the Journal/Intents pipeline + alignment scoring + the
  connector framework; their outputs that need a human decision flow into the same Decision Inbox.

---

## 2. Pillar 1 — Task board (me / AI / done)

**Exists:** `_tasks.md` (`@due +added ~source`), cross-domain + per-domain UIs, taskgen, reminders,
loop-filed tasks, surface/intent "save as task".
**Gaps:** no `owner` (me vs AI), no status beyond `done`, no AI-*execution* of a task, no board layout.

**Design:**
- **Model (tasks.rs + types.ts):** add two tokens — `~owner:me|ai` (default `me`) and
  `~status:todo|doing|blocked|review|done` (default derived from `done`). Back-compat: existing
  tasks parse as `owner=me, status=todo/done`. Keep the markdown format (non-destructive).
- **Board UI:** evolve `TasksCrossDomainSection` into a board grouped by **owner** (Me | AI) and/or
  **status** columns (To-do / Doing / Needs review / Done), with the domain badge + due + source.
  Filter by domain/owner; drag or button to move status; reassign me↔AI.
- **AI execution = Loops, reused:** assigning a task to **AI** files it to the domain's loop
  steward as an action; the loop runs it under its autonomy guardrail. Anything consequential →
  **Decision Inbox** (pillar 2); the result lands as `status:review` for you to accept, with the
  outcome recorded in `_decisions.jsonl`. No new executor engine — reuse daemon-loops
  `loop_execute_action`.
- **Files:** tasks.rs (tokens + `tasks_set_owner/status`), types.ts (DomainTask), settings2.tsx
  (board), panels.tsx (per-domain), daemon-loops.ts (consume AI-owned tasks).

## 3. Pillar 2 — Decision-participation assistant

**Exists:** Loops autonomy (suggest/tasks/ask/auto) + per-domain **pending-approval queue**
(`_loops_runtime.json:pending[]`, Execute/Task/Dismiss → `_decisions.jsonl`), memory substrate
(`_memory.md`/`_state.md`/`_intents.jsonl`/`_decisions.jsonl`/omega), loop run-history.
**Gaps:** approvals are **per-domain only** (no unified inbox); loops can only ask
approve/defer/dismiss (**no open-ended questions**); **no scheduled check-ins**; no snooze/
scheduled decisions; no standing-questions ledger; no "decisions I've made" review.

**Design — the Decision Inbox + check-ins:**
- **Decision Inbox (new top-level surface):** aggregates every domain's `pending[]` + AI-task
  approvals + calendar/growth proposals into one list, each with: domain, what, why, and actions
  (Approve/Execute · Defer to task · Snooze · Dismiss). Reuses the existing per-domain approve
  plumbing; just a cross-domain read + a unified panel + a sidebar badge ("3 need you").
- **Open-ended questions (extend the loop schema):** add `needs_input` alongside `needs_approval`
  with `input_type: binary|choice|text`. A loop/check-in can ask "What's your focus next quarter?"
  and the answer is stored to `_decisions.jsonl` (kind `input`) so it informs future runs.
- **Scheduled check-ins (new lightweight daemon, on the existing daemon harness):** on a cadence
  (e.g. weekly) it reads open loops + intents + alignment + standing questions and emits a small,
  high-leverage set of decision prompts into the Inbox — the "assistant asks me when it needs me."
- **Standing questions ledger** (`_meta/standing_questions.jsonl`): open threads the assistant
  re-surfaces on a cadence until answered. Snooze/defer supported (`scheduledAt`).
- **Memory is already there** — the assistant "remembers my work" via `_memory.md`/`_state.md`/
  `_decisions.jsonl`/omega, which loops already read. No new memory engine.
- **Files:** new DecisionInbox panel + sidebar badge; loops.ts (`needs_input`); daemon-loops.ts
  (input branch + check-in pass) or a small `daemon-checkin.ts`; standing_questions ledger r/w.

## 4. Pillar 3 — Journaling & growth + calendar-to-vision

**Exists:** auto-distilled `_journal/{decisions,facts}.md`; `_intents.jsonl`→`intents_distilled.json`;
per-domain `goals.md`; ideal-state.md (vision) + omega + alignment scoring per pillar;
Recommendations engine; Calendar **domain folder** (no real calendar access).
**Gaps:** no self-journaling **write UI** / question-of-the-day; no **learning-goals tracker**;
no calendar **read/organize** (Google Calendar not wired); no growth/time recommendations.

**Design:**
- **Daily journaling ritual:** a "Journal" surface with a **question/moment of the day** generated
  from your ideal-state + recent activity (a tiny daily prompt), plus a free-write entry. Entries
  append to a real `_journal/entries.md` (user-authored, distinct from the auto decisions/facts)
  and feed the intents/memory pipeline so reflections shape future context. (Closes M3's
  "Journal→Intent" loop with a real write path.)
- **Growth / learning tracker:** surface `goals.md` across domains + "want to learn" intents in one
  "Growth" view — active vs stalled, with progress. Add a **growth** category to the Recommendations
  engine ("you've asked about X 3× — block time for it").
- **Calendar, for real (reuses the apps framework):** wire the **Google Calendar** connector through
  the real-connection machinery (OAuth "Sign in" → read-only sync → `data/apps/google-calendar/`),
  exactly like PayPal. Then a **time-vs-vision alignment pass** (extends alignment.ts): compare how
  your time is allocated (from the calendar) against your ideal-state pillars, and propose calendar
  **blocks/reschedules** — surfaced as **Decision Inbox** items (you approve; it books via the
  connector's write scope, or files a task). "Organize my calendar around my vision" =
  calendar-read + alignment + Decision-Inbox proposals.
- **Files:** Journal write UI + `_journal/entries.md` + a daily-prompt helper; Growth view (reads
  goals.md + intents); recommendations.ts (growth category); google-calendar connector manifest +
  skill (apps framework); alignment.ts (time allocation); Decision Inbox (calendar proposals).

---

## 5. Phased build plan
- **P0 — Task board owner/status + Decision Inbox (shared spine).**
  - tasks: `~owner`/`~status` tokens + board UI (Me/AI, status columns).
  - Decision Inbox: cross-domain aggregation of existing loop `pending[]` + AI-task approvals +
    sidebar badge. (Pure reuse of existing approve plumbing — highest value, lowest risk.)
- **P1 — Decision-participation depth.**
  - `needs_input` open-ended questions; scheduled **check-in** daemon; standing-questions ledger;
    snooze/defer. AI-owned tasks execute via the loop steward, results → `status:review`.
- **P1 — Journaling ritual + growth tracker.**
  - Journal write UI + question-of-the-day + `_journal/entries.md` → intents; Growth view +
    growth recommendations.
- **P2 — Calendar-to-vision.**
  - Wire Google Calendar connector (apps framework); time-vs-vision alignment pass; calendar
    block/reschedule proposals into the Decision Inbox (read first; write behind approval).

## 6. Redundancy guardrails (what NOT to build)
- Don't build a new task engine — extend `_tasks.md` + reuse Loops for AI execution.
- Don't build a new approval/agent engine — Loops + `_decisions.jsonl` already do it; just
  **aggregate** into the Decision Inbox and add a question type.
- Don't build a new memory store — `_memory/_state/_intents/_decisions/omega` already compound.
- Don't build a bespoke calendar integration — use the apps-connector framework (Google Calendar).
- Don't build a new vision store — `ideal-state.md` + alignment.ts are the vision + the gap metric.

## 7. Version / branch
Branch `feat/life-os`; ships as the version after the apps redesign lands. Founder reviews this
plan, we pick the P0 slice (recommended: **Task-board owner/status + Decision Inbox**, since it's
the shared spine all three pillars hang off), build it, then iterate P1/P2.
