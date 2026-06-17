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
};

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
    writeArr(SUITES_KEY, all);
    return existing;
  }
  const suite: BenchSuite = { id: newId("ste"), name: nm, mode: s.mode, models: [...s.models], domains: [...s.domains], createdAt: Date.now() };
  writeArr(SUITES_KEY, [...all, suite]);
  return suite;
}
export function deleteSuite(id: string) {
  writeArr(SUITES_KEY, readArr<BenchSuite>(SUITES_KEY).filter((s) => s.id !== id));
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
