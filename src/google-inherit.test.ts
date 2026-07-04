import { describe, it, expect } from "vitest";
import { inheritedGoogleAccount } from "./helpers";

// An app attached to a domain chat must carry its connection identity into the
// run. For Google that means: with no explicit account picked, inherit the app's
// authenticated account so the domain chat acts as the app's own chat would.
describe("inheritedGoogleAccount", () => {
  it("an explicit pick always wins, verbatim (comma-joined)", () => {
    expect(inheritedGoogleAccount(["work"], ["default", "work"], true)).toBe("work");
    expect(inheritedGoogleAccount(["work", "home"], ["work", "home"], true)).toBe("work,home");
    // Explicit pick wins even if Google is not flagged attached.
    expect(inheritedGoogleAccount(["work"], [], false)).toBe("work");
  });

  it("no app attached => null (a plain domain chat is unchanged)", () => {
    expect(inheritedGoogleAccount([], ["work"], false)).toBeNull();
  });

  it("Google attached, nothing picked, default connected => inherit default", () => {
    expect(inheritedGoogleAccount([], ["default", "work"], true)).toBe("default");
  });

  it("Google attached, nothing picked, only a labeled account connected => inherit it (the fix)", () => {
    // The user authorized only "work" from the Google panel; the domain chat must
    // act for "work", not fall back to an unauthorized default.
    expect(inheritedGoogleAccount([], ["work"], true)).toBe("work");
  });

  it("Google attached but no connected accounts => null (honest, nothing to inherit)", () => {
    expect(inheritedGoogleAccount([], [], true)).toBeNull();
  });

  it("ignores blank/whitespace entries on both sides", () => {
    expect(inheritedGoogleAccount(["  "], ["work"], true)).toBe("work");
    expect(inheritedGoogleAccount([], ["  ", "home"], true)).toBe("home");
  });
});
