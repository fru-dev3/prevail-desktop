import { describe, it, expect } from "vitest";
import { appName } from "./format";

describe("appName", () => {
  it("strips a trailing ' via ...' connection suffix", () => {
    expect(appName("AllTrails via InfoseekAI MCP")).toBe("AllTrails");
  });
  it("expands known short brand names to their full form", () => {
    expect(appName("Amex")).toBe("American Express");
    expect(appName("amex")).toBe("American Express");
  });
  it("leaves ordinary titles untouched", () => {
    expect(appName("Notion")).toBe("Notion");
    expect(appName("Charles Schwab")).toBe("Charles Schwab");
  });
});
