#!/usr/bin/env node
// Re-tier connectors/catalog.json to a curated ~150 "life-OS" set (P0 of the
// Apps-area plan, docs/APPS-AREA-RESEARCH.md §6). NON-DESTRUCTIVE: nothing is
// deleted — curated apps become tier 1 (the default catalog view), everything
// else becomes tier 2 (still reachable via search / "show all"). Adds
// `curated: true` to the kept set and a top-level `curatedCount`.
//
// Usage:
//   node scripts/curate-catalog.mjs           # dry run: report only
//   node scripts/curate-catalog.mjs --write    # apply in place
import { readFileSync, writeFileSync } from "node:fs";

const PATH = new URL("../src-tauri/resources/connectors/catalog.json", import.meta.url);
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// Each entry: a catalog `name` (or alias) that should be curated. Matching is
// exact on the normalized form, so "Things 3" won't catch "SmartThings".
const CURATED = [
  // Email
  "Gmail", "Outlook.com / Hotmail", "Outlook Email", "Yahoo Mail", "iCloud Mail", "Proton Mail", "Fastmail",
  // Calendar
  "Google Calendar", "Microsoft Outlook Calendar", "Apple Calendar (macOS/iOS app)", "Fantastical", "Calendly",
  // Banking & aggregators (service level only)
  "SimpleFIN Bridge", "Chase", "Bank of America", "Wells Fargo", "Capital One", "Citibank", "American Express", "Ally Bank",
  // Budgeting & money mgmt
  "Monarch Money", "YNAB", "Rocket Money", "Empower", "Wise",
  // Payments
  "PayPal", "Venmo", "Zelle", "Apple Pay", "Google Pay",
  // Brokerage / investing / crypto
  "Fidelity Investments", "Charles Schwab", "Vanguard", "Robinhood", "E*TRADE", "Merrill Edge", "Webull", "Betterment", "Wealthfront", "Coinbase", "Crypto.com",
  // Credit & reports
  "Credit Karma", "Experian", "Equifax", "TransUnion", "myFICO",
  // Taxes & accounting
  "Intuit TurboTax", "H&R Block Online", "FreeTaxUSA", "Intuit QuickBooks", "Expensify", "Ramp", "Brex",
  // Productivity / notes / tasks
  "Notion", "Obsidian", "Evernote", "Apple Notes", "Google Keep", "Todoist", "TickTick", "Things 3", "Google Tasks", "Trello", "Asana", "ClickUp",
  // Project / dev (minimal)
  "GitHub", "Linear", "Jira", "Google Cloud Platform", "AWS", "Vercel", "1Password",
  // Storage / files / docs
  "Google Drive", "Microsoft OneDrive", "Dropbox", "Box", "Apple iCloud Drive", "Google Docs", "Google Sheets", "Google Photos", "Docusign",
  // Health & medical
  "Apple Health", "Epic MyChart", "One Medical", "Zocdoc", "Labcorp Patient", "Quest Diagnostics MyQuest", "CVS Pharmacy", "Walgreens", "GoodRx", "Teladoc Health",
  // Fitness & wearables
  "Oura Ring", "Whoop", "Fitbit", "Garmin Connect", "Apple Fitness", "Google Fit", "Strava", "AllTrails", "Peloton", "Withings",
  // Mindfulness
  "Calm", "Headspace",
  // Insurance
  "GEICO", "State Farm", "Progressive", "Allstate", "Liberty Mutual", "Aetna", "Cigna", "UnitedHealthcare",
  // Travel & transport
  "Google Maps", "Waze", "TripIt", "Uber", "Lyft", "Airbnb", "Booking.com", "Expedia", "Google Flights", "United Airlines", "Delta Air Lines (SkyMiles)", "American Airlines (AAdvantage)", "Southwest Airlines (Rapid Rewards)", "Marriott (app)", "Hilton (app)",
  // Shopping & food
  "Amazon", "Costco", "Best Buy", "eBay", "Etsy", "Instacart", "DoorDash", "Uber Eats", "Grubhub", "OpenTable",
  // Communication
  "Slack", "Microsoft Teams", "Discord", "Telegram", "WhatsApp", "Signal", "Zoom", "Google Meet", "Messages", "Google Contacts",
  // Social & media
  "X (Twitter)", "Instagram", "Facebook", "LinkedIn", "Reddit", "YouTube", "TikTok", "Threads", "Pinterest", "Spotify", "Apple Music", "YouTube Music", "Netflix",
  // News & reading
  "Apple News", "Google News", "Feedly", "Substack", "The New York Times", "The Wall Street Journal",
  // Smart home
  "Apple Home (HomeKit)", "Google Home", "Amazon Alexa", "Samsung SmartThings", "Home Assistant", "Philips Hue", "Ring", "ecobee",
  // Automotive
  "Tesla",
  // Government & identity
  "IRS online account", "Social Security Administration (my Social Security)", "Login.gov", "ID.me", "USPS (United States Postal Service)", "DMV",
  // Family & home services
  "Life360", "Cozi Family Organizer", "Care.com", "Thumbtack", "TaskRabbit",
  // Security & passwords
  "Bitwarden", "Dashlane", "Authy", "NordVPN", "Proton Pass",
  // Learning
  "Duolingo", "Audible", "Goodreads", "Udemy", "MasterClass",
];

const cat = JSON.parse(readFileSync(PATH, "utf8"));
const byNorm = new Map();
for (const a of cat.apps) {
  const k = norm(a.name);
  if (!byNorm.has(k)) byNorm.set(k, []);
  byNorm.get(k).push(a);
}

const matched = new Set();
const unmatched = [];
for (const want of CURATED) {
  const k = norm(want);
  const hits = byNorm.get(k);
  if (hits && hits.length) hits.forEach((a) => matched.add(a));
  else unmatched.push(want);
}

console.log(`Catalog apps: ${cat.apps.length}`);
console.log(`Curated entries: ${CURATED.length}`);
console.log(`Matched apps: ${matched.size}`);
console.log(`Unmatched curated names (${unmatched.length}):`);
for (const u of unmatched) {
  // Offer near-miss suggestions to help fix aliases.
  const nk = norm(u);
  const near = cat.apps
    .filter((a) => norm(a.name).includes(nk) || nk.includes(norm(a.name)))
    .map((a) => a.name)
    .slice(0, 4);
  console.log(`  - ${u}${near.length ? "   ~ " + near.join(" | ") : "   (no near match)"}`);
}

if (process.argv.includes("--write")) {
  // SimpleFIN Bridge: the recommended local-first banking path — add it if absent.
  if (!byNorm.has(norm("SimpleFIN Bridge"))) {
    cat.apps.push({
      name: "SimpleFIN Bridge", domain: "money", pattern: "api", sources: [],
      verified: true, tier: 1, obscure: false,
    });
    matched.add(cat.apps[cat.apps.length - 1]);
  }
  let t1 = 0;
  for (const a of cat.apps) {
    if (matched.has(a)) { a.tier = 1; a.obscure = false; a.curated = true; t1++; }
    else { a.tier = 2; if (a.curated) delete a.curated; }
  }
  cat.curatedCount = t1;
  cat.note = (cat.note || "") + " | Curated to a ~150 life-OS set (tier 1); the long tail is re-tiered to 2 and reachable via search / show-all. See docs/APPS-AREA-RESEARCH.md.";
  writeFileSync(PATH, JSON.stringify(cat, null, 2) + "\n");
  console.log(`\nWROTE catalog.json — tier-1 (curated) now ${t1}, tier-2 ${cat.apps.length - t1}.`);
} else {
  console.log("\n(dry run — pass --write to apply)");
}
