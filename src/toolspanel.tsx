// Tools — Prevail's governed capability layer (the Hermes "toolsets" idea, wrapped
// in Prevail's trust model). Tools are the VERBS the agent acts through, distinct
// from Apps (your services) and Skills (your recipes). This surface makes the
// construct legible: what each capability is, whether it's available now, and how
// it's governed. Reads a few live settings so the governance state is honest.
import { useEffect, useState } from "react";
import { isBunkerOn } from "./storage";

type State = "on" | "governed" | "soon";
interface Tool {
  name: string;
  glyph: string;
  desc: string;
  governance: string;
  state: State;
}

const STATE_LABEL: Record<State, string> = { on: "available", governed: "governed", soon: "coming" };

export function ToolsPanel() {
  // Live governance signal so the surface tells the truth about current state.
  const [bunker, setBunker] = useState(false);
  useEffect(() => {
    const sync = () => setBunker(isBunkerOn());
    sync();
    window.addEventListener("prevail:bunker-changed", sync);
    return () => window.removeEventListener("prevail:bunker-changed", sync);
  }, []);
  const web = !bunker; // Web access is a per-domain toggle; Bunker hard-disables it.

  const tools: Tool[] = [
    {
      name: "Connectors", glyph: "⚭",
      desc: "Call your connected apps' tools — Gmail, AllTrails, QuickBooks — over MCP. Pass-through connectors you authorized in Claude Code / Codex / Gemini ride here too.",
      governance: "Per-app connection + the autonomy brake. Consequential writes queue for your approval.",
      state: "on",
    },
    {
      name: "Browser", glyph: "◍",
      desc: "Drive a real browser: open a site, log in once, learn the steps, and replay them fast later — for apps with no API or MCP.",
      governance: bunker ? "Off in Bunker Mode (no network leaves this device)." : "Per-connector setup; runs in a dedicated profile scoped to the site.",
      state: bunker ? "soon" : "on",
    },
    {
      name: "Memory", glyph: "◇",
      desc: "Remember and recall durable facts in your vault, so context carries across conversations.",
      governance: "Vault-scoped; never leaves your device. Incognito turns it off per-chat.",
      state: "on",
    },
    {
      name: "Loops", glyph: "↻",
      desc: "Schedule recurring work — a Sunday briefing, a weekly review — as durable Prevail loops.",
      governance: "Each loop has an autonomy dial: suggest (propose, you approve) up to auto.",
      state: "governed",
    },
    {
      name: "Web search", glyph: "◎",
      desc: "Fetch URLs and search the web while answering.",
      governance: web && !bunker ? "On — the per-domain Web access toggle controls it." : "Off — turn on Web access (and leave Bunker Mode) to enable.",
      state: web && !bunker ? "on" : "governed",
    },
    {
      name: "Computer use", glyph: "▢",
      desc: "Control the desktop — screenshots, mouse, keyboard — for tasks with no API at all.",
      governance: "Will require explicit per-action approval; gated by the autonomy brake.",
      state: "soon",
    },
    {
      name: "Code execution", glyph: "‹›",
      desc: "Run code to compute, transform, or call tools programmatically (fewer model round-trips).",
      governance: "Sandboxed and approval-gated when wired.",
      state: "soon",
    },
    {
      name: "Delegation", glyph: "⋔",
      desc: "Spawn focused sub-agents with isolated context for a complex subtask, then fold the result back.",
      governance: "Inherits the parent run's autonomy and spend caps.",
      state: "soon",
    },
  ];

  const dot = (s: State) => (s === "on" ? "var(--ok, #66a67e)" : s === "governed" ? "var(--accent, #e0913f)" : "var(--text-muted, #8f8579)");

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="mb-1 flex items-center gap-2 font-display text-2xl font-semibold text-text-primary">
          <span className="flex h-7 w-7 items-center justify-center rounded-md border border-accent-border bg-accent-soft text-accent">⛭</span>
          Tools
        </div>
        <p className="mb-6 max-w-2xl text-[15px] leading-relaxed text-text-secondary">
          The capabilities your AI acts through — distinct from <span className="font-semibold text-text-primary">Apps</span> (your services) and <span className="font-semibold text-text-primary">Skills</span> (your recipes). Every tool is governed by Prevail's trust model: the autonomy brake, privacy locks, and spend caps. In an Act run you see exactly which tools ran.
        </p>

        <div className="flex flex-col gap-2.5">
          {tools.map((t) => (
            <div key={t.name} className="rounded-xl border border-border bg-surface p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-warm font-mono text-[15px] text-text-secondary">{t.glyph}</span>
                <span className="text-[15px] font-semibold text-text-primary">{t.name}</span>
                <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-border-subtle px-2.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: dot(t.state) }} /> {STATE_LABEL[t.state]}
                </span>
              </div>
              <p className="mt-2 text-[13.5px] leading-relaxed text-text-secondary">{t.desc}</p>
              <p className="mt-1.5 text-[12px] leading-snug text-text-muted"><span className="font-mono text-[10px] uppercase tracking-wider">governance</span> · {t.governance}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
