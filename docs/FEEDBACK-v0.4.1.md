# Prevail v0.4.1 — Fru's test feedback (triage + plan)

**Source:** `Prevail.sh - Bugs - from v0.4.1.pdf` (30 pages, 2026-06-07).
**Status:** triaged 2026-06-07. Most items are functionality; UI/aesthetics
deferred but recorded. This is the working list — check items off as they land.

**Release decision (2026-06-07):** Fru wants ALL waves (1–4) delivered in ONE
signed/notarized release (not per-wave). Build everything green first, then cut
a single DMG via scripts/release.sh.

**Progress:**
- **Wave 1 COMPLETE ✅** (all green: desktop tsc, cargo check, engine typecheck+tests):
  - B1 ✅ cross-model context — stale-closure `buildChatContext` dropped the
    latest exchange (`slice(0,-2)` on pre-update `messages`); now keeps full prior thread.
  - B2 ✅ + B3 ✅ backup — engine now emits snake_case `{archive_path, file_count,
    domains, scope, created_at, bytes}` and honors `--domain`; desktop renders with
    fallbacks. (engine: vault-ops.ts backupVault/backupDomain + index.tsx backup cmd)
  - B4 ✅ browser pick-vault guard · B5 ✅ + B6 ✅ WEBUI_ALLOWED (bootstrap_vault +
    import_sample_vault → browser inherits desktop vault, sample load works).
  - B7 ✅ desktop copy path is clean (delete-then-copy, no suffix logic anywhere);
    the " 2" was a Finder/multi-load artifact. Clean sample + idempotent import fix it.
  - B8 ✅ removed vestigial `apps/`, `complete/`, `core/` from the bundled sample
    (now 10 domains + benchmark/ + profile.md + AGENTS-operating.md).
  - B9 ✅ MCP expose config normalizes DMG/translocated paths to
    /Applications/Prevail.app + warns the user to move the app.
  - B10 ✅ session-log filename collision counter (no overwrite on same-second saves).
- **Wave 2 in progress:**
  - I1 (part) ✅ decision log: new `_decisions.jsonl` writer (`decision_append` /
    `decisions_read` / `decision_feedback` in lib.rs, + WEBUI_ALLOWED, + Rust test).
    Council verdicts now auto-record as decisions (App.tsx convene effect).
  - I5 ✅ verdict feedback: thumbs up/down under the live council verdict →
    `decision_feedback` (rating stored on the decision record for learning).
  - I1 (remaining): extend distill daemon to derive `_state.md` + extract chat
    decisions; I2/I3 coach-quality surface/score; I6 surface intents; I8 Insights
    tab; I9 message metadata; I10 OpenRouter activation feedback. ← next.
- **Bunker Mode ✅ (separate feature, same release):** app-wide enforced
  local-only trust mode, default ON. Centralized `bunker.rs` policy service
  (single source of truth); execution-layer guards on chat_send/engine_chat
  (force --local-only, refuse cloud → "Blocked by Bunker Mode"), no cloud-key
  injection + PREVAIL_BUNKER=1 to the engine, MCP/Composio/browser/telegram
  blocked; persistent ribbon; pickers hide cloud; Privacy & Connectivity section
  with toggle + "Leave Bunker Mode?" dialog + Status Verification Card;
  first-launch Ollama-missing banner. Rust tests green.
  - **Auto-switch ✅ (DONE):** a stale cloud default is now transparently
    swapped for an available local provider instead of hard-blocked.
    `bunker.rs::resolve_cli` is the authoritative resolver (covers chat_send,
    engine_chat, and therefore WebUI/Telegram too); the model id is dropped on
    switch so the local provider uses its default. The desktop UI mirrors it:
    the picker auto-selects a local CLI when Bunker is on, and `send()` resolves
    before invoking so the bubble/usage capture name the provider that actually
    ran. Canonical block remains ONLY when no local provider is installed (UI
    surfaces install/start guidance). Rust tests added + green.
  - **LM Studio / MLX ✅ (DONE):** now first-class local providers, not just
    "coming soon". Detection probes their default ports (LM Studio 1234, MLX /
    mlx_lm.server 8080) the same way Ollama's daemon is probed (`detect_clis` +
    `bunker::local_cli_available`). They're OpenAI-compatible HTTP servers with
    no spawnable binary, so the engine reaches them through its existing `ollama`
    provider path: `engine_chat` passes `--cli ollama` and redirects
    `PREVAIL_OLLAMA_URL` to the right port (`bunker::local_endpoint_url`) — no
    engine rebuild needed (the installed engine already honors that env). UI:
    brand tiles + monograms, vendor labels, and engine-only routing (like
    OpenRouter — needs a domain; the native binary path can't serve them).
    Ollama stays the auto-switch default since it works on both the native and
    engine paths. Rust tests added + green.

Fru's overall verdict: "very, very impressed… it is unbelievable." Good signal —
this is refinement of a working product, not a rescue.

---

## Wave 1 — Critical bugs (data loss, crashes, broken core promise)

- [x] **B1. Cross-model context loss (THE killer).** Switching models mid-thread
  drops the conversation history. Asked about "C-Zero" on Claude, switched to
  Codex, asked "was he any good?" → Codex had no context ("Who do you mean by
  'he'?"). Works when switching back to the cloud model, breaks switching to a
  different one. This is the core differentiator ("chat with one model, switch
  to another mid-conversation") — must carry the FULL thread to whatever model
  is active. (pdf p17)
- [x] **B2. Vault backup crashes.** "Backup failed: TypeError: undefined is not
  an object (evaluating 'f.domains.length')". (p11)
- [x] **B3. Domain backup reports "undefined files".** "Backed up undefined
  files (657.3 KB)" — the count is undefined; archive/restore work fine, only
  backup is wrong. (p27)
- [x] **B4. WebUI crashes on "Pick your vault".** "TypeError: Cannot read
  properties of undefined (reading 'invoke')" — the dialog/file-picker path
  isn't bridged for the browser transport. (p8)
- [x] **B5. WebUI "Load sample data" does nothing.** Same bridge gap. (p9)
- [x] **B6. WebUI should inherit the running desktop's vault.** When the desktop
  app is already running and serving the WebUI, the browser shouldn't show
  onboarding (pick vault / load sample) — it should be in sync automatically. (p8)
- [x] **B7. "Load sample data" duplicates the vault.** Creates `apps 2`,
  `health 2`, `tax 2`, … — every domain doubled with a " 2" suffix. Loading
  samples twice (or onto an existing vault) must be idempotent / not duplicate. (p2)
- [x] **B8. Sample vault has non-domain folders.** Contains `apps`, `benchmark`,
  `complete`, `core` (+ `AGENTS-operating.md`, `profile.md`) that aren't real
  life-domains. Expectation: just the ~10 domains. Clean the shipped sample
  vault. (p11, p12)
- [x] **B9. MCP "expose" config points at a dev/DMG path.** Generated config
  shows `command: "/Volumes/Prevail/Prevail.app/Contents/MacOS/prevail"` (the
  mounted DMG, not `/Applications/...`) and a hardcoded vault path. Must resolve
  the installed app path + the user's actual vault at runtime. (p7)
- [x] **B10. Duplicate session log files** with the same date in the session
  folder. (p24)

## Wave 2 — Self-learning intelligence (the soul of the product)

- [x] **I1. State + decisions aren't being written from conversations.** Health
  `state.md` is blank and there are no decisions even after chats + a council
  verdict. User said "make Mayo Clinic my favorite" → never captured as a
  decision; state never updated. The distillation must turn conversations into
  `_state.md` + `_decisions.jsonl`. (p24, p28)
- [x] **I2. "What's missing" must read like a domain expert, not a dev.** Today:
  "decisions.md MDE, knowledge files are thin, no journal." Should be a wealth/
  health coach: specific, actionable ("add your latest bank statements to
  build a net-worth baseline"), and offer to turn each into a task / a chat /
  an agent job. (p28)
- [ ] **I3. Domain scoring should explain itself + what's stale.** Suggest the
  score, show what's out of date, be specific about what's in vs not in. (p28)
- [ ] **I4. Smart prompt routing.** Decision/risk-class prompts (the suggested
  "Decision" / "Risks" cards) should be smart enough to route to the Council
  automatically instead of plain chat. (p25)
- [x] **I5. Verdict feedback loop.** Thumbs up/down on a council verdict;
  record which model/framework/lens/context produced liked vs disliked verdicts;
  learn over time and inform future runs. (p20)
- [ ] **I6. Surface intents intelligently.** `_intents.jsonl` exists but is
  invisible to the user. Explain it, and surface/distill intents over time
  (domain-level vs vault-level) rather than just capturing them. (p29)
- [ ] **I7. Skills auto-building.** No skills exist; clarify + implement how
  Prevail builds skills over time automatically. Ship sample skills like the
  sample vault. (p24, p14)
- [ ] **I8. Insights at the domain level, not per-thread.** "For You" questions
  + tasks are tied to a thread ("trait"); switching threads loses them. Move to
  a domain-level **Insights** tab that aggregates across threads. (p26)
- [ ] **I9. Show model + settings on each message/verdict.** Which model
  (Opus 4.8 vs 4.7?), which lens, which framework, what context. The status
  words ("PUZZLING", "Ruminating…") are random and don't match — fix or make
  meaningful. (p20)
- [ ] **I10. OpenRouter key saved → nothing happens.** After saving, give
  feedback and actually activate the provider (selectable in pickers, detected). (p1)

## Wave 3 — Telegram + information-architecture consolidation

- [ ] **T1. Telegram "typing" indicator** while the bot processes a request
  (sendChatAction typing). (p4)
- [ ] **T2. Telegram response formatting** is broken (raw markdown). Render
  proper Telegram markdown/HTML. (p5)
- [ ] **A1. Merge Integrations + Gateway into one section, "Gateway".**
  "Integrations" doesn't fit. (p15)
- [ ] **A2. Merge Connectors + Ingestion** — same concept, one section. Remove
  the conceptual duplicates across Connectors/Ingestion/Integrations/Gateway. (p16)
- [ ] **A3. Pull Council out of "Defaults" (or rename).** Council config is
  buried; it's too important to hide. Also General vs Defaults overlap is
  confusing — clean the settings IA. (p18)
- [ ] **A4. Council should show the full thread** (inputs **and** verdicts) when
  switching into the Council tab, not just the prompts. (p21)
- [ ] **A5. Naming consistency.** Tabs say "Conversation"/"Council"; buttons say
  "Chat"/"Convene". Align (rec: tabs **Chat** / **Council**; buttons **Send** /
  **Convene**). (p21)
- [ ] **A6. Auto-populate channel routing keywords** per domain (default = the
  domain name, non-editable defaults + user can add). Don't make the user fill
  it in. (p22)
- [ ] **A7. Live "bridge running" indicator in the app footer** (like AionUI:
  "Open WebUI · Open Terminal · …" live chips) so the user always knows a
  bridge/WebUI is live. (p6)
- [ ] **A8. Drag-domain-into-Council context.** Dragging a domain into a council
  convene doesn't behave like dragging into chat. Make both work; and offer
  "state summary (light)" vs "full context (heavy)". REC NEEDED → default to
  state summary, opt-in to full. (p30)
- [ ] **A9. Confirm Council & Conversation share thread context** (council tied
  to the thread it was convened from; switching back to chat keeps it). Verify +
  make explicit. (p20)

## Wave 4 — UI / aesthetics (deferred per Fru, recorded)

- [ ] U1. Connectors page layout. (p3)
- [ ] U2. Gateway page formatting + brand logos/colors. (p6)
- [ ] U3. Defaults page as lists (not big buttons), keep icons. (p13)
- [ ] U4. Per-domain Preferences as lists (not big icons). (p23)
- [ ] U5. Bottom composer toolbar too cluttered, wraps to 2 rows on small
  screens — redesign, keep all functionality. (p21-22)
- [ ] U6. Threads collapse icon too tiny to see. (p16)
- [ ] U7. Sidebar collapse icon next to the PREVAIL logo looks like part of the
  logo — move it (e.g. far right, near a generate/expand control). (p29)
- [ ] U8. "+ NEW CHAT" top-right is confusing/redundant — reconsider/remove. (p19)
- [ ] U9. After opening domain Preferences (gear), no obvious way back to chat. (p23)
- [ ] U10. Benchmark tab sits next to the per-domain gear but is a GLOBAL
  benchmark — placement is misleading. (p23)

---

## Open design questions (Fru asked for my recommendation)

1. **Drag-into-context size (A8):** default to the state-summary (light) so the
   context window stays small; offer an explicit "bring full context" toggle for
   when the user knows they need it. Same behavior in chat and council.
2. **Chat vs Conversation naming (A5):** name tabs after the noun (Chat /
   Council), buttons after the verb (Send / Convene).
3. **WebUI password (Wave1-adjacent):** force a change from the generated default
   on first browser login; store in the Keychain, never plaintext config; add a
   short Tailscale/Cloudflare "how to reach this remotely" help blurb.
