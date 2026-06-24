// User-pinned OpenRouter models. The live catalog is 300+ models; the user pins
// the ones they actually use, and those then appear as selectable defaults
// EVERYWHERE OpenRouter models are offered (the Settings chips + the Chat /
// Council / Benchmark model pickers). localStorage-backed with live listeners,
// so a pin toggled in Settings updates every open picker at once. Mirrors
// appfavorites.ts. We store the full ModelPick (not just the id) so a pinned
// model renders its label even before the live catalog has loaded.
import { useEffect, useState } from "react";
import type { ModelPick } from "./types";

const PIN_KEY = "prevail.model.openrouter.pins";
const pinListeners = new Set<() => void>();

export function readOpenrouterPins(): ModelPick[] {
  try {
    const v = JSON.parse(localStorage.getItem(PIN_KEY) || "[]");
    return Array.isArray(v) ? v.filter((m): m is ModelPick => !!m && typeof m.id === "string") : [];
  } catch {
    return [];
  }
}

export function isOpenrouterPinned(id: string): boolean {
  return readOpenrouterPins().some((m) => m.id === id);
}

// Pin (idempotent) / unpin a model by id. Pass the full ModelPick so the chip
// and pickers can show its label without the live catalog being loaded.
export function toggleOpenrouterPin(model: ModelPick): void {
  const cur = readOpenrouterPins();
  const next = cur.some((m) => m.id === model.id)
    ? cur.filter((m) => m.id !== model.id)
    : [...cur, { id: model.id, label: model.label || model.id, blurb: model.blurb }];
  try { localStorage.setItem(PIN_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  pinListeners.forEach((l) => l());
  // Every model picker re-renders on this event (same one the live-catalog
  // refresh fires), so a pin toggled in Settings shows up immediately in the
  // Chat / Council / Benchmark pickers without a reload.
  try { window.dispatchEvent(new Event("prevail:models-refreshed")); } catch { /* SSR/no-window */ }
}

export function useOpenrouterPins(): ModelPick[] {
  const [pins, setPins] = useState<ModelPick[]>(readOpenrouterPins);
  useEffect(() => {
    const l = () => setPins(readOpenrouterPins());
    pinListeners.add(l);
    return () => { pinListeners.delete(l); };
  }, []);
  return pins;
}

// The OpenRouter models to offer everywhere: the built-in curated defaults plus
// the user's pins, deduped by id (a pin that matches a curated entry shows once).
// Used by Settings + every model picker so pins surface consistently.
export function mergeOpenrouterPicks(curated: ModelPick[], pins: ModelPick[]): ModelPick[] {
  const seen = new Set<string>();
  const out: ModelPick[] = [];
  for (const m of [...curated, ...pins]) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out;
}
