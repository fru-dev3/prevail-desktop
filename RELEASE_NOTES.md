# Prevail v0.1.142

Apps that connect for real (with MCP), one consistent vault, and a broad sweep of UI and clarity fixes from a hands-on review.

## New

- **Fetch-gated connections.** An app now reads "Connected" only after it has actually pulled real data at least once. Until then it shows "Authorized, verifying" (amber), so a connector can no longer look green without ever fetching anything.
- **MCP guided setup.** Connecting an app over MCP now walks you through it: run the server, paste any keys it needs (stored in your Keychain), then Verify, which spawns the server and calls one tool. The card turns green only if it returns real data.
- **Generic credentials for any connector.** Per-app credential fields are now driven by each connector's manifest, so any key-based app gets the right inputs, not just the few that were hardcoded.
- **Delete an app.** You can remove a connector entirely (so a duplicate or mistaken one can be recreated), with an inline confirm. Bundled connectors stay protected.
- **Spark, upgraded.** An optional topic prompt (hidden behind a small icon) lets you spark on a subject like "ancient Rome" or "deep-sea biology"; otherwise it stays fully random across dozens of fields and levels (grade-school to PhD to trade-school). Output is cleaned of stray terminal characters, every spark is archived to a file with its model and settings, and an anti-repetition pass keeps the stream from circling the same ideas.
- **Icebox for tasks.** A new task status to set something aside that you will not do but do not want marked done. Iceboxed tasks drop out of the active board and can be restored from an Icebox view.
- **Vault Lock indicator.** The footer now shows whether Vault Lock is on, so you always know reads and writes are confined to your vault.

## Fixed

- **One consistent vault.** The app, the engine, and the background daemons now all read the same vault from a single source of truth. This fixes empty history, blank activity, missing usage, and domain lists that did not match between screens.
- **Work badge and count.** The Work count badge now renders as a proper colored pill like the others, and the number matches what the board actually shows instead of inflating.
- **Sync feedback.** Running a sync now shows a clear working state (spinner, status, and a progress sweep) instead of looking frozen.

## Improved

- **Loop Board.** Quieter rows with the detail tucked into a click-to-expand panel, where you can Run, Edit, Archive, or Delete a loop. Grouping and sort now behave consistently, and the "Group by domain" selection is obvious.
- **Runtimes.** Health reads at a glance now: valid is green with a check, not-installed is clearly distinct. Provider icons are larger and legible, and runtimes are split into Cloud and Local sections.
- **Daemons.** A running daemon shows a bright green status so you can tell at a glance what is actually working, without expanding anything.
- **Council.** The panel diagram moves left and a live stats column shows the make-up of your council (open-source vs cloud, providers, local vs remote, and a relative cost estimate) that updates as you add or remove models.
- **Recommendations.** The learn loop now shows when the next pass runs, not just the last one.
- **Activity.** Every entry is clickable to drill into the detail behind it.
- **Usage.** A Refresh button to pull the latest numbers on demand.
- **Omega.** Cleaner rendering (no raw markup) and a short note explaining what Omega is versus your declared ideal state.
- **Preferences.** The runtime picker collapses independently with the chevron on the left, so you can close one without opening another.
- **Settings headers.** A tasteful right-side visual fills the previously blank space on every settings page.

---

Built on Apple Silicon. First launch is unsigned for this channel: right-click the app and choose Open, then confirm.
