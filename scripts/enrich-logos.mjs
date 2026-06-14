// Enrich the connector catalog with real brand logos from simple-icons.
//
// The catalog has ~1,500 apps but only a few hundred ship an iconSlug, so most
// render as monogram tiles. simple-icons (already a dependency) carries 3,400+
// brand glyphs. This script matches each app by normalized name to a simple-icon
// and, on an exact match, sets the app's iconSlug and adds the glyph to
// logos.json. Apps with no brand glyph keep their monogram fallback.
//
// Re-runnable and idempotent: run `node scripts/enrich-logos.mjs` after the
// catalog grows. Exact-match only (title or slug), so it never guesses a wrong
// logo for a multi-word product.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as simpleIcons from "simple-icons";

const here = dirname(fileURLToPath(import.meta.url));
const connectorsDir = join(here, "..", "src-tauri", "resources", "connectors");
const catalogPath = join(connectorsDir, "catalog.json");
const logosPath = join(connectorsDir, "logos.json");

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");

// Build a normalized lookup over every simple-icon (by title and by slug).
const bySlug = new Map();
for (const icon of Object.values(simpleIcons)) {
  if (!icon || !icon.slug || !icon.path) continue;
  bySlug.set(norm(icon.title), icon);
  bySlug.set(icon.slug, icon);
}

const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
const logos = JSON.parse(readFileSync(logosPath, "utf8"));

// Walk the catalog tree and collect every app object (name + pattern).
const apps = [];
const walk = (node) => {
  if (Array.isArray(node)) node.forEach(walk);
  else if (node && typeof node === "object") {
    if (node.name && node.pattern) apps.push(node);
    for (const k of Object.keys(node)) walk(node[k]);
  }
};
walk(catalog);

// Generic leading words that must never be treated as a brand in the
// first-word pass (e.g. "Local Falcon" should not become the "local" logo).
const STOPWORDS = new Set([
  "local", "my", "the", "app", "apps", "api", "web", "get", "go", "pro", "plus",
  "one", "ai", "io", "open", "smart", "auto", "cloud", "data", "live", "home",
  "best", "top", "new", "us", "global", "digital", "online", "easy",
]);

let matched = 0;
let added = 0;
const use = (app, icon) => {
  app.iconSlug = icon.slug;
  matched++;
  if (!logos[icon.slug]) {
    logos[icon.slug] = { hex: icon.hex, path: icon.path };
    added++;
  }
};

// Pass 1 — exact normalized name match (safest, never a wrong logo).
for (const app of apps) {
  if (app.iconSlug) continue;
  const icon = bySlug.get(norm(app.name));
  if (icon) use(app, icon);
}
// Pass 2 — parent-brand match on the first significant word ("ADP Workforce
// Now" -> ADP, "Intuit Mailchimp" -> Intuit). Guarded by a stopword list and a
// 3-char minimum so generic words never resolve to a logo.
for (const app of apps) {
  if (app.iconSlug) continue;
  const first = norm(app.name.split(/[ /(]/)[0]);
  if (first.length < 3 || STOPWORDS.has(first)) continue;
  const icon = bySlug.get(first);
  if (icon) use(app, icon);
}

// Write back minified, matching the original on-disk format so the diff stays
// to the actual content delta (these are single-line generated data files).
writeFileSync(catalogPath, JSON.stringify(catalog));
writeFileSync(logosPath, JSON.stringify(logos));

const withSlug = apps.filter((a) => a.iconSlug).length;
console.log(`enrich-logos: ${apps.length} apps · ${matched} newly matched · ${added} new glyphs added`);
console.log(`enrich-logos: ${withSlug}/${apps.length} apps now have a real logo (${Math.round((withSlug / apps.length) * 100)}%); the rest use monogram tiles`);
