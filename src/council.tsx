// Subsystem extracted from App.tsx (encapsulated module state).
import { useEffect, useState } from "react";
import { Crown } from "lucide-react";
import { MODELS, MODEL_SEP } from "./constants";
import { titleCase } from "./format";
import { modelLabel } from "./helpers2";
import { ProviderMark } from "./marks";
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

// G2 (Monday feedback): the council panel, visualized in the chat canvas (not only
// in Settings). Each member shows icon + provider + specific model name; the chair
// is crowned. Reads live — settings dispatches "prevail:council-changed" on edit.
export function CouncilPanelStrip({ className = "" }: { className?: string }) {
  const [members, setMembers] = useState<string[]>(() => readCouncilMembers());
  const [chair, setChair] = useState<string>(() => readCouncilChair());
  useEffect(() => {
    const sync = () => { setMembers(readCouncilMembers()); setChair(readCouncilChair()); };
    window.addEventListener("prevail:council-changed", sync);
    window.addEventListener("focus", sync);
    return () => { window.removeEventListener("prevail:council-changed", sync); window.removeEventListener("focus", sync); };
  }, []);
  if (members.length === 0) return null;
  const ordered = [chair, ...members.filter((m) => m && m !== chair)].filter(Boolean);
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      <span className="font-mono text-[9px] uppercase tracking-wider text-text-muted">Council</span>
      {ordered.map((key) => {
        const [cli, model] = key.split(MODEL_SEP);
        const isChair = key === chair;
        return (
          <span key={key} title={`${titleCase(cli)} · ${modelLabel(cli, model) || model}${isChair ? " (chair)" : ""}`}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 ${isChair ? "border-accent-border bg-accent-soft" : "border-border-subtle bg-surface"}`}>
            <ProviderMark vendor={cli} size={12} />
            <span className="font-mono text-[10px] text-text-secondary">{titleCase(cli)} · {modelLabel(cli, model) || model}</span>
            {isChair && <Crown className="h-2.5 w-2.5 text-accent" />}
          </span>
        );
      })}
    </div>
  );
}

// Council config — its own first-class section. You pick the EXACT models on the
// default panel (per-provider, multiple models allowed) and which one chairs.
