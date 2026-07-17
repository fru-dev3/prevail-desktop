import { describe, it, expect } from "vitest";
import { buildMapModel, seedOnlyModel, type BuildInputs } from "./mapbuild";

const base: Omit<BuildInputs, "domains" | "apps"> = {
  asOf: "2026-07-17T00:00:00Z",
  host: "test-host",
};

describe("buildMapModel", () => {
  it("renders a domain from the apps that claim it", () => {
    const m = buildMapModel({
      ...base,
      domains: [{ slug: "dev" }],
      apps: [
        { id: "github", name: "GitHub", integration: "cli", domains: ["dev"] },
        { id: "prevail", name: "Prevail", integration: "mcp", domains: ["dev"], enabled: true },
      ],
    });
    const dev = m.domains.find((d) => d.slug === "dev")!;
    expect(dev.tools.map((t) => t.name).sort()).toEqual(["GitHub", "Prevail"]);
    expect(dev.score).toBe(100); // cli + connected
  });

  it("a passing probe promotes oauth/mcp to connected; a failing one marks broken", () => {
    const m = buildMapModel({
      ...base,
      domains: [{ slug: "business" }],
      apps: [
        { id: "gmail", name: "Gmail", integration: "oauth", domains: ["business"], account: { label: "user@example.com" } },
        { id: "qbo", name: "QuickBooks", integration: "api", domains: ["business"] },
      ],
      probes: [
        { appId: "gmail", ok: true },
        { appId: "qbo", ok: false },
      ],
    });
    const biz = m.domains.find((d) => d.slug === "business")!;
    expect(biz.tools.find((t) => t.name === "Gmail")!.status).toBe("connected");
    expect(biz.tools.find((t) => t.name === "QuickBooks")!.status).toBe("broken");
  });

  it("carries the Google identity from account.label onto the tool", () => {
    const m = buildMapModel({
      ...base,
      domains: [{ slug: "real-estate" }],
      apps: [{ id: "gdrive", name: "Google Drive", integration: "oauth", domains: ["real-estate"], account: { label: "account2@example.com" } }],
    });
    const t = m.domains[0]!.tools[0]!;
    expect(t.identity).toBe("account2@example.com");
  });

  it("matches a domain to its seed by category and adds suggestions when asked", () => {
    const m = buildMapModel({
      ...base,
      includeSuggestions: true,
      domains: [{ slug: "explore", category: "travel" }],
      apps: [{ id: "alltrails", name: "AllTrails", integration: "mcp", domains: ["explore"], enabled: true }],
    });
    const d = m.domains[0]!;
    // AllTrails is owned (not suggested); the rest of the travel seed is suggested.
    const owned = d.tools.filter((t) => !t.suggested).map((t) => t.name);
    const suggested = d.tools.filter((t) => t.suggested).map((t) => t.name);
    expect(owned).toContain("AllTrails");
    expect(suggested).toContain("Booking.com");
    expect(suggested).toContain("Delta");
    // Suggestions do not move the score: only AllTrails counts.
    expect(d.score).toBe(100);
  });

  it("without includeSuggestions, only owned tools appear", () => {
    const m = buildMapModel({
      ...base,
      domains: [{ slug: "explore", category: "travel" }],
      apps: [{ id: "alltrails", name: "AllTrails", integration: "mcp", domains: ["explore"], enabled: true }],
    });
    expect(m.domains[0]!.tools).toHaveLength(1);
  });

  it("seedOnlyModel renders the full library for an empty/new user", () => {
    const m = seedOnlyModel(base.asOf, base.host);
    expect(m.domains.length).toBe(12);
    // Dev seed scores 96 as in the prototype.
    expect(m.domains.find((d) => d.slug === "dev")!.score).toBe(96);
  });

  it("stamps the snapshot with host + time (auth is machine-local)", () => {
    const m = buildMapModel({ ...base, domains: [], apps: [] });
    expect(m.host).toBe("test-host");
    expect(m.asOf).toBe("2026-07-17T00:00:00Z");
  });
});
