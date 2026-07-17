import { describe, it, expect } from "vitest";
import { scoreStack, computeStats, finalizeDomain, type MapTool } from "./map";
import { SEED_STACKS, seedForCategory, STATUS_WEIGHT } from "./mapseed";

// Turn a seed stack's tools into accepted (non-suggested) MapTools.
function accepted(stackId: string): MapTool[] {
  const s = SEED_STACKS.find((x) => x.id === stackId)!;
  return s.tools.map((t) => ({ name: t.name, status: t.status, note: t.note, identity: t.identity }));
}

describe("scoreStack matches the approved prototype", () => {
  it("Dev is 96% (11 CLI/connected + 1 api over 12 non-hardware)", () => {
    expect(scoreStack(accepted("dev"))).toBe(96);
  });
  it("Wearables is 50% (3 api, garmin watch hardware excluded)", () => {
    expect(scoreStack(accepted("wearables"))).toBe(50);
  });
  it("hardware is excluded from the denominator, never counts", () => {
    const onlyHw: MapTool[] = [{ name: "x", status: "hardware" }];
    expect(scoreStack(onlyHw)).toBe(0); // denom 0 -> 0
    const mixed: MapTool[] = [
      { name: "a", status: "connected" },
      { name: "hw", status: "hardware" },
    ];
    expect(scoreStack(mixed)).toBe(100); // 1/1, hardware ignored
  });
  it("suggested (unaccepted) tools do not count toward the score", () => {
    const tools: MapTool[] = [
      { name: "a", status: "connected" },
      { name: "b", status: "api", suggested: true },
    ];
    expect(scoreStack(tools)).toBe(100);
  });
  it("gap and broken count as zero but stay in the denominator", () => {
    const tools: MapTool[] = [
      { name: "a", status: "connected" },
      { name: "b", status: "gap" },
    ];
    expect(scoreStack(tools)).toBe(50);
  });
});

describe("status weights are the prototype weights", () => {
  it("connected/cli full, mcp .75, api/research half, rest zero", () => {
    expect(STATUS_WEIGHT.connected).toBe(1);
    expect(STATUS_WEIGHT.cli).toBe(1);
    expect(STATUS_WEIGHT.mcp).toBe(0.75);
    expect(STATUS_WEIGHT.api).toBe(0.5);
    expect(STATUS_WEIGHT.research).toBe(0.5);
    expect(STATUS_WEIGHT.browser).toBe(0);
    expect(STATUS_WEIGHT.gap).toBe(0);
  });
});

describe("computeStats", () => {
  it("buckets tools into wired/scriptable/manual/gaps, hardware excluded", () => {
    const d = finalizeDomain({ slug: "dev", label: "Dev", category: "dev", tools: accepted("dev") });
    const stats = computeStats([d]);
    expect(stats.tools).toBe(12); // hardware-free dev count
    expect(stats.wired).toBe(11);
    expect(stats.scriptable).toBe(1); // Excalidraw api
    expect(stats.gaps).toBe(0);
  });
});

describe("finalizeDomain surfaces missing identities", () => {
  it("a gap tool bound to an identity flags that identity as missing", () => {
    const d = finalizeDomain({
      slug: "insurance",
      label: "Insurance",
      category: "insurance",
      tools: accepted("insurance"),
    });
    expect(d.missingIdentities).toContain("account3");
  });
});

describe("seedForCategory maps categories and slugs", () => {
  it("resolves by category alias and by id", () => {
    expect(seedForCategory("explore")?.id).toBe("travel");
    expect(seedForCategory("money")?.id).toBe("wealth");
    expect(seedForCategory("dev")?.id).toBe("dev");
    expect(seedForCategory("nonsense")).toBeUndefined();
  });
});
