// Map: the derived-index builder (pure).
//
// buildMapModel is the contract the panel renders. It merges:
//   - RawDomain[]  the user's domains (slug, label, optional category)
//   - RawApp[]     the vault app registry (data/apps/<id>/manifest.json)
//   - the seed library (what we RECOMMEND per category)
//   - probes       per-app auth status resolved on THIS machine
// into a MapModel. Pure and deterministic so it is unit-testable; the Tauri
// calls that gather the raw inputs live in maploader.ts.
//
// Design (settled decisions):
//   #1 the map is a VIEW over data/apps + data/domains + the seed. A tool the
//      user HAS is an app whose manifest lists the domain; a tool we only
//      SUGGEST comes from the seed and is marked suggested (an "add" action).
//   #2 a domain matches a seed stack by category (manifest.category, else slug).
//   #3 auth status is probed per-app on this machine; declared otherwise.

import {
  finalizeDomain,
  computeStats,
  overallScore,
  type MapModel,
  type MapDomain,
  type MapTool,
} from "./map";
import { SEED_STACKS, seedForCategory, type ToolStatus, type SeedTool } from "./mapseed";

// What the vault app registry gives us per app (data/apps/<id>/manifest.json).
export interface RawApp {
  id: string;
  name?: string | null;
  integration?: string | null; // api | oauth | browser | mcp | manual | cli
  domains?: string[] | null;
  enabled?: boolean | null;
  account?: { label?: string } | null;
  autonomy?: string | null;
}

export interface RawDomain {
  slug: string;
  label?: string | null;
  category?: string | null;
}

// Per-app auth result probed on this machine. Absent => unknown/declared.
export interface Probe {
  appId: string;
  // true = verified reachable/authenticated now; false = present but failing;
  // undefined = not probed (fall back to the declared/derived status).
  ok?: boolean;
}

// Map a manifest integration type to a base agent-reach status when we have no
// probe and no seed opinion. Deliberately conservative.
function statusFromIntegration(integration?: string | null, enabled?: boolean | null): ToolStatus {
  const i = (integration || "").toLowerCase();
  if (i === "mcp") return enabled ? "connected" : "mcp";
  if (i === "cli") return "cli";
  if (i === "api") return "api";
  if (i === "oauth") return enabled ? "connected" : "api";
  if (i === "browser") return "browser";
  return "browser"; // manual / unknown
}

// Fold a probe result over a base status: a passing probe promotes an oauth/mcp
// tool to connected; a failing probe marks it broken; no probe leaves it as-is.
function applyProbe(base: ToolStatus, probe?: Probe): ToolStatus {
  if (!probe || probe.ok === undefined) return base;
  if (probe.ok === false) return base === "hardware" || base === "gap" ? base : "broken";
  // ok === true: a live connector reads as connected; CLI stays CLI (both full).
  if (base === "cli") return "cli";
  return "connected";
}

const norm = (s: string) => s.trim().toLowerCase();

function titleCase(slug: string): string {
  return slug
    .split(/[-_\s]+/)
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export interface BuildInputs {
  domains: RawDomain[];
  apps: RawApp[];
  probes?: Probe[];
  asOf: string; // ISO
  host: string;
  // When true, seed tools not present in the user's apps are added as
  // suggestions ("add to domain"). When false, only what the user has is shown.
  includeSuggestions?: boolean;
}

export function buildMapModel(inp: BuildInputs): MapModel {
  const probeById = new Map<string, Probe>();
  for (const p of inp.probes ?? []) probeById.set(p.appId, p);

  // Index apps by the domains they claim, matching on slug.
  const appsByDomain = new Map<string, RawApp[]>();
  for (const app of inp.apps) {
    for (const d of app.domains ?? []) {
      const key = norm(d);
      const arr = appsByDomain.get(key) ?? [];
      arr.push(app);
      appsByDomain.set(key, arr);
    }
  }

  const domains: MapDomain[] = inp.domains.map((rd) => {
    const slug = norm(rd.slug);
    const category = norm(rd.category || rd.slug);
    const seed = seedForCategory(category) || seedForCategory(slug);
    const label = rd.label || seed?.label || titleCase(rd.slug);

    // 1. tools the user actually HAS in this domain (from the app registry).
    const owned: MapTool[] = (appsByDomain.get(slug) ?? []).map((app) => {
      const base = statusFromIntegration(app.integration, app.enabled);
      const status = applyProbe(base, probeById.get(app.id));
      return {
        name: app.name || titleCase(app.id),
        status,
        appId: app.id,
        identity: app.account?.label || undefined,
      };
    });

    // 2. seed suggestions the user does NOT already have (by loose name match).
    const ownedNames = new Set(owned.map((t) => norm(t.name)));
    const suggestions: MapTool[] =
      inp.includeSuggestions && seed
        ? seed.tools
            .filter((st: SeedTool) => !ownedNames.has(norm(st.name)))
            .map((st) => ({
              name: st.name,
              status: st.status,
              note: st.note,
              identity: st.identity,
              suggested: true,
            }))
        : [];

    return finalizeDomain({
      slug,
      label,
      category,
      goal: seed?.goal,
      tools: [...owned, ...suggestions],
    });
  });

  // Domains with no user apps yet but a matching seed still show (all-suggested)
  // so a new user sees the recommended stack to accept. Sort: real activity
  // first (higher score), then by name.
  domains.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));

  return {
    domains,
    stats: computeStats(domains),
    overallScore: overallScore(domains),
    asOf: inp.asOf,
    host: inp.host,
  };
}

// Seed-only model: for a brand-new user (or preview), render the full seed
// library as suggestions so the panel is never empty out of the box.
export function seedOnlyModel(asOf: string, host: string): MapModel {
  const domains: MapDomain[] = SEED_STACKS.map((s) =>
    finalizeDomain({
      slug: s.id,
      label: s.label,
      category: s.categories[0] || s.id,
      goal: s.goal,
      tools: s.tools.map((t) => ({ name: t.name, status: t.status, note: t.note, identity: t.identity })),
    }),
  );
  domains.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  return { domains, stats: computeStats(domains), overallScore: overallScore(domains), asOf, host };
}
