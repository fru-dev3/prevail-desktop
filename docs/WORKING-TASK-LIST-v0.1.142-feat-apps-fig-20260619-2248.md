# Working task list — v0.1.142 · branch feat/apps-fig · 2026-06-19 22:48

Apps-focused feedback for the FIG updates. Persisted running list so fast incoming
feedback is never dropped. Append under "Pending"; move to "Done" when shipped
(note files touched + how verified).

Theme: make app connections ACTUALLY authenticate and pull data end-to-end. No
dead links. Per method (API / OAuth / browser / MCP), the user must be able to
authenticate, the auth is saved, and Prevail can then run it autonomously.

## NORTH STAR (governs EVERY design decision: tasks, apps, loops, all of it)
The human's job is to APPROVE / ASSIGN, not to manage. Prevail does the work, by
any means necessary, under governance (approval gates). For every feature ask:
- How agentic is it? Does the agent actually DO the thing end to end?
- Does it CREATE A SKILL / LESSON from doing it (saved on the relevant entity)?
- Is it REPEATABLE - next time the agent reuses the skill, no re-deriving?
- Does the agent WRITE THE NOTES (what it did, what it learned, where it saved)
  so it never repeats itself?
Concretely for TASKS: an AI-owned "Needs you" task (e.g. "Document current business
state + identify opportunities to establish baseline") must, on APPROVE, run a real
workflow: plan -> do the work -> write the report/output -> take the action ->
confirm + save the notes where done -> if skilled work, GENERATE + SAVE a skill so
the next occurrence runs it automatically. Not a passive "working..." that stalls.
This is the same engine behind agentic app connection and self-bootstrapping loops:
agent takes actions + writes lessons + builds skills, human only approves/assigns.

## GUIDING PRINCIPLE (applies to everything below) - BE AGENTIC, DO IT
Prevail must DO the connection, not tell the user what to do. NO instructions like
"Run `uvx workspace-mcp --help`" or "follow the auth flow". Prevail itself:
- spins up the shell and RUNS the commands,
- installs/spawns the MCP server,
- opens the BROWSER and drives the OAuth / login flow (loopback capture),
- captures + saves the resulting tokens/creds (Keychain / app auth dir).
The ONLY thing the user ever does is the irreducible human secret: typing their
own password / 2FA on the real login page that PREVAIL opened for them. Anything a
script or agent can do, Prevail does without asking.
As Prevail performs the connection, it RECORDS the exact ordered steps it took
(commands run, browser actions, where the token landed, the verifying fetch) and
SAVES them as a reusable SKILL on the app. Every app may automate differently;
the saved skill captures that app's specific recipe so the next sync just replays
it. This is the whole point: connect once agentically, reuse the skill forever.

## In progress
- (none yet)

## Pending
- [ ] **Connections must actually authenticate + work (Booking.com case)**: an app
  resolved to method=API (Booking.com, feeds Travel) shows NO way to authenticate -
  just Sync/Re-evaluate that do nothing usable. The user needs, per method:
  - **API**: a clear way to obtain + enter the API key/credentials, saved to the
    Keychain, then a real verifying fetch. If the service has no usable public API,
    the agent should NOT pick API.
  - **Browser automation**: actually open a browser to the site (booking.com),
    let the user log in once, persist the session (storageState), and have a real
    skill that scrapes the needed data on a schedule.
  - **OAuth**: the existing sign-in flow.
  Core ask: no connector should sit as a dead "link" that cannot be made to work.
  The Connection Agent should resolve to a method that CAN be authenticated, and
  the UI must expose the exact auth step for that method, save it, then Prevail
  runs it autonomously. (Booking.com specifically: likely browser, not API.)
  Files to dig into: prevail-cli connect/Connection-Agent (app.tsx/index.tsx),
  runners.ts (browser storageState is currently NOT persisted), connector-probe,
  desktop appspanel.tsx auth UI (auth_env_vars + browser-login + verify).

- [ ] **Apps must show the correct brand LOGO everywhere (not letter fallbacks)**:
  the app rows/cards show first-letter placeholders (A, B, G, P) instead of the
  real brand marks (AllTrails, Booking.com, Garmin Connect, PayPal). The user has
  repeatedly asked for the correct logo at all times. Resolve each connector's
  brand logo (ingestion_connector_logos / logos.json / simple-icons / catalog
  logo) and render it in every app surface (appspanel.tsx AppCard + AppRowLogo,
  the per-domain apps facet panels3.tsx AppRowLogo, connect flow, suggestions).
  Letter avatar only as a last-resort fallback when truly no logo exists.

- [ ] **Connect flow: obvious thinking, name-correct, route to setup, then REAL
  per-method setup + skill generation**:
  - **Obvious processing**: while the Connection Agent researches the method, show
    a clear, unmistakable "thinking / finding the best way" state (not a quiet
    spinner) so the user knows work is happening.
  - **Name correction / fuzzy match**: if the user mistypes or uses a near name
    (apps have similar names), correct/suggest the right app before resolving.
  - **Route to a SETUP page** once resolved, then actually walk the method:
    - API: guide getting the key, enter it, save (Keychain), verify by real fetch.
    - Browser automation: open the browser to the site, log in once, persist the
      session, verify data comes down.
    - MCP: install/run the server, log in once (token auto-refresh), verify a tool
      call returns data.
  - **Generate + SAVE a per-app SKILL while connecting**: encode HOW to get the
    data for this app+method as a skill (e.g. browser: open site -> log in -> grab
    data -> confirm it was saved), persist it under the app's skills/ so the NEXT
    sync just runs the saved skill. Learn/repair as we go. Skills are attached to
    the app and describe the ordered steps per method (browser/API/MCP).
  This is the heart of the FIG apps work: connecting must end with a working,
  authenticated connector whose fetch skill is saved and reusable autonomously.
  (Related to and supersedes the auth depth of item 1.)

- [ ] **PRIORITY / integrity: "Verified" must mean REAL authenticated account data,
  never a fabricated/generic response**: Credit Karma (MCP) showed "Verified. The
  MCP server returned data" with NO login - impossible to have the user's real
  data. Root cause: the fetch gate (`producedRealData` in daemon-sync.ts) counts
  ANY non-empty payload/artifact as success, so a server's help text / "not
  authenticated" error / empty-shaped JSON falsely reads as "real data". Fixes:
  - Verification must require genuinely authenticated, account-specific data tied
    to the user's actual login/token. No login => cannot be verified. Never claim
    success on a generic, error, unauthenticated, or empty-collection response.
  - Harden producedRealData: reject error/auth-required payloads, empty arrays/
    objects (`[]`, `{}`, `null`), help/usage text, and known "not signed in"
    shapes. Prefer a connector-declared success assertion (e.g. expected JSON path
    must exist + be non-empty) over "any bytes came back".
  - The connect flow must actually CAPTURE the user's auth (real login / token)
    BEFORE a verify is even possible; the verify then runs an authenticated fetch
    and must surface the real proof (e.g. "pulled N transactions from <account>"),
    not a vague "returned data". If auth was never done, status stays
    not-verified, never green.
  Absolutely no hallucinated/synthetic data presented as the user's real data.

- [ ] **App as a first-class place: open it, configure it, chat with it**: apps
  appear in the sidebar / main app area; clicking an app should navigate to a
  dedicated app VIEW (the AppFacetPanel / app workspace) where the user can
  interact, configure further, and CHAT with the app's data. Need a clear way to
  click an app card and "go back" into that app view. (AppFacetPanel exists in
  shell.tsx + App.tsx appView state; make the path obvious + complete.)
- [ ] **Suggest domains to attach an app to (+ manual add)**: when connecting/
  configuring, Prevail should SUGGEST which domains the app feeds; if none are
  suggested, the user can add the app to refresh specific domains (the existing
  Domains-fed editor). Make suggestion proactive.
- [ ] **ARCHITECTURE (source of truth = the app folder)**: the app's folder (e.g.
  ~/.prevail/apps/credit-karma) is the canonical source of truth for its data AND
  its skills. Domains only hold a REFERENCE/pointer to the app's data, not a copy.
  Each app owns its own skills (generated at connect time, saved in the app dir).
  Keep all apps work consistent with this: write data + skills under the app;
  domains reference via routes/pointers, never duplicate the source.

- [ ] **Bug: OAuth "Sign in" offered for non-OAuth apps**: Airbnb (method API) shows
  a "Sign in to Airbnb" button that fails with `connector "airbnb" has no oauth
  block in its manifest`. The UI must not offer a method/auth path the connector
  can't actually do. Tie this to the agentic core: for a site like Airbnb (no
  public API/OAuth), Prevail should resolve to and DRIVE browser automation
  (headless ok) itself - open the site, log in (only the human secret from the
  user), persist the session, scrape - rather than offer a broken OAuth button.
  appspanel.tsx: only show Sign-in when an oauth block exists; otherwise show the
  correct method's real flow.

## Spark (not apps, but tracked)
- [ ] **Don't auto-run a spark on page load**: Spark currently generates on mount
  (and again every time you navigate back), wasting credits. Require an explicit
  button press to generate. (spark.tsx: remove the mount useEffect that calls
  generate(count).)
- [ ] **Keep previous sparks + a current tab**: when arriving, KEEP old/previous
  sparks (the archive) visible - a "previous runs" view - and show freshly
  generated ones in a "current" tab. Let the user dismiss / put away to keep it
  clean. Do not wipe history on load.
- [ ] **Better topic-prompt button**: the pencil icon for the optional topic prompt
  looks bad. Design a more creative, attractive affordance for "spark on a topic"
  (distinct from the main Generate button).

## Misc (v0.1.142 follow-ups)
- [ ] **Vault Lock footer: center it, make it live + minimalist**: the indicator
  sits jammed far-right next to the version (text wall). Move it into the centered
  ribbon content next to "CLOUD CONNECTED", minimalist (lock icon + short text).
  Also: toggling Vault Lock in settings must IMMEDIATELY update the footer (it
  doesn't now). Fix: settings6 Vault Lock toggle should dispatch
  `prevail:vault-lock-changed` (shell.tsx already listens) and actually set the
  state. shell.tsx BunkerRibbon: reposition.

- [ ] **Nav counts must be PER-DOMAIN (not global)**: the top-nav badges (Needs you,
  Work, Insights, Loops) show global totals (e.g. Work 106, Insights 29, Loops 24)
  even when a single domain is selected, but the domain only has a few (Wealth =
  15 tasks, 5 insights). When a domain is selected the counts must reflect THAT
  domain only, and update when switching domains (wealth->tax->health). Zero =
  show nothing. App.tsx: dueAlert(work_count), recCount, loopCount must scope to
  selectedDomain when one is active (global only on General/no-domain). work_count
  Rust may need an optional domain filter.

- [ ] **Loops must be agentic: bootstrap a baseline instead of stalling**: a loop
  run reported "First run: no baseline exists. Need to establish what we're
  tracking before the loop can surface gaps" and just stopped. Instead the loop
  should ACT: create the baseline itself, or file tasks to establish it so the
  next run picks them up. A loop's job is to make forward progress by any means
  necessary (under governance/approval). No passive "no baseline" dead-ends.
  Files: daemon-loops.ts / loop runner + loop prompt. First-run with no baseline
  should output actionable tasks (or build the baseline) + record it.
- [ ] **Activity page: match the standard header + polish**: Activity uses a custom
  header (plain title, no icon chip, no right-side ghost-icon art) unlike every
  other Settings page. Make it use SettingsHeader (icon + ghost art on the right).
  Minimize the REFRESH button (icon-only). Refine the filter row (All/Loop runs/
  Executed/Tasks/Briefings/Syncs + domain select + count) to a more sophisticated
  layout. File: activitypanel.tsx.

- [ ] **Work Board: Icebox as a real column + fit columns on screen + verify moves**:
  - Selecting "icebox" from a card's status dropdown did nothing in v0.1.142 because
    the BACKEND rejected it (icebox was not in VALID_STATUS until this branch). The
    backend fix already landed this session (tasks.rs VALID_STATUS += icebox), so
    the dropdown move will work in the next build - VERIFY it does.
  - Make ICEBOX a board COLUMN (5th column after Done, or styled distinctly) so the
    user can DRAG a card into it, not just pick it from a dropdown / filter view.
  - Fit all columns on screen without much horizontal scroll (reduce column width a
    bit; a little scroll ok, not a lot).
  - Double-check that moving a card to EVERY stage (todo/doing/review/blocked/done/
    icebox) actually persists - not just icebox. File: boardpanel.tsx.

- [ ] **Approve-with-context (beautiful) + delegate to the orchestrator**: on a
  "Needs you" decision (e.g. "Verify and pay Q2 2026 estimated taxes if due"),
  the user wants to Approve & run AND optionally ADD CONTEXT first (e.g. "already
  paid this" / "here's what I did" / "don't worry, it's done"). The orchestrator
  joins that context with the task and acts: complete/file it, take the action,
  put it away, and LEARN (write notes + generate skills). The add-context UI must
  be beautiful - a pop-up / expanding chat box, not a plain field. See the new
  VISION doc; this is the in-app entry to the orchestrator. (Tie eventually to MCP/
  Telegram so the same delegation works from anywhere.)

- [ ] **Bulk "Assign to Agent" (streamline delegation)**: each task has a per-row
  assign-to-agent button; with ~100 tasks that is unworkable. Add a BULK "Assign
  all to Agent" action (assign every me-owned task to AI at once, EXCEPT the ones
  that need the human / are in the Needs-you/Decision inbox). Consider an option to
  assign-to-agent BY DEFAULT for new auto-generated tasks. The human then only
  reviews "Needs you". This is the core delegation move: hand the board to the
  orchestrator, keep only the exceptions. File: boardpanel.tsx + a bulk owner-set
  path (tasks_set_owner per task, or a new bulk command).

- [ ] **Overdue = loud alert color**: overdue tasks must stand out with an alert
  background (red/amber tint), not look like every other row. Apply to the list/
  calendar/board overdue rows + the OVERDUE section. File: boardpanel.tsx.
- [ ] **Make agent-vs-me delegation OBVIOUS + automatic (key)**: rows show a bot
  icon (agent-owned) or person icon (me-owned), but it is unclear what that means
  or what the user should do. The model must be obvious and automatic:
  - Agent-owned tasks are WORKED by the orchestrator autonomously (they run the
    plan->do->file->learn workflow) - the user does NOT have to click run.
  - A task only comes to ME (Needs you) when the orchestrator needs my input; then
    it visibly moves to my side. When I'm done it goes back to the agent or done.
  - Make the visual distinction unmistakable (clear owner badge/color, "agent is
    working" state, and the handoff direction). Resolve the confusion: an overdue
    agent task in To-do should already be getting worked, not waiting on a manual
    click. Ties to P2 orchestrator + the bulk-assign item.

- [ ] **Task creation UX is broken/unclear**: user typed a title ("book flight to
  book cruise trip"), hit Create/Add, and it just vanished - no confirmation, the
  new task was not shown, no detail surfaced. Either it created silently to a
  domain not in the current view, or it failed quietly. Fix: after Add, CONFIRM it
  was created (toast/inline), SHOW the new task (scroll to / highlight it, or open
  its detail), and if the current filter would hide it (e.g. assigned to Travel
  while viewing another domain) make that obvious or switch to show it. Rework the
  add design to be clear and trustworthy (not a one-shot input that empties with
  no feedback). File: boardpanel.tsx (the "Add a task" input + Add handler).

- [ ] **BIG: Connectors master-detail redesign (Claude-Desktop-style)**: adopt the
  list + detail layout the user loves. LEFT: a connectors list, grouped (e.g.
  Connected / Web / Not connected), each with its real brand logo, searchable, with
  a + to add. RIGHT: the selected connector's full detail/config pane:
  - description, method, status, Disconnect/Delete, overflow menu.
  - for MCP: per-tool permissions (allow / needs-approval / deny) like the ref.
  - schedule + refresh detail: next refresh, current/last refresh, past runs.
  - folder path (the app dir, source of truth) + reveal, domains fed (edit),
    sync now, the full auth/setup flow, test everything.
  Clicking a connector shows its config on the right (and a way to open its CHAT /
  workspace - chat with the connector on the chat page). This is the centerpiece
  of the apps area; it unifies appspanel.tsx + the AppFacetPanel workspace into one
  master-detail surface. User: "this is a big one." Plan it as its own surface,
  reuse the existing data (engine_apps_list, runs, schedule, domains, mcp tools).
  ENRICHED (ChatGPT Carta-CRM ref): rich detail pane - big logo + name + short
  description + "Try in chat" CTA; optional hero/banner visual; longer description;
  an "Information" section (Developer, Category, Website, Privacy Policy, Terms with
  external-link icons); app images where available. CONNECT FLOW polished + agentic:
  Connect -> a clean disclosure step (you're in control / what data is shared /
  method) -> Continue -> Prevail OPENS the login page (browser-login engine) ->
  user logs in -> returns -> auth saved -> data pulled. Sophisticated, not a form.

## SHIPPED as v0.1.143 (2026-06-20, signed + notarized, live)
Release: github.com/fru-dev3/prevail-desktop/releases/tag/v0.1.143 · website latest
download resolves to it · Gatekeeper: Notarized Developer ID. Tested: desktop tsc
0 errors, cargo check clean, CLI 30/30 tests, local build OK, CI build success.
In it: connectors master-detail redesign (list+detail, browser Log-in, info
section, Open-in-chat) · agentic browser-login (real browser, persisted session)
· honest verify gate (no fabricated "verified") · loops bootstrap a baseline ·
connect-flow polish (bolder thinking, fuzzy "did you mean", suggested domains) ·
Work Board (overdue alert, add-confirm, bulk Assign-to-Agent, Icebox column,
AGENT/ME clarity) · per-domain nav counts · OAuth-guard · Vault Lock footer ·
real logos everywhere · Spark (no auto-run, Current/Previous, Wand topic).

## DEFERRED (need your design input / too big for unattended build - next session)
- ORCHESTRATOR (P2/North Star): "Approve & run" on an AI task actually executing
  plan->do->file->confirm->learn, with the beautiful approve-with-context box, and
  agent-owned tasks auto-running. This is the big engine feature; needs your review
  of the design (see VISION doc) before building. The visual delegation (AGENT/ME,
  bulk-assign) shipped; the autonomous execution did not.
- SKILL GENERATION on connect/run (P1): persist a per-app skill recipe from each
  successful run so the next sync replays it. Browser session persistence shipped;
  full skill-recording did not.
- MCP/Telegram orchestrator entry points (P3).
- Connectors detail: real hero/banner images per app (no image source wired yet).

## Done (pre-release detail)
- [x] **App workspace navigation** (appspanel "Open" button -> prevail:open-app ->
  AppFacetPanel workspace; matches sidebar + per-domain facet). Stepping stone to
  the master-detail redesign above.
- [x] **Browser-automation agentic auth (engine slice)**: runner reuses saved
  session (auth/state.json); runBrowserLogin opens a real browser for the one
  human login + persists session 0600; CLI `connectors browser-login <id>` +
  Tauri engine_app_browser_login wire it. (UI button = next.)
- [x] **Work Board Icebox column + fit + verified status moves** (boardpanel).
- [x] **Activity page standard header + minimal refresh + toolbar polish** (activitypanel).
- [x] **Nav counts scoped per-domain** (App.tsx + tasks.rs work_count optional
  domain): Work/Insights/Loops badges reflect the selected domain (global only on
  General); update on domain switch.
- [x] **Vault Lock footer** (shell.tsx + settings6.tsx): centered + minimalist (lock
  + short word, not floated far-right); toggle now dispatches
  prevail:vault-lock-changed so the footer updates live.
- [x] **Integrity gate hardened** (daemon-sync.ts producedRealData + tests): auth-
  challenge / error / help / empty ([],{},null) responses no longer count as real
  data, so "verified" can't be faked when no login happened. 22 tests pass.
- [x] **Real app logos everywhere** (panels3 resolveAppLogo/AppRowLogo shared +
  appspanel + appconnect): brand marks instead of letter placeholders.
- [x] **OAuth-mismatch button fixed** (appspanel): Sign-in only for true OAuth apps;
  clear guidance instead of the Airbnb "no oauth block" dead button.
- [x] **Spark UX** (spark.tsx): no auto-run on load; Current/Previous tabs from the
  on-disk archive (no model call to populate); nicer Wand2 "Topic" pill.
- [x] **Browser-automation session persistence (engine)** (runners.ts): scrape
  runner reuses a saved login session (auth/state.json); new runBrowserLogin opens
  a real browser for the user's one login, saves the session 0600 for headless
  reuse. (Wiring: CLI cmd + Tauri + UI = in progress.)
