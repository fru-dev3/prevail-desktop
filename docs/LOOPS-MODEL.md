# Loops — the agentic model (decision)

**Status:** decided + implemented (desktop UI + engine guardrail wiring) on
`feat/monday-feedback-0615`. Resolves the Monday-feedback Loops items (L1/L2/L3).

## What a loop is
A loop is a **standing agent** for a domain — not a one-off task. Each loop has a
**goal** (`purpose`), a **cadence** (how often it's evaluated), a **guardrail**
(how much it may do on its own), and the domain's **Desired state** as its target.

## What happens when it's enabled / runs
On its cadence (or "Run loops now"), the engine steward (`daemon-loops.ts`):
1. Reads the domain `_state.md` + long-term memory + the distilled cross-session
   **intents** + the domain's **Desired state**, and the loop's own **run history**.
2. Measures the gap to the desired state and decides the next concrete steps —
   persisting: it doesn't repeat tried actions, judges whether the gap is closing,
   and escalates/changes approach when stalled.
3. Emits actions, each tagged `task` (file it) and `needs_approval` (gate it),
   **bounded by the loop's guardrail** (below).
4. Records the run (note, actions, tasks created, done?) in `_loops_runtime.json`
   → shown in the loop's **Run history** in the UI.

## Guardrails (the `autonomy` field) — what it may DO on its own
| Level | Behavior |
|---|---|
| **Suggest only** | Proposes next steps. Files nothing, acts on nothing. |
| **Create tasks** | Files concrete steps as tasks in the domain. No external actions. |
| **Act with approval** (default) | Can act through connected apps, but every consequential step waits under "Needs your approval". |
| **Autonomous** | Acts within guardrails without asking; spend/contact/irreversible still need approval. Everything logged. |

Consequential steps (spend money, contact someone, irreversible, or a decision
only the user can make) **always** queue under "Needs your approval", regardless
of guardrail. Approve → it acts via your connectors and files a task; or send it
to Tasks; or dismiss. This is the gate — nothing irreversible fires unprompted.

## How it ties to Tasks
`task`-flagged actions become real tasks in the domain's `_tasks.md` (deduped).
Approved approval-actions also become tasks. So Loops are the engine that keeps
Tasks populated with the right next steps, and Tasks is where you work them.

## What shipped for this
- **UI (loopspanel.tsx):** full-width; a collapsed "How loops work" explainer; the
  create flow now captures **goal + guardrail** (not just a name); each loop shows
  its guardrail badge, an autonomy selector, and a **Run history** view; ON/OFF
  toggles (no Start/Stop text).
- **Model (loops.ts):** `autonomy` field + labels, backward-compatible.
- **Engine (daemon-loops.ts):** the steward prompt now states the loop's goal +
  guardrail and instructs the model to set `task`/`needs_approval` accordingly.

## Not yet (future)
- A per-loop "tools it may use" allow-list (today tool access is the connector set
  available to the domain; guardrail governs whether it acts).
- Auto-execute for the "Autonomous" level without the desktop "Execute" click
  (currently execution is user-triggered via `loop_execute_action`).
