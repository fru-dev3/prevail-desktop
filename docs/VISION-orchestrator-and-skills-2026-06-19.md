# Vision + plan: the governed orchestrator (start with the end in mind)

Branch feat/apps-fig · 2026-06-19. This is the end-state we are building toward.
Every task in the working list should be judged by how much it moves us here. The
companion checklist is WORKING-TASK-LIST-v0.1.142-feat-apps-fig-20260619-2248.md.

## 1. The end state (one sentence)
You delegate; Prevail does the work. A single governed orchestrator takes an
instruction (from the app, MCP, or Telegram), plans it, uses the right skills /
apps / tools / actions to actually do it, files the results in the right place,
confirms, and writes down what it learned as a reusable skill so it never
re-derives next time. Your only job is to approve, assign, or add a little
context. (Call it the orchestrator, not an "agent".)

## 2. The three invariants (apply to tasks, apps, loops, everything)
1. AGENTIC: the orchestrator takes the action end to end. No "here is what you
   should do" hand-offs, no passive "working..." that stalls. The only thing the
   human ever does is the irreducible bit: approve, assign, add context, or type a
   secret/2FA on a real login page that Prevail opened.
2. SKILLS AS MEMORY: doing something once produces a SKILL (the ordered recipe)
   and LESSONS/NOTES (what happened, what to watch for, where things were saved),
   stored on the entity that owns them. The next occurrence REPLAYS the skill.
3. SOURCE OF TRUTH = THE ENTITY'S FOLDER. An app (~/.prevail/apps/<id>) owns its
   data + its skills. A domain owns its state + its loops + its tasks. Domains
   only POINT to app data, never copy it. Skills live with whatever they automate.

## 3. The model
- ENTITIES: apps (connectors), domains, tasks, loops, skills. Each is a folder of
  markdown + jsonl that is the source of truth (already true today; keep it true).
- SKILL: a saved, replayable recipe. Frontmatter says runner (api/browser/mcp/cli/
  llm) + the ordered steps + where output lands. Generated when the orchestrator
  first figures out how to do a thing; reused thereafter. (connector-skills.ts +
  the runners already exist; skillgen daemon already learns skills - extend it.)
- LESSON / NOTE: free-text memory the orchestrator writes after acting (the distill
  + intent ledger already capture chats; add an explicit "what I did + learned"
  note on task/app completion).
- GOVERNANCE: an autonomy level per task/loop/app (read-only / draft / act) and a
  Decision Inbox ("Needs you") for anything consequential. The orchestrator only
  acts within its granted autonomy; everything above the line waits for Approve.

## 4. The orchestrator (one thing, many entry points)
Given INSTRUCTION (+ optional CONTEXT the human added), it:
  1. PLAN: read the entity's state + relevant skills/lessons; decide the steps.
  2. RESOLVE TOOLS: which saved skills apply; which apps to pull from / sync;
     which actions to take (file write, app fetch, browser scrape, MCP tool call).
  3. EXECUTE under governance: run the steps; for browser/MCP/API auth, drive it
     (open the browser, spawn the server, run the command) - human only logs in.
  4. FILE + CONFIRM: write the output/report to the right place (the entity's
     folder), route pointers into domains, mark the task done / loop advanced.
  5. LEARN: write a lesson note + GENERATE or UPDATE the skill so the next run is
     a replay, not a re-derivation.
Entry points, same orchestrator behind all:
  - In-app: Work Board "Approve & run", the Decision Inbox, a loop firing, an app
    connect/sync.
  - APPROVE-WITH-CONTEXT: a beautiful expanding chat/pop-up on a decision where the
    human adds commentary ("already paid this", "here is what I did", "skip it").
    The orchestrator folds that context into the plan and acts accordingly.
  - MCP / Telegram (the end state): "go look at my taxes and create the 2026
    briefing" - the orchestrator knows where to look, what skills to use, which
    apps to pull, where to file. (prevail mcp server + telegram bridge already
    exist; expose orchestrator actions as MCP tools.)

## 5. Building blocks that already exist (compose, don't rebuild)
- Runners (api/browser/mcp/cli/llm/a2a) + the new browser session persistence +
  runBrowserLogin (this branch) = the EXECUTE layer.
- connector-skills.ts + scaffoldCommunityApp = skills live on apps; extend to
  GENERATE a skill at connect time and after each successful run.
- daemon-loops.ts (loops), daemon-sync.ts (app refresh), skillgen/taskgen/distill
  daemons = the autonomous heartbeat; make their first-run behavior bootstrap
  (create baseline + tasks) instead of stalling.
- Decision Inbox / Needs-you + autonomy levels = governance.
- prevail mcp server + telegram/webhook bridges = the remote entry points.
- The fetch-gate hardening (this branch) = "done/verified" only ever means real
  authenticated results, never fabricated - the integrity floor under all of it.

## 6. Path (phases - each shippable)
P0 (now, this branch): integrity floor + agentic auth primitives + the UI honesty
   (no dead links, real logos, per-method real auth, browser login that persists).
   [in progress]
P1: SKILL GENERATION on connect + after each run. An app/task that succeeds writes
   its recipe; the next run replays it. Loops bootstrap a baseline instead of
   stalling. "Verified" requires a connector-declared success assertion.
P2: ORCHESTRATOR for tasks. "Approve & run" on an AI task actually executes the
   plan->do->file->confirm->learn loop, with the beautiful approve-with-context UI.
P3: ONE orchestrator surface + MCP tools. Expose plan/execute/file as MCP tools so
   Telegram ("look at my taxes, build the 2026 briefing") routes to the same
   orchestrator. Cross-entity orchestration (pull from apps, write to domains).
P4: Self-improvement: lessons feed back; skills get refined; the system needs less
   human approval over time for the things it has proven it can do safely.

## 7. How we decide what to build next
For any candidate change, ask the three invariant questions (agentic? builds a
skill/lesson? repeatable + writes notes?). If a change makes the product MORE of a
manual task board for the human, it is wrong. If it lets the human delegate more
and manage less, it is right.
