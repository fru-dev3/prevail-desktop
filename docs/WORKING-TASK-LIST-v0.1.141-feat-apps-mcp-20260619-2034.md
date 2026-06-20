# Working task list — v0.1.141 · branch feat/apps-mcp · 2026-06-19 20:34

Persisted running list of live-walkthrough feedback so fast incoming items are
never dropped. Append new items under "Pending"; move to "Done" when shipped
(note the files touched). Successor to the earlier FEEDBACK-WORKLIST.md.

## In progress
- [ ] **Rebuild + relaunch** the release .app with all batched changes (spark,
  sync effect, loops) so the user can see them.

## Pending
- [ ] **Spark — optional topic prompt (minimalist)**: a small "expand" icon next to
  the Spark button reveals a single prompt field. If the user types a topic (e.g.
  "ancient Rome, politics, culture") and hits Spark, sparks are themed to it. If
  not expanded / empty, spark fully random as today. Field must NOT be always-on.
- [ ] **Spark — anti-repetition / diversity over time**: models (esp. when re-hit)
  keep returning the same answers / same cluster of thinking. Use the spark history
  (archive + saved + session) to feed an "avoid these recent ones, go somewhere
  genuinely different" list into the prompt, rotate away from recently-used fields,
  and otherwise maximize spread across the corpus. This is WHY history is kept.
- [ ] **Loop Board — too busy / wall of text**: redesign to a minimalist layout
  that keeps the content (name, domain, cadence, autonomy, next-run, run, toggle)
  but reads cleanly, not as a dense text wall. Want superior design.
- [ ] **Loop Board — clickable loop detail**: a row should open a loop DETAIL page
  where you can edit / delete / archive the loop (today clicking only jumps to the
  domain's Loops tab). Check existing edit/delete/archive capability; add what's
  missing (may need engine support for delete/archive).
- [ ] **Tasks — add an "Icebox" status**: task status dropdown is todo / doing /
  review / blocked / done. Add a set-aside state (proposed name: "icebox") for
  tasks the user won't do but doesn't want marked done — moves them out of the
  active list without completing. Touches the status enum in the work board UI +
  tasks backend (_tasks.md status). User open to the name (icebox / shelf / someday).

## Follow-ups (noted, not yet requested)
- Spark archive BROWSE view (read `spark_archive_read` into a UI). Append is done;
  no viewer yet.

- [ ] **Recommendations — show next-run nicely**: the daemon status reads "not run
  yet"; also surface WHEN the next run is, with a thoughtful format (not raw text).
  File: `recommendationspanel.tsx`.

- [ ] **Omega — formatting + clarity** (`omega.tsx`): (1) the auto block renders raw
  `<!-- omega:auto:start -->` / `:end` HTML-comment markers as visible text; hide/
  render them nicely. (2) Add a clear definition of what Omega IS vs the
  Constitution: Constitution = what you declare (your values); Omega = what Prevail
  has DERIVED/learned about you from how you actually work. They should align, but
  Omega may surface non-obvious truths that aren't explicit in the Constitution.

- [ ] **Usage — refresh button + double-click**: add a manual Refresh button on the
  Usage panel (incl. empty state). Also: opening Usage seems to need two clicks;
  fix so one click opens it. (Live update already works via prevail:usage-updated.)
- [ ] **Nav Work badge** — ALREADY teal `bg-ai` in current source (matches Insights/
  Loops); the plain "93" is the old Jun-18 instance. Verify after relaunch. Optional:
  make Work always-teal regardless of overdue/today urgency (pending user choice).
- [ ] **Domain Preferences — collapse behavior** (find component; per-domain prefs
  CLI/provider/model): (1) chevron/collapse icon must ALWAYS be on the LEFT (today
  the provider rows put it on the right). (2) add a collapse-ALL control. (3) make
  each section independently collapsible — collapsing one must NOT force another
  open (today it behaves like a single-open accordion). User previously asked for
  left-chevron design.

- [ ] **CRITICAL — vault location inconsistency**: Intents/history shows "no intents"
  despite real conversations, and Settings domain lists don't match the homepage
  sidebar. Strong signal the UI vault path and the engine/daemon default vault
  diverge. Active vault shows `/Users/frunde/Downloads/2026 June/vault-1-demo`
  (screenshot) while daemons ran on `/Users/frunde/Documents/vault-1-demo`. There
  are ALSO two running app instances (old translocated download + my new build)
  on different vaults. MUST converge on ONE consistent vault path everywhere
  (UI prop == ~/.prevail config default == daemon --vault). User has stressed this
  before. Investigate: bootstrap vault file vs config vaultPath vs per-command
  `vault` param vs engine default resolution.

- [ ] **Reminders daemon won't stay on**: toggling Reminders shows "Starting" then
  flips back off ("idle · no due tasks"). Either the daemon start fails silently or
  it self-stops when there are no due tasks. Investigate reminders_daemon_start/
  status; may be downstream of the vault-path issue (wrong/empty vault = no tasks).

- [ ] **Daemon status color** (`settings`/daemons panel): a running daemon's status
  dot is grayscale/black like a disabled one. Use a bright (optionally pulsing)
  green when ON/running so it's obvious at a glance without expanding; grayscale or
  brown/amber when disabled/idle. Applies to Distill, Task gen, Skill learning,
  Intent distillation, Reminders rows.

- [ ] **Activity — blank + drill-down**: Activity shows "no activity" despite daemons
  running (SAME vault-split root cause; should populate once vault is consistent).
  ALSO: make each activity entry clickable to drill into what happened behind it
  (the loop run / sync / briefing detail). Design + plan the drill-down.

- [ ] **Settings headers — fill the blank right side** (`sectionutil.tsx` SettingsHeader,
  used on every Settings page): title+description sit left, right side is empty.
  Add a tasteful right-side visual (large ghost icon / subtle gradient / motif)
  that fills the space per page. Sweep every page. Keep it classy, not noisy.

- [ ] **Runtimes — provider icons too small**: the provider strip (7 icons w/ green
  check) in the Runtimes header is too small to identify (which is OpenAI vs
  Ollama?). Make the icons noticeably bigger / legible. File: settings runtimes
  panel (settings3/settings7-ish) + providermarks.

- [ ] **Color-code status EVERYWHERE (theme)**: recurring ask. Stop using grayscale
  for status. Valid/healthy/on = clear GREEN + tick; invalid/not-installed/off =
  clearly distinct (red/amber/brown). Applies to: runtime health badges (VALID vs
  NOT INSTALLED — currently both gray), daemon on/off dots (bright green when on),
  and any other valid-vs-invalid indicator. One glance should tell the state.

- [ ] **Runtimes — split Cloud vs Local**: break the CLI runtimes list into two
  collapsible groups: Cloud models (Claude, Codex, Antigravity, OpenRouter) and a
  dedicated **Local models** section (Ollama, oMLX, LM Studio, + others) so the
  user can come in and configure local-only models in one place / see what local
  is available. Each group its own collapsible.

- [ ] **Council — diagram left + live stats right** (`councilpanel.tsx`): move the
  radial panel diagram to the LEFT; add an aggregate stats column on the RIGHT that
  recomputes as models are added/removed: % open-source vs cloud, est. token
  burn/hr, total cost if all run at once, panel size, providers represented, local
  vs remote split, etc. Make it visually rich.

- [ ] **Skills — show learned skills + seed system skills**: (1) surface skills that
  the daemons INFER/learn over time here (not just user-uploaded), so the page
  isn't blank. (2) Consider bundling a small set of curated "system skills" shipped
  with the app so first-run isn't empty. Open question: what good default skills
  are (user is skeptical skills matter much) — propose a short useful set.

- [ ] **Work count 107 vs empty board + Needs-you clutter**: Work badge says 107 but
  the board shows 0 in every column (filtered to a domain). Either work_count
  over-counts (counts checklist lines / build/ dir / done items / all-domains while
  board is domain-filtered) or the badge should reflect what the board shows.
  Reconcile. ALSO: "Needs you" + "Work" as two nav items is confusing/busy — clarify
  the difference or fold Needs-you into Work; keep the nav lean and simple.

- [ ] **Vault Lock footer indicator + default ON**: show a lock icon/indicator in the
  bottom banner reflecting Vault Lock state (on = vault-only read/write respected).
  Make Vault Lock default ON so reads/writes are confined to the vault by default.
  Footer is the "CLOUD CONNECTED" status bar (App.tsx / shell). Lock state from
  bunker/vault-lock setting.

- [ ] **Apps — delete a connector**: no way to fully delete/remove an app (only
  edit). User has duplicate AllTrails apps and can't remove one. Add a Delete
  action on each app (engine `connectors remove <id>` exists in CLI — wire a
  Tauri command + a Delete button in the app detail, with confirm).

## Done
- [x] **Work count reconciled** (tasks.rs work_count): now counts top-level open tasks
  over the SAME domain enumeration as the board (list_domain_names + tasks_read),
  excluding done/icebox — so the badge matches the board instead of inflating (107).
- [x] **Work badge color FIXED (verified on screen)**: now a teal bg-ai pill like
  Insights/Loops. Root cause: only Work used conditional bg-danger/bg-warn classes
  that Tailwind didn't generate, so with overdue tasks it rendered white-on-nothing.
- [x] **Vault consistency (keystone)**: VERIFIED — new build boots on Documents vault,
  domains/data back. config.json single source of truth + boot/switch checks.
- [x] **Vault consistency (keystone, in progress)**: config.json is now the single
  source of truth. Aligned bootstrap-vault.txt + config.json to
  /Users/frunde/Documents/vault-1-demo (the real 13-domain v4 vault, chosen by
  user). Code: engine_config_vault get/set + boot prefers config + switch writes
  config so UI == engine == daemons always. (Was: localStorage[Downloads] vs
  config[Documents] split → blank history/activity/usage, wrong domains.)
- [x] **Sync "working" affordance** (`panels3.tsx` domain Apps facet + `index.css`):
  SYNC button only swapped text with no animation. Added button spinner, pulsing
  accent status dot, accent row tint, and an indeterminate progress sweep
  (`.sync-sweep`) along the row's bottom edge.
- [x] **Spark formatting — strip junk characters** (`spark.tsx`): bodies showed
  leaked ANSI/terminal redraw escapes (`conti�[5D�[K continuing`), worst on
  ollama open models. Added `reconstructTty()` (replays cursor-back/erase ops so
  fragments aren't duplicated) + `sanitizeModelText()`; applied before parsing.
- [x] **Worklist naming**: this file (version + branch + date/time in the name).
- [x] **Spark randomness** (`spark.tsx`): added code-picked SPARK_FIELDS (40 fields
  across film/art/history/religion/philosophy/trade/etc.) + SPARK_REGISTERS
  (grade-school → PhD → street-smart); injected into the prompt per spark so a
  batch spans all of life. Relaxed the old no-religion/politics rule (neutral, no
  partisan stance / no targeting a living person).
- [x] **Spark archive** (`appcmds.rs` + `lib.rs` + `spark.tsx`): new
  `spark_archive_append` (JSONL append to `<vault>/_sparks.jsonl`, never loaded
  into context) + `spark_archive_read` (bounded, newest-first). Every generated
  spark archived with text, ts+ISO, model, field, register, batch, seed. Fire-and-
  forget so it never blocks generation.
- [x] **Loops selection obvious** (`loopboard.tsx`): "Group by domain" now uses a
  solid accent fill + check icon when active (was a faint soft tint).
- [x] **Loops sort within groups** (`loopboard.tsx`): added `orderedDomains` so the
  active sort + direction orders the GROUPS and the rows within them coherently,
  instead of looking like one flat list got re-sorted.
