# Workflows-Kanban — P0 Detailed Design (2026-06-18)

Branch: `feat/workflows-kanban`. Build-ready design for the P0 slice. Overview +
the other pillars live in `docs/WORKFLOWS-KANBAN-PLAN.md`.

**P0 scope:** a Kanban **Board** of tasks owned by **Me** or **AI**, where AI-owned
tasks run as **workflows** (via the existing Loop steward) and surface anything
consequential into a unified **Decision Inbox**. Reuses tasks.rs, Loops, and
`_decisions.jsonl` — no new engine.

Naming: *Kanban* = the board (To-do / Doing / Review / Done). *Workflow* = an
AI-owned task that the Loop steward executes. *Decision Inbox* = where workflows
ask you for the call.

---

## 1. Data schema

### 1.1 Task (extends `_tasks.md`, back-compat, non-destructive)
Today a task line is `- [ ] text @due +added ~source`. Add three optional tokens
(parsed only at line end, like the others; old lines still parse):

| Token | Values | Default | Meaning |
|---|---|---|---|
| `~owner:` | `me` \| `ai` | `me` | who does the work |
| `~status:` | `todo` \| `doing` \| `review` \| `blocked` \| `done` | `done`→`done`, else `todo` | board column |
| `~id:` | short base36 (e.g. `k7f3a`) | minted on first write | stable handle for moves + workflow linkage |

Example:
```
- [ ] Draft the Q2 budget @2026-06-25 +2026-06-18 ~src:user ~owner:ai ~status:doing ~id:k7f3a
- [x] Connect checking account +2026-06-09 ~src:user ~owner:me ~status:done ~id:b1n2c
```
Rust `Task` (tasks.rs) gains `owner: Option<String>`, `status: Option<String>`,
`id: Option<String>`; TS `DomainTask` mirrors. `done` and `status` stay
consistent (`status:done` ⇔ `done:true`; toggling `done` sets/clears `status:done`).

### 1.2 Decision Inbox item (read-model, aggregated — no new store in P0)
Built by reading every domain's existing `_loops_runtime.json:loops[*].pending[]`
plus AI tasks in `status:review`. Shape returned to the UI:
```ts
type DecisionItem = {
  id: string;            // `${domain}:${loopId}:${idx}` or `task:${taskId}`
  domain: string;
  kind: "approval" | "review";   // P0 (open-ended "input" = P1)
  source: "loop" | "task";
  loopId?: string; taskId?: string;
  text: string;          // the action/question
  why?: string;          // context (deadline, drafted, etc.)
  ts: number;
};
```
Actions reuse existing plumbing: **Approve & run** (`loop_execute_action` →
records to `_decisions.jsonl`), **Make a task** (`tasks_add`, owner=me), **Snooze**
(P0: hide 24h via a local `snoozedUntil` map), **Dismiss** (remove from `pending[]`).

---

## 2. UI

### 2.1 Where it lives
A new top-level **Board** surface (sidebar/top-nav), domain-scoped or **All**.
Replaces the settings-buried `TasksCrossDomainSection` as the primary task view
(that section stays as a fallback list). A **Decisions · N** badge sits in the
top bar + sidebar (like a running-processes pill), opening the Decision Inbox.

### 2.2 Board layout (kanban)
```
 Board   [ All ▾ ]                         [ Me · AI · All ]      + Add task
 ┌─ To-do · 3 ──────┐ ┌─ Doing · 2 ──────┐ ┌─ Review · 1 ─────┐ ┌─ Done · 5 ──┐
 │ ◻ Pay invoice    │ │ ◻ Reconcile June │ │ ◆ Pulled PayPal  │ │ ✓ Connect…  │
 │   Wealth · 👤 ·  │ │   Wealth · 👤    │ │   txns (142)     │ │   Wealth ◆  │
 │   Jun 20         │ │ ◆ Sync Fidelity  │ │   Wealth · ◆     │ │ ✓ File W-2  │
 │ ◆ Draft budget   │ │   ⟳ running…     │ │   [Accept][↻]    │ │   Tax · 👤  │
 │   Wealth · ◆     │ │                  │ │                  │ │             │
 │   [Assign AI ⤴]  │ │                  │ │                  │ │             │
 └──────────────────┘ └──────────────────┘ └──────────────────┘ └────────────┘
```
- **Card:** title, domain badge, owner glyph (`👤` Me / `◆` AI), due chip, source
  chip; AI cards running show `⟳ running…`; Review cards show `[Accept] [Re-run]`.
- **Owner filter** (Me · AI · All) + **domain** picker. **Blocked** items render in
  Doing with a small `⏸ needs decision` tag linking to the Inbox.
- **Move:** drag between columns OR a `⋯` menu (Move to…, Assign to AI / Me, Edit
  due, Delete). Drag = optimistic `tasks_set_status`.

### 2.3 Decision Inbox
```
 Decisions · 2 need you                                    [ snoozed (1) ▾ ]
 ┌──────────────────────────────────────────────────────────────┐
 │ ◆ Wealth · workflow "tax-prep"                                │
 │ Send the Q2 estimate to your accountant?                      │
 │ why: deadline Jun 15 · drafted + attached, ready to send      │
 │ [ Approve & run ]  [ Make a task ]  [ Snooze ]  [ Dismiss ]   │
 ├──────────────────────────────────────────────────────────────┤
 │ ◆ Health · workflow "labs"  —  Book the LDL recheck for Aug?  │
 │ [ Approve & run ]  [ Make a task ]  [ Snooze ]  [ Dismiss ]   │
 └──────────────────────────────────────────────────────────────┘
```
One cross-domain list (the gap today: approvals are per-domain in loopspanel).

---

## 3. Flows (screen-by-screen)
1. **Add a task (me).** `+ Add` → title, domain, optional due → appended via
   `tasks_add` with `~owner:me ~status:todo ~id:…` → card in To-do.
2. **Assign to AI.** Card `⋯ → Assign to AI` (or the `[Assign AI ⤴]` button) →
   `tasks_set_owner(id, "ai")` + `status:doing`, and the task is filed to the
   domain's Loop steward as an action (autonomy default `ask`). Card shows `⟳`.
3. **AI works.** The loop daemon runs the action. If it's consequential
   (spend/contact/irreversible) it emits `needs_approval` → the task goes
   `status:blocked` and a **Decision Inbox** item appears. If it completes, the
   task goes `status:review` with the result attached.
4. **You decide.** In the Inbox: **Approve & run** → `loop_execute_action` runs it,
   records to `_decisions.jsonl`, task → `review` (or `done`); **Make a task** →
   owner=me, todo; **Snooze** → hidden 24h; **Dismiss** → drops from `pending[]`.
5. **Accept / re-run review.** Review card `[Accept]` → `status:done` (`done:true`);
   `[Re-run]` → back to `doing` (re-files the workflow).
6. **Move / reassign / done.** Drag or `⋯`; checking a card off sets `done:true` +
   `status:done`.

---

## 4. Engine + wiring (files)

**Engine / Rust**
- `src-tauri/src/tasks.rs` — parse/serialize `~owner ~status ~id`; mint ids;
  commands `tasks_set_owner`, `tasks_set_status`, `tasks_move` (id-keyed, not
  text-keyed). Extend `tasks_read_all` to carry owner/status/id. Keep format
  back-compat. **Tests:** round-trip old + new lines; toggle ⇔ status:done.
- `src-tauri/src/lib.rs` — register the new commands + a `decisions_pending(vault)`
  command that aggregates each domain's `_loops_runtime.json:pending[]` (+ tasks in
  `status:review`) into `DecisionItem[]`.
- `src-tauri/src/engine.rs` or a small reader — `decisions_pending` impl (read-only
  fs walk of domains' `_loops_runtime.json`).

**Engine / cli**
- `prevail-cli/src/daemon-loops.ts` — when a task is `~owner:ai`, the steward picks
  it up as an action for that domain (reuse `appendTask`/action path inverted:
  read AI tasks → run). Consequential → `needs_approval` (existing). On success →
  set the task `~status:review`.
- `prevail-cli/src/tasks` reader/writer (decisions.ts/vault) — owner/status/id token
  parity with the desktop so both processes agree.

**Desktop / UI**
- New `src/boardpanel.tsx` — the Kanban board (columns, owner filter, cards, DnD,
  add, `⋯` menu) reading `tasks_read_all` + the set/move commands.
- New `src/decisioninbox.tsx` — the inbox panel reading `decisions_pending`, wired
  to existing approve/execute/dismiss (loopspanel already has the per-item calls to
  reuse: `loop_execute_action`, `tasks_add`, pending removal).
- `src/App.tsx` / sidebar — a **Board** nav entry + a **Decisions · N** badge that
  opens the inbox (mirror the running-processes pill pattern).

---

## 5. P0 build steps (order)
1. **Schema + commands + tests** (tasks.rs owner/status/id, set/move, tasks_read_all;
   cli token parity). No UI yet — verify via tests.
2. **Board UI** (boardpanel.tsx) reading the schema; add/move/reassign/owner-filter;
   nav entry. (Pure desktop; verifiable in the dev app.)
3. **Decision Inbox** (`decisions_pending` + decisioninbox.tsx + badge), reusing the
   existing loop approve/execute plumbing cross-domain.
4. **AI workflow execution** (daemon-loops consumes `~owner:ai` tasks → run → review;
   consequential → inbox). This is the only piece needing a live loop run to verify.

Steps 1-3 are fully verifiable without external accounts; step 4 reuses the tested
loop steward. Ship P0, then P1 (open-ended `needs_input` questions + scheduled
check-ins + journaling/growth) per the plan doc.

## 6. Non-goals for P0 (explicitly later)
Priorities/dependencies/subtasks; open-ended question prompts (`needs_input`);
scheduled check-ins; standing-questions ledger; calendar-to-vision. P0 is the
board + owner/status + the unified Decision Inbox + AI-as-workflow execution.
