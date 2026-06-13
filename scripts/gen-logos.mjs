import { readFileSync, writeFileSync } from "node:fs";
import * as si from "simple-icons";

const norm = (s) => s.replace(/\([^)]*\)/g,"").toLowerCase().replace(/&/g,"and").replace(/[^a-z0-9]+/g,"");

// Build normalized title/slug -> icon
const byKey = new Map();
for (const v of Object.values(si)) {
  if (!v || typeof v !== "object" || !v.title || !v.path) continue;
  for (const k of [norm(v.title), v.slug]) if (k && !byKey.has(k)) byKey.set(k, v);
}
// Manual aliases for important apps whose catalog name != icon title
const ALIAS = {
  x:"x", googledrive:"googledrive", googlecalendar:"googlecalendar", googledocs:"googledocs",
  googlesheets:"googlesheets", googleslides:"googleslides", googlekeep:"googlekeep", googlemaps:"googlemaps",
  googlephotos:"googlephotos", googlehome:"googlehome", googlechat:"googlechat", googlemeet:"googlemeet",
  googlenews:"googlenews", youtubemusic:"youtubemusic", outlook:"microsoftoutlook", outlookcom:"microsoftoutlook",
  microsoft365:"microsoft365", microsoftteams:"microsoftteams", microsoftonedrive:"microsoftonedrive",
  appleiclouddrive:"icloud", iclouddrive:"icloud", applemusic:"applemusic", applehealth:"apple",
  intuitquickbooks:"quickbooks", intuitturbotax:"intuit", intuitcreditkarma:"intuit", americanexpress:"americanexpress",
  bankofamerica:"bankofamerica", wellsfargo:"wellsfargo", capitalone:"capitalone", chasebank:"chase",
  cashapp:"cashapp", facebookmessenger:"messenger", samsungsmartthings:"samsung", teslaapp:"tesla",
  deltaairlines:"delta", unitedairlines:"united", southwestairlines:"southwestairlines", epicmychart:"epic",
  quickbooksonline:"quickbooks", hrblockonline:"hrblock", binanceus:"binance", merrilledge:"merrilledge",
  fidelityinvestments:"fidelity", googlecloudplatform:"googlecloud", dockerhub:"docker",
};
const cat = JSON.parse(readFileSync("src-tauri/resources/connectors/catalog.json","utf8"));
const logos = {}; let matched=0;
for (const a of cat.apps) {
  const cands = [norm(a.name), ALIAS[norm(a.name)]].filter(Boolean);
  let ic=null;
  for (const c of cands){ if (byKey.has(c)) { ic=byKey.get(c); break; } }
  if (ic) {
    a.iconSlug = ic.slug;
    if (!logos[ic.slug]) logos[ic.slug] = { hex: ic.hex, path: ic.path };
    matched++;
  } else if (a.iconSlug) { delete a.iconSlug; }
}
writeFileSync("src-tauri/resources/connectors/catalog.json", JSON.stringify(cat,null,0));
writeFileSync("src-tauri/resources/connectors/logos.json", JSON.stringify(logos,null,0));
console.log(`apps:${cat.apps.length} matched-logo:${matched} unique-icons:${Object.keys(logos).length}`);
