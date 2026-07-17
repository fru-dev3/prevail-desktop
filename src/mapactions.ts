// Map: organize actions (Phase 3). Thin wrappers over the app-registry mutation
// commands so the Map panel can move tools between domains, add best-practice
// suggestions into a domain, and remove tools. All writes go through the same
// engine commands the Apps panel uses, so adoption/union semantics are shared.

import { invoke } from "./bridge";
import type { MapTool } from "./map";
import type { ToolStatus } from "./mapseed";

// A seed tool's status implies a starting integration type for the scaffolded
// app. The user refines it when they actually connect (Phase 4); the catalog
// already carries the right type for known apps, and engine_app_add ADOPTS an
// existing folder (unioning domains) rather than clobbering it.
function integrationFor(status: ToolStatus): string {
  switch (status) {
    case "cli":
      return "cli";
    case "api":
    case "research":
      return "api";
    case "connected":
    case "mcp":
      return "mcp";
    case "browser":
      return "browser";
    default:
      return "manual"; // gap / hardware / broken
  }
}

// Slugify a tool name into a stable app id (matches how catalog ids look).
export function toolIdFor(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// Accept a (usually suggested) tool into a domain. Adopts an existing catalog
// app or scaffolds a new one, and unions this domain onto it.
export async function acceptTool(vaultPath: string, domainSlug: string, tool: MapTool): Promise<void> {
  const id = tool.appId || toolIdFor(tool.name);
  await invoke("engine_app_add", {
    vault: vaultPath,
    id,
    title: tool.name,
    integration: integrationFor(tool.status),
    domains: [domainSlug],
    mcpCommand: null,
    mcpInstall: null,
  });
  // Carry the expected identity onto the app when the seed declares one.
  if (tool.identity) {
    try { await invoke("engine_app_set_account", { id, label: tool.identity, address: null }); } catch { /* best-effort */ }
  }
}

// Accept every suggested, connectable tool in a domain at once (the "bring in
// the best-practice stack" action). Skips gaps and hardware, which are not
// things you authenticate.
export async function acceptStack(vaultPath: string, domainSlug: string, tools: MapTool[]): Promise<number> {
  const targets = tools.filter((t) => t.suggested && t.status !== "gap" && t.status !== "hardware");
  let n = 0;
  for (const t of targets) {
    try { await acceptTool(vaultPath, domainSlug, t); n++; } catch { /* continue; report count */ }
  }
  return n;
}

// Set the full domain list for an owned tool (used for move + remove).
export async function setToolDomains(vaultPath: string, appId: string, domains: string[]): Promise<void> {
  await invoke("engine_app_set_domains", { id: appId, domains, vault: vaultPath });
}

// Remove a tool from one domain (leaving it in any others it belongs to).
export async function removeToolFromDomain(
  vaultPath: string,
  appId: string,
  currentDomains: string[],
  domainSlug: string,
): Promise<void> {
  const next = currentDomains.filter((d) => d.toLowerCase() !== domainSlug.toLowerCase());
  await setToolDomains(vaultPath, appId, next);
}

// Turn a GAP (missing coverage) into an actionable task in the domain, so a
// hole in the map becomes something the steward/loops can pick up.
export async function fileGapTask(vaultPath: string, domainSlug: string, toolName: string): Promise<void> {
  await invoke("tasks_add", {
    vault: vaultPath,
    domain: domainSlug,
    text: `Set up ${toolName} (Map gap)`,
    source: "map",
  });
}

// File a task to connect a missing multi-account identity a domain needs (e.g.
// "connect account2@example.com so agents can reach real-estate mail").
export async function fileIdentityTask(vaultPath: string, domainSlug: string, identity: string): Promise<void> {
  await invoke("tasks_add", {
    vault: vaultPath,
    domain: domainSlug,
    text: `Connect the ${identity} Google account so agents can reach this domain (Map)`,
    source: "map",
  });
}

// Move a tool from one domain to another (remove from src, add to dest).
export async function moveTool(
  vaultPath: string,
  appId: string,
  currentDomains: string[],
  fromSlug: string,
  toSlug: string,
): Promise<void> {
  const set = new Set(currentDomains.map((d) => d.toLowerCase()));
  set.delete(fromSlug.toLowerCase());
  set.add(toSlug.toLowerCase());
  await setToolDomains(vaultPath, appId, [...set]);
}
