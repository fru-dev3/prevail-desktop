# Prevail v0.1.143

The apps area, rebuilt around one idea: a connection is not real until your real credentials pull your real data. Plus a redesigned connectors workspace, an honest verify gate, and a sweep of Work Board and Spark fixes.

## New

- **Connectors workspace (master-detail).** The Apps area is now a clean two-pane layout: your connectors on the left (real brand logos, grouped by status, searchable), the selected connector's full config on the right - method, schedule and refresh detail, the folder that is its source of truth, the domains it feeds, recent runs, and the right auth flow for its method. Each connector has an "Open in chat" button to talk to its data.
- **Agentic browser login.** For sites with no public API (Airbnb, Booking, and the like), Prevail now opens a real browser to the login page, you log in once (the only step that is yours), and it saves the session so every later headless sync is already signed in. No more dead "connect" links.
- **Honest verify.** A connection only reads "verified" when it actually pulled real, authenticated data. A server's "not authenticated", an error, a help message, or an empty result no longer counts as success, so a connector can never look connected when you never logged in.
- **Smarter connect flow.** Researching the best way to connect is now unmistakably alive (not a quiet spinner), it catches mistyped or near app names ("did you mean..."), and it suggests which domains the app should feed, editable before you finish.
- **Work Board, streamlined.** Overdue tasks now stand out in a loud alert color. Adding a task confirms it and jumps to where it lives so it never silently vanishes. A bulk "Assign all to Agent" hands the board over in one click. Icebox is a real column you can drag to. Owner is unmistakable: clear AGENT vs ME badges with "Hand to agent" / "Take back".

## Fixed

- **Loops bootstrap instead of stalling.** A loop with no baseline now files the concrete tasks to establish one (so the next run has ground to work from) rather than reporting "no baseline exists" and stopping.
- **Per-domain counts.** The Work, Insights, and Loops badges in the top nav now reflect the domain you are on, updating as you switch domains, instead of showing a global total.
- **OAuth sign-in** is only offered for apps that actually use OAuth (no more "Sign in" buttons that fail).
- **Vault Lock** in the footer is centered and minimal, and updates the instant you toggle it.

## Improved

- **Real brand logos** for every connector, everywhere (no more letter placeholders).
- **Spark** no longer auto-runs on open (saving credits); it opens to your previous sparks with a Current / Previous split, and the topic prompt has a nicer "Topic" control.
- **Activity** uses the standard page header and a cleaner toolbar, and every entry drills into its detail.

---

Built on Apple Silicon, signed and notarized.
