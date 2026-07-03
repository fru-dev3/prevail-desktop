// Tools - Prevail's governed capability layer (the Hermes "toolsets" idea, wrapped
// in Prevail's trust model). Tools are the VERBS the agent acts through, distinct
// from Apps (your services) and Skills (your recipes). This surface makes the
// construct legible AND actionable: what each capability is, whether it is
// available now, how it is governed, and a jump straight to where you control it.
// Reads a few live settings so the governance state is honest.
import { useMemo, useState, useEffect } from "react";
import { Hammer, Search, Plus, ArrowUpRight } from "lucide-react";
import { isBunkerOn } from "./storage";
import { SettingsHeader } from "./sectionutil";

type State = "on" | "governed" | "soon";
interface Tool {
  name: string;
  glyph: string;
  desc: string;
  governance: string;
  state: State;
  // Where you actually control this capability. Absent for "soon" tools.
  manage?: { label: string; section: string };
}

const STATE_LABEL: Record<State, string> = { on: "available", governed: "governed", soon: "coming" };

// Jump to the settings surface that actually governs a tool. We render inside the
// Editor's section router, so a settings-section event switches the page in place.
function goTo(section: string) {
  window.dispatchEvent(new CustomEvent("prevail:settings-section", { detail: section }));
}

export function ToolsPanel() {
  const [bunker, setBunker] = useState(false);
  const [q, setQ] = useState("");
  useEffect(() => {
    const sync = () => setBunker(isBunkerOn());
    sync();
    window.addEventListener("prevail:bunker-changed", sync);
    return () => window.removeEventListener("prevail:bunker-changed", sync);
  }, []);
  const web = !bunker; // Web access is a per-domain toggle; Bunker hard-disables it.

  const tools: Tool[] = useMemo(() => [
    {
      name: "Connectors", glyph: "⚭",
      desc: "Call your connected apps' tools (Gmail, AllTrails, QuickBooks) over MCP. Pass-through connectors you authorized in Claude Code, Codex, or Gemini ride here too.",
      governance: "Per-app connection plus the autonomy brake. Consequential writes queue for your approval.",
      state: "on",
      manage: { label: "Manage in Apps", section: "connectors" },
    },
    {
      name: "Browser", glyph: "◍",
      desc: "Drive a real browser: open a site, log in once, learn the steps, and replay them fast later. For apps with no API or MCP.",
      governance: bunker ? "Off in Bunker Mode (no network leaves this device)." : "Per-connector setup; runs in a dedicated profile scoped to the site.",
      state: bunker ? "soon" : "on",
      manage: { label: "Set up in Apps", section: "connectors" },
    },
    {
      name: "Memory", glyph: "◇",
      desc: "Remember and recall durable facts in your vault, so context carries across conversations.",
      governance: "Vault-scoped; never leaves your device. Incognito turns it off per-chat.",
      state: "on",
      manage: { label: "Privacy settings", section: "privacy" },
    },
    {
      name: "Loops", glyph: "↻",
      desc: "Schedule recurring work (a Sunday briefing, a weekly review) as durable Prevail loops.",
      governance: "Each loop has an autonomy dial: suggest (propose, you approve) up to auto.",
      state: "governed",
      manage: { label: "Autonomy dial", section: "autonomy" },
    },
    {
      name: "Web search", glyph: "◎",
      desc: "Fetch URLs and search the web while answering.",
      governance: web && !bunker ? "On. The per-domain Web access toggle controls it." : "Off. Turn on Web access (and leave Bunker Mode) to enable.",
      state: web && !bunker ? "on" : "governed",
      manage: { label: "Privacy & web access", section: "privacy" },
    },
    {
      name: "Computer use", glyph: "▢",
      desc: "Control the desktop (screenshots, mouse, keyboard) for tasks with no API at all.",
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
  ], [bunker, web]);

  const dot = (s: State) => (s === "on" ? "var(--ok, #66a67e)" : s === "governed" ? "var(--accent, #e0913f)" : "var(--text-muted, #8f8579)");

  const query = q.trim().toLowerCase();
  const shown = useMemo(
    () => tools.filter((t) => !query || [t.name, t.desc, t.governance].some((s) => s.toLowerCase().includes(query))),
    [tools, query],
  );
  const liveCount = tools.filter((t) => t.state !== "soon").length;

  return (
    <div className="w-full">
      <SettingsHeader
        icon={Hammer}
        title="Tools"
        subtitle="The capabilities your AI acts through, distinct from Apps (your services) and Skills (your recipes). Every tool is governed by Prevail's trust model: the autonomy brake, privacy locks, and spend caps. In an Act run you see exactly which tools ran."
      />

      {/* Toolbar: search + add. Full width, matching the other Editor pages. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search tools..."
            className="w-full rounded-lg border border-border bg-background py-1.5 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-border focus:outline-none"
          />
        </div>
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">{liveCount} active</span>
        <button
          onClick={() => goTo("mcp")}
          title="Add a capability by connecting an MCP server or an app"
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-background transition-colors hover:bg-accent-hover"
        >
          <Plus className="h-4 w-4" /> Add tool
        </button>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface p-8 text-center text-sm text-text-muted">
          No tools match "{q}".
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {shown.map((t) => (
            <div key={t.name} className="flex flex-col rounded-xl border border-border bg-surface p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-warm font-mono text-[15px] text-text-secondary">{t.glyph}</span>
                <span className="text-[15px] font-semibold text-text-primary">{t.name}</span>
                <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-border-subtle px-2.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: dot(t.state) }} /> {STATE_LABEL[t.state]}
                </span>
              </div>
              <p className="mt-2 text-[13.5px] leading-relaxed text-text-secondary">{t.desc}</p>
              <p className="mt-1.5 text-[12px] leading-snug text-text-muted"><span className="font-mono text-[10px] uppercase tracking-wider">governance</span> · {t.governance}</p>
              <div className="mt-auto pt-3">
                {t.manage ? (
                  <button
                    onClick={() => goTo(t.manage!.section)}
                    className="inline-flex items-center gap-1 rounded-md border border-border-subtle px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-text-secondary transition-colors hover:border-accent-border hover:text-accent"
                  >
                    {t.manage.label} <ArrowUpRight className="h-3 w-3" />
                  </button>
                ) : (
                  <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">Not yet available</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
