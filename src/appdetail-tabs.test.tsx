import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { EngineApp } from "./types";

// Headless verification of the UNIFIED app-detail surface: AppDetail must expose
// the operational facets (Runs / Loops / Settings / Domains) that were merged in
// from AppFacetPanel, and switching to each must mount without crashing. This is
// the automated stand-in for clicking the native GUI: it proves the refactor's
// tab set renders and the embedded AppFacetPanel mounts for each facet.

// Broad invoke stub: every backend call a connected app's detail makes resolves
// to a sensible empty value so the component (and the embedded AppFacetPanel)
// render fully headlessly.
const invokeMock = vi.fn(async (cmd: string) => {
  switch (cmd) {
    case "engine_app_skills": return [];
    case "engine_app_get_soul": return { soul: "" };
    case "app_context": return { state: null, journal: null, decisions: null, recent_logs: [] };
    case "scan_vault": return [];
    case "engine_app_runs": return { runs: [], nextDueTs: null, consecutiveFailures: 0 };
    case "engine_appmode_get": return { mode: "production" };
    case "read_domain_ideal": return "";
    case "read_file": return "";
    default: return undefined;
  }
});
vi.mock("./bridge", () => ({
  invoke: (...a: unknown[]) => invokeMock(...(a as [string])),
  listen: vi.fn(async () => () => {}),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

import { AppDetail } from "./appspanel";

const connectedApp: EngineApp = {
  id: "acme", title: "Acme", integration: "api", status: "connected", configured: true,
  domains: ["work"], lastSuccessTs: 1700000000000, lastError: null, account: null,
  refresh: null, autonomy: "read-only", connections: null, enabled: true, community: true,
  path: "/v/data/apps/acme",
};

function renderDetail() {
  return render(
    <AppDetail
      app={connectedApp}
      vaultPath="/v"
      logos={{}}
      status="connected"
      busy={false}
      onSync={async () => {}}
      onSetEnabled={() => {}}
      onReload={() => {}}
    />,
  );
}

beforeEach(() => { invokeMock.mockClear(); localStorage.clear(); });

describe("AppDetail - unified app-detail surface (the two surfaces merged into one)", () => {
  it("exposes both the rich tabs AND the operational facets for a connected app", async () => {
    renderDetail();
    // Rich connector tabs.
    for (const label of ["Welcome", "Ideal State", "Journal", "Skills", "Connections", "Chat"]) {
      expect(screen.getByRole("button", { name: new RegExp(`^${label}$`, "i") })).toBeInTheDocument();
    }
    // Operational facets ported from AppFacetPanel - the heart of the unification.
    for (const label of ["Runs", "Loops", "Settings", "Domains"]) {
      expect(screen.getByRole("button", { name: new RegExp(`^${label}$`, "i") })).toBeInTheDocument();
    }
  });

  it("mounts the embedded AppFacetPanel for each operational tab without crashing", async () => {
    renderDetail();
    for (const label of ["Runs", "Settings", "Domains", "Loops"]) {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${label}$`, "i") }));
      // If the embedded AppFacetPanel threw on mount, the tree would unmount and
      // this query would throw. Surviving == that facet rendered.
      await waitFor(() =>
        expect(screen.getByRole("button", { name: /^Welcome$/i })).toBeInTheDocument(),
      );
    }
  });
});
