import { describe, it, expect, vi } from "vitest";
import type { EngineApp } from "./types";

// maploader imports invoke from ./bridge; stub it so importing the module is safe.
vi.mock("./bridge", () => ({ invoke: vi.fn(async () => undefined), listen: vi.fn(async () => () => {}) }));

import { probeFromApp } from "./maploader";
import { buildMapModel } from "./mapbuild";

function app(over: Partial<EngineApp>): EngineApp {
  return {
    id: "x", title: "X", integration: "browser", status: "", configured: true,
    domains: [], lastSuccessTs: null, lastError: null, account: null, refresh: null,
    connections: null, enabled: true, community: true, ...over,
  } as EngineApp;
}

describe("probeFromApp - only a truly connected app counts as wired", () => {
  it("a freshly-added / authorized app (no successful sync) is NOT ok=true", () => {
    // configured, no lastSuccessTs, no firstFetchOk, no error => appStatus 'authorized'.
    const p = probeFromApp(app({ id: "voter", integration: "browser" }));
    expect(p.ok).toBeUndefined(); // falls back to the declared integration reach
  });
  it("a synced app (lastSuccessTs) is connected -> ok=true", () => {
    const p = probeFromApp(app({ id: "gmail", integration: "oauth", lastSuccessTs: 1700000000000 }));
    expect(p.ok).toBe(true);
  });
  it("a failing app (lastError) is broken -> ok=false", () => {
    const p = probeFromApp(app({ id: "qbo", integration: "api", lastError: "token expired" }));
    expect(p.ok).toBe(false);
  });
});

describe("adding recommended browser/api tools does NOT jump a domain to 100%", () => {
  it("three freshly-added browser tools score by their integration, not connected", () => {
    // Simulate the Civic case: 3 tools just added (authorized, never synced).
    const apps: EngineApp[] = [
      app({ id: "voter-registration", integration: "browser", domains: ["civic"] }),
      app({ id: "local-city-county-portal", integration: "browser", domains: ["civic"] }),
      app({ id: "representatives-lookup", integration: "api", domains: ["civic"] }),
    ];
    const probes = apps.map(probeFromApp); // all ok=undefined (authorized)
    const m = buildMapModel({
      domains: [{ slug: "civic" }],
      apps: apps.map((a) => ({ id: a.id, name: a.title, integration: a.integration, domains: a.domains, enabled: a.enabled })),
      probes,
      asOf: "2026-07-17T00:00:00Z",
      host: "h",
    });
    const civic = m.domains.find((d) => d.slug === "civic")!;
    // browser=0, browser=0, api=0.5 over 3 => 17%. Definitely not 100%.
    expect(civic.score).toBe(17);
    expect(civic.tools.every((t) => t.status !== "connected")).toBe(true);
  });
});
