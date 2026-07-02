// Saved benchmark presets — two reusable objects so a user never has to rebuild
// a selection by hand:
//
//   • ModelBundle — a named set of models (cli::model keys). Pick a bundle to
//     drop that exact set onto the Run panel in one click.
//   • BenchSuite  — a named (models + domains + mode) combination. Re-run it as a
//     unit, or put it on the schedule. A suite SNAPSHOTS its models + domains, so
//     deleting a bundle never breaks a suite that was built from it.
//
// Single-user, no DB: persisted as JSON in localStorage, the same pattern the
// rest of the app uses. A window event ("prevail:bench-presets") lets every
// mounted view refresh the instant a preset changes, mirroring benchNotify().
import { useEffect, useState } from "react";
import { lsGet, lsSet } from "./storage";

export type ModelBundle = { id: string; name: string; models: string[]; createdAt: number };
export type BenchSuite = {
  id: string;
  name: string;
  mode: "single" | "council";
  models: string[];   // cli::model keys; empty when mode === "council"
  domains: string[];  // lowercase domain slugs; empty = all domains
  createdAt: number;
  // Where this saved preset came from, so the UI can distinguish and filter
  // "presets I built myself" from "AI suggestions I chose to keep":
  //   • "manual"    — hand-built by the user (Save selected models as a preset)
  //   • "ai"        — saved from an AI-suggested preset card
  //   • "canonical" — saved from a built-in canonical template card
  // Optional for back-compat: suites saved before this field existed have no
  // origin and are treated as "manual" everywhere (they were user-curated).
  origin?: "manual" | "ai" | "canonical";
};

// Back-compat helper: treat an origin-less suite as "manual" everywhere.
export function suiteOrigin(s: BenchSuite): "manual" | "ai" | "canonical" {
  return s.origin ?? "manual";
}

const BUNDLES_KEY = "prevail.bench.bundles";
const SUITES_KEY = "prevail.bench.suites";
const EVENT = "prevail:bench-presets";

function readArr<T>(key: string): T[] {
  try {
    const v = JSON.parse(lsGet(key, "[]") || "[]");
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}
function writeArr<T>(key: string, arr: T[]) {
  lsSet(key, JSON.stringify(arr));
  window.dispatchEvent(new Event(EVENT));
}
// Stable, collision-resistant id. (Date.now()/random are fine in app code.)
function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// ── Bundles ────────────────────────────────────────────────────────────────
export function listBundles(): ModelBundle[] {
  return readArr<ModelBundle>(BUNDLES_KEY).sort((a, b) => a.name.localeCompare(b.name));
}
export function saveBundle(name: string, models: string[]): ModelBundle | null {
  const nm = name.trim();
  if (!nm || models.length === 0) return null;
  const all = readArr<ModelBundle>(BUNDLES_KEY);
  // Same name → overwrite in place (a rename/update), so the list never grows duplicates.
  const existing = all.find((b) => b.name.toLowerCase() === nm.toLowerCase());
  if (existing) {
    existing.name = nm;
    existing.models = [...models];
    writeArr(BUNDLES_KEY, all);
    return existing;
  }
  const b: ModelBundle = { id: newId("bnd"), name: nm, models: [...models], createdAt: Date.now() };
  writeArr(BUNDLES_KEY, [...all, b]);
  return b;
}
export function deleteBundle(id: string) {
  writeArr(BUNDLES_KEY, readArr<ModelBundle>(BUNDLES_KEY).filter((b) => b.id !== id));
}

// ── Suites ─────────────────────────────────────────────────────────────────
export function listSuites(): BenchSuite[] {
  return readArr<BenchSuite>(SUITES_KEY).sort((a, b) => a.name.localeCompare(b.name));
}
export function saveSuite(s: Omit<BenchSuite, "id" | "createdAt">): BenchSuite | null {
  const nm = s.name.trim();
  if (!nm) return null;
  if (s.mode === "single" && s.models.length === 0) return null;
  const all = readArr<BenchSuite>(SUITES_KEY);
  const existing = all.find((x) => x.name.toLowerCase() === nm.toLowerCase());
  if (existing) {
    existing.name = nm;
    existing.mode = s.mode;
    existing.models = [...s.models];
    existing.domains = [...s.domains];
    // Re-save preserves the ORIGIN this preset was first saved with (updating a
    // saved preset does not change who it belongs to). Only fall back to the
    // incoming origin if the existing entry never had one (legacy migration).
    existing.origin = existing.origin ?? s.origin ?? "manual";
    writeArr(SUITES_KEY, all);
    return existing;
  }
  const suite: BenchSuite = { id: newId("ste"), name: nm, mode: s.mode, models: [...s.models], domains: [...s.domains], createdAt: Date.now(), origin: s.origin ?? "manual" };
  writeArr(SUITES_KEY, [...all, suite]);
  return suite;
}
export function deleteSuite(id: string) {
  writeArr(SUITES_KEY, readArr<BenchSuite>(SUITES_KEY).filter((s) => s.id !== id));
}

// ── Scheduled benchmark entries ──────────────────────────────────────────────
// A LIST of independent schedule entries, each with its own cadence, replacing
// the old single-global schedule. Any preset (canonical / AI / saved) can be put
// on its own entry, keyed by a stable id, and many can run at once on different
// cadences. Persisted as JSON in localStorage (same pattern as suites/bundles);
// the client tick in bench.tsx iterates every ENABLED entry and fires each one
// whose (now - lastRun) has passed its cadence, updating only that entry.
export type BenchSchedule = {
  id: string;
  name: string;          // display name (usually the preset name)
  models: string[];      // cli::model keys to run
  domains: string[];     // lowercase domain slugs; empty = all domains
  freq: "daily" | "weekly" | "monthly";
  enabled: boolean;
  lastRun: number;       // epoch ms; 0 = never
};

const SCHEDULES_KEY = "prevail.bench.schedules";

// Legacy single-global schedule keys (bench.tsx BENCH_SCHED). We MIGRATE a real
// custom entry into the new list on first load so an existing schedule is never
// lost, and keep reading them as a fallback when the list is still empty.
const LEGACY = {
  enabled: "prevail.bench.schedule.enabled",
  freq: "prevail.bench.schedule.freq",
  lastRun: "prevail.bench.schedule.lastRun",
  scopeMode: "prevail.bench.schedule.scopeMode",
  scopeModels: "prevail.bench.schedule.scopeModels",
  scopeDomains: "prevail.bench.schedule.scopeDomains",
  migrated: "prevail.bench.schedule.migrated",
};

function normFreq(f: string): BenchSchedule["freq"] {
  return f === "daily" || f === "monthly" ? f : "weekly";
}

// One-time migration: if the old single schedule pinned a concrete "custom"
// model+domain scope, seed the new list with an equivalent entry. Runs once
// (guarded by a flag), and only when the new list is empty, so a user's existing
// scheduled preset carries over. "latest"/"all" legacy modes are not model-scoped
// presets, so there's nothing preset-shaped to migrate for those.
function migrateLegacy(): BenchSchedule[] {
  if (lsGet(LEGACY.migrated, "0") === "1") return [];
  lsSet(LEGACY.migrated, "1");
  const mode = lsGet(LEGACY.scopeMode, "latest");
  if (mode !== "custom") return [];
  const models = lsGet(LEGACY.scopeModels, "").split(",").map((s) => s.trim()).filter(Boolean);
  if (models.length === 0) return [];
  const domains = lsGet(LEGACY.scopeDomains, "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const entry: BenchSchedule = {
    id: newId("sch"),
    name: "Scheduled preset",
    models,
    domains,
    freq: normFreq(lsGet(LEGACY.freq, "weekly") || "weekly"),
    enabled: lsGet(LEGACY.enabled, "0") === "1",
    lastRun: Number(lsGet(LEGACY.lastRun, "0")) || 0,
  };
  return [entry];
}

export function listSchedules(): BenchSchedule[] {
  let arr = readArr<BenchSchedule>(SCHEDULES_KEY);
  if (arr.length === 0) {
    const migrated = migrateLegacy();
    if (migrated.length > 0) {
      writeArr(SCHEDULES_KEY, migrated);
      arr = migrated;
    }
  }
  return arr;
}

// Add or update a schedule keyed by a caller-supplied stable key (its id). If an
// entry with that id exists it is updated in place; otherwise a new one is added.
export function upsertSchedule(entry: Omit<BenchSchedule, "lastRun"> & { lastRun?: number }): BenchSchedule {
  const all = listSchedules();
  const existing = all.find((s) => s.id === entry.id);
  if (existing) {
    existing.name = entry.name;
    existing.models = [...entry.models];
    existing.domains = [...entry.domains];
    existing.freq = entry.freq;
    existing.enabled = entry.enabled;
    if (entry.lastRun != null) existing.lastRun = entry.lastRun;
    writeArr(SCHEDULES_KEY, all);
    return existing;
  }
  const s: BenchSchedule = { ...entry, models: [...entry.models], domains: [...entry.domains], lastRun: entry.lastRun ?? 0 };
  writeArr(SCHEDULES_KEY, [...all, s]);
  return s;
}

export function updateSchedule(id: string, patch: Partial<BenchSchedule>) {
  const all = listSchedules();
  const s = all.find((x) => x.id === id);
  if (!s) return;
  Object.assign(s, patch);
  writeArr(SCHEDULES_KEY, all);
}

export function removeSchedule(id: string) {
  writeArr(SCHEDULES_KEY, listSchedules().filter((s) => s.id !== id));
}

// A stable id for a preset's own schedule entry so scheduling the same preset
// twice updates its entry instead of adding a duplicate.
export function presetScheduleId(name: string): string {
  return `sch-preset-${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

// ── Live hooks ───────────────────────────────────────────────────────────────
function useStore<T>(read: () => T[]): T[] {
  const [items, setItems] = useState<T[]>(read);
  useEffect(() => {
    const sync = () => setItems(read());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync); // cross-tab / other windows
    return () => { window.removeEventListener(EVENT, sync); window.removeEventListener("storage", sync); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return items;
}
export function useBundles(): ModelBundle[] { return useStore(listBundles); }
export function useSuites(): BenchSuite[] { return useStore(listSuites); }
export function useSchedules(): BenchSchedule[] { return useStore(listSchedules); }

// ── Canonical LOCAL presets ──────────────────────────────────────────────────
// A few named presets that RESOLVE over the current model universe with no AI
// and no network, so they always work offline and auto-update as models appear
// or disappear. The Arena passes in the live model list it already enumerated;
// each preset is just a filter over it. These sit above the AI suggestions as
// always-present one-tap rows, and can be Applied / Run / Saved like any preset.
//
// `AvailablePresetModel` is the desktop's enumerated model, shaped to what these
// filters need. `provider` is the cli id (used for one-per-provider grouping);
// `local` marks open-weight / locally hosted runtimes (harness, ollama, lmstudio,
// mlx); `validated` marks a runtime that verified end-to-end.
export type AvailablePresetModel = {
  key: string;        // "cli::model"
  provider: string;   // cli id
  local: boolean;
  validated: boolean;
};

export type CanonicalPreset = { name: string; rationale: string; models: string[] };

export function canonicalPresets(available: AvailablePresetModel[]): CanonicalPreset[] {
  const out: CanonicalPreset[] = [];
  const cap = (models: string[]): string[] => models.slice(0, 6); // keep presets tight

  const validated = available.filter((m) => m.validated);
  if (validated.length >= 2) {
    out.push({
      name: "All validated",
      rationale: "Every model whose runtime is verified and ready to run.",
      models: cap(validated.map((m) => m.key)),
    });
  }

  const local = available.filter((m) => m.local);
  if (local.length >= 1) {
    out.push({
      name: "Local / open models",
      rationale: "Open-weight and locally hosted models. Runs fully offline.",
      models: cap(local.map((m) => m.key)),
    });
  }

  const cloud = available.filter((m) => !m.local);
  if (cloud.length >= 2) {
    out.push({
      name: "Cloud only",
      rationale: "The hosted frontier providers, head to head.",
      models: cap(cloud.map((m) => m.key)),
    });
  }

  // One per provider: the first enumerated (flagship / curated-first) model of
  // each detected provider. Order follows the order models were passed in.
  const seenProvider = new Set<string>();
  const onePer: string[] = [];
  for (const m of available) {
    if (seenProvider.has(m.provider)) continue;
    seenProvider.add(m.provider);
    onePer.push(m.key);
  }
  if (onePer.length >= 2) {
    out.push({
      name: "One per provider",
      rationale: "A single representative model from each detected provider.",
      models: cap(onePer),
    });
  }

  // Never surface an empty or single-model preset (a benchmark needs >= 2).
  return out.filter((p) => p.models.length >= 2);
}
