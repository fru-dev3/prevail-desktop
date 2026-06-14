// Subsystem extracted from App.tsx (encapsulated module state).
import { MODELS } from "./constants";
import { lsGet } from "./storage";
import type { ModelPick } from "./types";

export const COUNCIL_MEMBERS_KEY = "prevail.council.defaultMembers";

export const COUNCIL_CHAIR_KEY = "prevail.council.defaultChair";

export function councilSlotKey(cliId: string, modelId: string): string { return `${cliId}::${modelId}`; }

export function councilModelsFor(cliId: string): ModelPick[] {
  return MODELS[cliId] ?? [{ id: "", label: "Default", blurb: "" } as ModelPick];
}

export function readCouncilMembers(): string[] {
  // Only accept slot-key-shaped entries (`cli::model`). Older builds stored bare
  // CLI ids here; those are ignored so the panel re-seeds with real slots.
  try { const a = JSON.parse(lsGet(COUNCIL_MEMBERS_KEY) || "[]"); return Array.isArray(a) ? a.filter((x) => typeof x === "string" && x.includes("::")) : []; } catch { return []; }
}

export function readCouncilChair(): string { return lsGet(COUNCIL_CHAIR_KEY) || ""; }

// Council config — its own first-class section. You pick the EXACT models on the
// default panel (per-provider, multiple models allowed) and which one chairs.
