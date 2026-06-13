import { readFileSync, writeFileSync } from "node:fs";

// Injects curated cross-category tags into the connector catalog so an app can
// surface under more than one filter (e.g. Tesla = automotive + tech). An app's
// own `domain` is always an implicit tag — the desktop unions domain + tags —
// so the map below lists ONLY the EXTRA tags beyond the primary domain. Idempotent:
// re-running rebuilds tags from this map alone. Run: node scripts/gen-tags.mjs
const PATH = "src-tauri/resources/connectors/catalog.json";

// app display name -> extra tags beyond its primary domain. Keep these grounded
// in what the app actually does, not invented breadth.
const CROSS = {
  "Tesla": ["tech", "smarthome"],
  "Tesla app": ["tech", "smarthome"],
  "Amazon": ["media", "smarthome"],
  "Gmail": ["communication", "productivity"],
  "Google Drive": ["productivity"],
  "Google Photos": ["media"],
  "Google Home": ["tech"],
  "Samsung SmartThings": ["tech"],
  "Microsoft 365": ["email", "files"],
  "Apple Health": ["fitness"],
  "Apple iCloud Drive": ["tech"],
  "Spotify": ["social"],
  "YouTube": ["social", "learning"],
  "Garmin Connect": ["health"],
  "Fitbit": ["health"],
  "Oura Ring": ["health"],
  "Whoop": ["health"],
  "Strava": ["social"],
  "PayPal": ["shopping"],
  "Venmo": ["social"],
  "Robinhood": ["money"],
  "Coinbase": ["money"],
  "Uber": ["food"],
  "DoorDash": ["shopping"],
  "Instacart": ["shopping"],
  "LinkedIn": ["social"],
  "Notion": ["files"],
  "GitHub": ["productivity"],
  "Ring": ["security"],
  "Philips Hue": ["tech"],
};

const cat = JSON.parse(readFileSync(PATH, "utf8"));
const byName = new Map();
for (const a of cat.apps) byName.set(a.name.toLowerCase(), a);

let applied = 0;
const missing = [];
for (const [name, tags] of Object.entries(CROSS)) {
  const a = byName.get(name.toLowerCase());
  if (!a) { missing.push(name); continue; }
  const extra = [...new Set(tags.filter((t) => t !== a.domain))];
  if (extra.length) { a.tags = extra; applied++; }
}
// Idempotent: strip tags from any app no longer in the curated map.
const keep = new Set(Object.keys(CROSS).map((n) => n.toLowerCase()));
for (const a of cat.apps) if (a.tags && !keep.has(a.name.toLowerCase())) delete a.tags;

writeFileSync(PATH, JSON.stringify(cat, null, 0));
console.log(`apps:${cat.apps.length} tagged:${applied} missing:${missing.length}${missing.length ? " -> " + missing.join(", ") : ""}`);
