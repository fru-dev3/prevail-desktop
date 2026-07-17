import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { EngineApp, Domain } from "./types";

// Headless render check for the Map panel: it must mount with real-shaped data,
// show domain tiles + chips + the agency %, and route an organize action to the
// right backend command. This is the automated stand-in for opening the tab.

const domains: Domain[] = [
  { name: "dev", path: "/v/data/domains/dev", has_state: true, state_preview: null },
  { name: "wealth", path: "/v/data/domains/wealth", has_state: true, state_preview: null },
];
const apps: EngineApp[] = [
  {
    id: "github", title: "GitHub", integration: "cli", status: "connected", configured: true,
    domains: ["dev"], lastSuccessTs: 1700000000000, lastError: null, account: null,
    refresh: null, autonomy: "read-only", connections: null, enabled: true, community: true, path: "/v/data/apps/github",
  },
  {
    id: "gdrive", title: "Google Drive", integration: "oauth", status: "connected", configured: true,
    domains: ["wealth"], lastSuccessTs: 1700000000000, lastError: null, account: { label: "user@example.com" },
    refresh: null, autonomy: "read-only", connections: null, enabled: true, community: true, path: "/v/data/apps/gdrive",
  },
];

const invokeMock = vi.fn(async (cmd: string) => {
  switch (cmd) {
    case "engine_apps_list": return apps;
    case "scan_vault": return domains;
    case "machine_host": return "test-host";
    case "engine_app_add": return { ok: true };
    case "engine_app_set_domains": return { ok: true, domains: [] };
    case "tasks_add": return [];
    default: return undefined;
  }
});
vi.mock("./bridge", () => ({
  invoke: (...a: unknown[]) => invokeMock(...(a as [string])),
  listen: vi.fn(async () => () => {}),
}));

import { MapPanel } from "./mappanel";

beforeEach(() => { invokeMock.mockClear(); localStorage.clear(); });

describe("MapPanel renders and acts", () => {
  it("mounts with data: domain tiles, a chip, the agency %, and the machine stamp", async () => {
    render(<MapPanel vaultPath="/v" />);
    await waitFor(() => expect(screen.getByText("Dev")).toBeTruthy());
    // Both domains render as tiles.
    expect(screen.getByText("Wealth")).toBeTruthy();
    // Owned tools show as chips.
    expect(screen.getByText("GitHub")).toBeTruthy();
    // The machine-local stamp names the host.
    expect(screen.getByText(/test-host/)).toBeTruthy();
    // Overall agent-operable percent is shown.
    expect(screen.getByText("agent-operable")).toBeTruthy();
  });

  it("broadcasts the agency score for the sidebar chip", async () => {
    render(<MapPanel vaultPath="/v" />);
    await waitFor(() => expect(localStorage.getItem("prevail:agency-score")).not.toBeNull());
    expect(Number(localStorage.getItem("prevail:agency-score"))).toBeGreaterThanOrEqual(0);
  });

  it("Add recommended routes to engine_app_add (accept a best-practice stack)", async () => {
    render(<MapPanel vaultPath="/v" />);
    await waitFor(() => expect(screen.getByText("Dev")).toBeTruthy());
    // The dev tile has suggestions (seed minus GitHub), so an "Add recommended" appears.
    const addBtns = await screen.findAllByText(/Add recommended/);
    fireEvent.click(addBtns[0]!);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("engine_app_add", expect.objectContaining({ vault: "/v" })));
  });

  it("Google identity is shown on the chip", async () => {
    render(<MapPanel vaultPath="/v" />);
    await waitFor(() => expect(screen.getByText("Google Drive")).toBeTruthy());
    expect(screen.getByText(/fru\.dev3/)).toBeTruthy();
  });
});
