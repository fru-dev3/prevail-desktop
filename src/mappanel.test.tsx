import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { EngineApp, Domain } from "./types";

// Headless render check for the Map panel: it must mount with real-shaped data,
// show domain tiles + chips + the agent-operable %, and route an organize action to the
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
    case "ingestion_connector_logos": return {};
    case "app_favicon": return "";
    case "engine_app_add": return { ok: true };
    case "engine_app_set_domains": return { ok: true, domains: [] };
    case "engine_obsidian_import": return { ok: true, imported: 12, domain: "notes" };
    case "tasks_add": return [];
    default: return undefined;
  }
});
vi.mock("./bridge", () => ({
  invoke: (...a: unknown[]) => invokeMock(...(a as [string])),
  listen: vi.fn(async () => () => {}),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(async () => "/Users/me/ObsidianVault") }));

import { MapPanel } from "./mappanel";

beforeEach(() => { invokeMock.mockClear(); localStorage.clear(); });

// Domain rows are collapsed by default (clean overview); tool chips live in the
// expanded detail. Expand every row so chip-level assertions can see them.
const expandAll = () => screen.getAllByTitle("Expand").forEach((b) => fireEvent.click(b));

describe("MapPanel renders and acts", () => {
  it("mounts with data: domain tiles, a chip, the agent-operable %, and the machine stamp", async () => {
    render(<MapPanel vaultPath="/v" />);
    await waitFor(() => expect(screen.getByText("Dev")).toBeTruthy());
    // Both domains render as rows.
    expect(screen.getByText("Wealth")).toBeTruthy();
    // Owned tools show as chips once the row is expanded.
    expandAll();
    expect(screen.getByText("GitHub")).toBeTruthy();
    // The machine-local stamp names the host.
    expect(screen.getByText(/test-host/)).toBeTruthy();
    // Overall agent-operable percent is shown.
    expect(screen.getByText("agent-operable")).toBeTruthy();
  });

  it("broadcasts the map score for the sidebar chip (no 'agency' wording)", async () => {
    render(<MapPanel vaultPath="/v" />);
    await waitFor(() => expect(localStorage.getItem("prevail:map-score")).not.toBeNull());
    expect(Number(localStorage.getItem("prevail:map-score"))).toBeGreaterThanOrEqual(0);
  });

  it("Add recommended routes to engine_app_add (accept a best-practice stack)", async () => {
    render(<MapPanel vaultPath="/v" />);
    await waitFor(() => expect(screen.getByText("Dev")).toBeTruthy());
    expandAll();
    // The dev row has suggestions (seed minus GitHub), so an "Add all recommended" appears.
    const addBtns = await screen.findAllByText(/Add all recommended/);
    fireEvent.click(addBtns[0]!);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("engine_app_add", expect.objectContaining({ vault: "/v" })));
  });

  it("Google identity is shown on the chip", async () => {
    render(<MapPanel vaultPath="/v" />);
    await waitFor(() => expect(screen.getByText("Wealth")).toBeTruthy());
    expandAll();
    expect(screen.getByText("Google Drive")).toBeTruthy();
    expect(screen.getByText(/fru\.dev3/)).toBeTruthy();
  });

  it("never uses the word 'agency' anywhere in the UI", async () => {
    const { container } = render(<MapPanel vaultPath="/v" />);
    await waitFor(() => expect(screen.getByText("Dev")).toBeTruthy());
    expect(container.textContent?.toLowerCase()).not.toContain("agency");
  });

  it("clicking a tool opens its app detail page (prevail:open-app)", async () => {
    const opened: unknown[] = [];
    const onOpen = (e: Event) => opened.push((e as CustomEvent).detail);
    window.addEventListener("prevail:open-app", onOpen);
    render(<MapPanel vaultPath="/v" />);
    await waitFor(() => expect(screen.getByText("Dev")).toBeTruthy());
    expandAll();
    fireEvent.click(screen.getByText("GitHub"));
    await waitFor(() => expect(opened.length).toBeGreaterThan(0));
    expect((opened[0] as EngineApp).id).toBe("github");
    window.removeEventListener("prevail:open-app", onOpen);
  });

  it("Import Obsidian opens the flow, picks a folder, and runs the import", async () => {
    render(<MapPanel vaultPath="/v" />);
    await waitFor(() => expect(screen.getByText("Dev")).toBeTruthy());
    fireEvent.click(screen.getByText("Import Obsidian"));
    await waitFor(() => expect(screen.getByText("Import an Obsidian vault")).toBeTruthy());
    // Pick the folder (dialog mocked to return a path), then Import.
    fireEvent.click(screen.getByText("Choose folder..."));
    await waitFor(() => expect(screen.getByText("/Users/me/ObsidianVault")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("engine_obsidian_import", expect.objectContaining({ from: "/Users/me/ObsidianVault", vault: "/v" })));
    await waitFor(() => expect(screen.getByText(/Imported/)).toBeTruthy());
  });

  it("isolating a status filters across domains (hides non-matching)", async () => {
    render(<MapPanel vaultPath="/v" />);
    await waitFor(() => expect(screen.getByText("Dev")).toBeTruthy());
    // Dev has CLI tools (github + seed); the wealth stack has none. Isolate CLI.
    fireEvent.click(screen.getByRole("button", { name: "CLI" }));
    await waitFor(() => expect(screen.getByText(/Showing only/)).toBeTruthy());
    expect(screen.getByText("Dev")).toBeTruthy();
    expect(screen.queryByText("Wealth")).toBeNull();
  });

  it("is titled Source (renamed from Map)", async () => {
    render(<MapPanel vaultPath="/v" />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Source" })).toBeTruthy());
  });

  it("separates recommended tools under a Recommended heading", async () => {
    render(<MapPanel vaultPath="/v" />);
    await waitFor(() => expect(screen.getByText("Dev")).toBeTruthy());
    expandAll();
    // Dev has seed suggestions beyond GitHub, so the group label shows once expanded.
    await waitFor(() => expect(screen.getAllByText("Recommended").length).toBeGreaterThan(0));
  });

  it("clicking a domain title opens that domain (prevail:open-domain)", async () => {
    const opened: unknown[] = [];
    const onDom = (e: Event) => opened.push((e as CustomEvent).detail);
    window.addEventListener("prevail:open-domain", onDom);
    render(<MapPanel vaultPath="/v" />);
    await waitFor(() => expect(screen.getByText("Dev")).toBeTruthy());
    fireEvent.click(screen.getByText("Dev"));
    await waitFor(() => expect(opened).toContain("dev"));
    window.removeEventListener("prevail:open-domain", onDom);
  });

  it("an Add app affordance routes to the connectors surface", async () => {
    const opened: unknown[] = [];
    const onSet = (e: Event) => opened.push((e as CustomEvent).detail);
    window.addEventListener("prevail:open-settings", onSet);
    render(<MapPanel vaultPath="/v" />);
    await waitFor(() => expect(screen.getByText("Dev")).toBeTruthy());
    expandAll();
    const addApp = await screen.findAllByText("Add app");
    fireEvent.click(addApp[0]!);
    await waitFor(() => expect(opened).toContain("connectors"));
    window.removeEventListener("prevail:open-settings", onSet);
  });
});
