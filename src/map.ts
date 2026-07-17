// Map: runtime model + scoring.
//
// The Map panel is a VIEW. This module turns three inputs into one renderable
// model:
//   1. the shipped seed library (mapseed.ts) - what we RECOMMEND per domain,
//   2. the user's vault state - which tools are actually in which domain
//      (data/apps/<id>/manifest.json domains[] + integration + account),
//   3. probe results - which of those are actually authenticated on THIS machine.
//
// The loader that gathers (2) and (3) via Tauri lives in maploader.ts; this
// module is pure so the scoring stays testable and deterministic.

import { STATUS_WEIGHT, STATUS_LABEL, type ToolStatus, type SeedStack } from "./mapseed";

export interface MapTool {
  name: string;
  status: ToolStatus;
  note?: string;
  identity?: string;
  // True when this tool comes only from the seed (a suggestion the user has
  // not yet accepted into the domain). Rendered dimmer, with an "add" action.
  suggested?: boolean;
  // The vault app id this tool resolves to, when it maps to a data/apps entry.
  appId?: string;
}

export interface MapDomain {
  slug: string;
  label: string;
  category: string;
  goal?: string;
  tools: MapTool[];
  // Agent-operable percentage, 0-100. See scoreStack.
  score: number;
  // Identities this domain's tools expect but which are not connected on this
  // machine (e.g. a real-estate domain needs account2@example.com, not connected).
  missingIdentities: string[];
}

export interface MapStats {
  tools: number;
  wired: number; // connected + cli
  scriptable: number; // api + mcp + research
  manual: number; // browser + broken
  gaps: number;
}

export interface MapModel {
  domains: MapDomain[];
  stats: MapStats;
  // Overall agent-operable %, tools-weighted across all domains.
  overallScore: number;
  // When + where this snapshot was taken (auth is machine-local).
  asOf: string; // ISO
  host: string;
}

// Agent-operable score for a set of tools: weighted sum over the non-hardware
// tools, as a percentage. Mirrors the approved prototype exactly:
//   connected/cli = 1.0, mcp = 0.75, api/research = 0.5, browser/broken/gap = 0,
//   hardware excluded from the denominator. Suggested (not-yet-accepted) tools
//   do NOT count - the score reflects what the user actually has wired.
export function scoreStack(tools: MapTool[]): number {
  let score = 0;
  let denom = 0;
  for (const t of tools) {
    if (t.suggested) continue;
    if (t.status === "hardware") continue;
    denom++;
    score += STATUS_WEIGHT[t.status] ?? 0;
  }
  return denom ? Math.round((100 * score) / denom) : 0;
}

// Roll up the stat row from the domains.
export function computeStats(domains: MapDomain[]): MapStats {
  const s: MapStats = { tools: 0, wired: 0, scriptable: 0, manual: 0, gaps: 0 };
  for (const d of domains) {
    for (const t of d.tools) {
      if (t.suggested || t.status === "hardware") continue;
      s.tools++;
      if (t.status === "connected" || t.status === "cli") s.wired++;
      else if (t.status === "api" || t.status === "mcp" || t.status === "research") s.scriptable++;
      else if (t.status === "gap") s.gaps++;
      else s.manual++;
    }
  }
  return s;
}

// Overall score = tools-weighted mean of the domain scores (a domain with more
// tools moves the needle more), matching the "one number" framing.
export function overallScore(domains: MapDomain[]): number {
  let score = 0;
  let denom = 0;
  for (const d of domains) {
    for (const t of d.tools) {
      if (t.suggested || t.status === "hardware") continue;
      denom++;
      score += STATUS_WEIGHT[t.status] ?? 0;
    }
  }
  return denom ? Math.round((100 * score) / denom) : 0;
}

// Finalize a domain: compute score + missing identities from its tools.
export function finalizeDomain(d: Omit<MapDomain, "score" | "missingIdentities">): MapDomain {
  const need = new Set<string>();
  for (const t of d.tools) {
    if (t.identity && (t.status === "gap" || t.status === "broken")) need.add(t.identity);
  }
  return { ...d, score: scoreStack(d.tools), missingIdentities: [...need] };
}

export { STATUS_LABEL, STATUS_WEIGHT };
export type { ToolStatus, SeedStack };
