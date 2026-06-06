// Playwright runner — Tier C of Prevail's ingestion engine.
//
// Spawned from Rust (src-tauri/src/ingestion/tier_c_browser.rs).
// Reads a single JSON line from stdin describing the run and then
// streams progress events as JSON lines on stdout. The Rust side
// re-emits each line as a Tauri event so the desktop UI can show
// the run status.
//
// Run expectations:
//   - Headed mode (`headless: false`) so the user can see the MFA
//     challenge and complete it interactively.
//   - Persistent profile dir so cookies + session storage survive
//     across runs of the same (domain, portal) pair.
//   - Human-in-the-loop pause: if the success selector / URL doesn't
//     appear within mfaTimeoutSec, log it and abort cleanly.
//   - Download capture: every triggered download is saved into the
//     domain's imports/ folder with a clean filename.
//
// Dependencies:
//   $ npm i -g playwright-core
//   $ npx playwright install chromium
// (Both are run once by the user; we use playwright-core to avoid the
// huge implicit chromium download when the package is required.)

"use strict";

const { chromium } = (() => {
  try {
    return require("playwright-core");
  } catch {
    try {
      return require("playwright");
    } catch {
      log({ type: "error", message: "playwright not installed. Run: npm i -g playwright-core && npx playwright install chromium" });
      process.exit(2);
    }
  }
})();

const fs = require("fs");
const path = require("path");

function log(obj) {
  // One JSON object per line so the Rust BufReader parses cleanly.
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function sanitizeFilename(name) {
  // Strip path bits, replace anything weird with `-`, keep extension.
  const base = path.basename(name || "download");
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  const safe = stem.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return (safe || "download") + ext.toLowerCase();
}

// ── Read the single-line JSON request from stdin ──────────────────────
async function readRequest() {
  return new Promise((resolve, reject) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      buf += chunk;
      const nl = buf.indexOf("\n");
      if (nl !== -1) {
        const line = buf.slice(0, nl);
        try { resolve(JSON.parse(line)); } catch (e) { reject(e); }
      }
    });
    process.stdin.on("end", () => {
      if (!buf) reject(new Error("no input"));
    });
  });
}

// ── Wait for a success condition with periodic polling ───────────────
async function waitForSuccess(page, { successSelector, successUrlContains }, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (successUrlContains && page.url().includes(successUrlContains)) return true;
    if (successSelector) {
      try {
        const el = await page.$(successSelector);
        if (el) return true;
      } catch { /* navigation in flight, retry */ }
    }
    await page.waitForTimeout(1500);
  }
  return false;
}

// ── Main flow ────────────────────────────────────────────────────────
(async () => {
  let req;
  try {
    req = await readRequest();
  } catch (e) {
    log({ type: "error", message: "failed to read request: " + e.message });
    process.exit(2);
  }

  const {
    domain,
    portal,
    startUrl,
    mfaTimeoutSec = 90,
    successSelector,
    successUrlContains,
    profileDir,
    downloadsDir,
  } = req;

  // Make sure the dirs we were handed actually exist before Playwright
  // tries to write to them.
  for (const d of [profileDir, downloadsDir]) {
    if (!d) continue;
    try { fs.mkdirSync(d, { recursive: true }); } catch (e) {
      log({ type: "error", message: "mkdir " + d + ": " + e.message });
      process.exit(2);
    }
  }

  log({ type: "start", domain, portal, startUrl, profileDir });

  let context;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      acceptDownloads: true,
      // Reasonable defaults; portals often dislike headless UA.
      viewport: { width: 1280, height: 820 },
      // Lifetime safety net — if something hangs, exit eventually.
      args: ["--disable-blink-features=AutomationControlled"],
    });
  } catch (e) {
    log({ type: "error", message: "launchPersistentContext: " + e.message });
    process.exit(3);
  }

  // Download interception — every downloaded file lands in the
  // domain's imports/ dir under a cleaned filename. The Rust side
  // can re-process via storage::ingest_artifact when it sees the
  // "downloaded" event.
  context.on("page", (page) => {
    page.on("download", async (download) => {
      const suggested = download.suggestedFilename();
      const clean = sanitizeFilename(suggested);
      const dest = path.join(downloadsDir, `${Date.now()}_${clean}`);
      try {
        await download.saveAs(dest);
        log({
          type: "downloaded",
          domain,
          portal,
          source: portal,
          path: dest,
          original: suggested,
        });
      } catch (e) {
        log({ type: "error", message: "saveAs: " + e.message });
      }
    });
  });

  const page = context.pages()[0] ?? (await context.newPage());

  // Navigate. We use domcontentloaded rather than networkidle —
  // legacy portals often have permanent long-polling that never
  // settles.
  try {
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  } catch (e) {
    log({ type: "error", message: "goto: " + e.message });
    await context.close().catch(() => {});
    process.exit(4);
  }

  log({ type: "navigated", url: page.url() });

  // Human-in-the-loop pause for MFA / login completion. Only fires
  // when the caller specifies a success condition — otherwise we
  // assume the persistent profile already has a logged-in session
  // and proceed immediately.
  if (successSelector || successUrlContains) {
    log({
      type: "awaiting_user",
      message: `Waiting up to ${mfaTimeoutSec}s for login / MFA. Complete it in the headed window.`,
      timeoutSec: mfaTimeoutSec,
    });
    const ok = await waitForSuccess(
      page,
      { successSelector, successUrlContains },
      mfaTimeoutSec * 1000,
    );
    if (!ok) {
      log({ type: "timeout", message: "MFA / login not completed within window" });
      await context.close().catch(() => {});
      process.exit(5);
    }
    log({ type: "login_confirmed", url: page.url() });
  }

  // ── Execute post-login automation steps if the recipe provides
  // them. Each step is one event in `actions` array. Failures don't
  // abort the run — we log the error and continue so the user can
  // recover manually in the headed window if needed.
  const actions = Array.isArray(req.actions) ? req.actions : [];
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    if (!a || typeof a !== "object" || !a.type) continue;
    log({ type: "action_start", index: i, step: a });
    try {
      switch (a.type) {
        case "goto": {
          await page.goto(a.url, {
            waitUntil: a.wait_until || "domcontentloaded",
            timeout: 30_000,
          });
          break;
        }
        case "click": {
          const t = (a.timeout_sec || 15) * 1000;
          await page.click(a.selector, { timeout: t });
          break;
        }
        case "wait_for": {
          const t = (a.timeout_sec || 30) * 1000;
          await page.waitForSelector(a.selector, { timeout: t });
          break;
        }
        case "select_option": {
          await page.selectOption(a.selector, a.value);
          break;
        }
        case "sleep": {
          await page.waitForTimeout((a.seconds || 1) * 1000);
          break;
        }
        case "download_all_links": {
          // Snapshot the matching elements first since clicking can
          // re-render the DOM and stale the handles.
          const handles = await page.$$(a.selector);
          const cap = typeof a.max === "number" ? a.max : handles.length;
          for (let j = 0; j < Math.min(handles.length, cap); j++) {
            try {
              // Race click against a download — whichever resolves
              // first determines success.
              const [download] = await Promise.all([
                page.waitForEvent("download", { timeout: 30_000 }),
                handles[j].click({ timeout: 15_000 }),
              ]);
              // The download handler attached earlier catches it,
              // we still log here for action-level visibility.
              log({
                type: "downloaded_link",
                index: j,
                suggested: download.suggestedFilename(),
              });
            } catch (e) {
              log({ type: "error", action: i, link: j, message: e.message });
            }
          }
          break;
        }
        default:
          log({ type: "error", message: "unknown action type: " + a.type });
      }
      log({ type: "action_done", index: i });
    } catch (e) {
      log({ type: "error", action: i, message: e && e.message ? e.message : String(e) });
      // Continue to next action — best-effort, user can recover.
    }
  }

  log({
    type: "ready",
    message: actions.length > 0
      ? `Executed ${actions.length} action(s). Window stays open for additional manual downloads.`
      : "Persistent session active. Trigger downloads in the headed window; they will be captured.",
  });

  // Keep the process alive until the user closes the window.
  context.on("close", () => {
    log({ type: "closed" });
    process.exit(0);
  });
})().catch((e) => {
  log({ type: "error", message: "unexpected: " + (e && e.message ? e.message : String(e)) });
  process.exit(1);
});
