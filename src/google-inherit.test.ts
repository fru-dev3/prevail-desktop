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

  it("Google attached, nothing picked, MULTIPLE accounts connected => null (never guess)", () => {
    // Acting as the wrong identity is worse than asking: with 2+ connected
    // accounts and no pick, leave it unset so the engine refuses with the
    // connected labels and the user picks in Modes. No label (not even
    // "default") is ever preferred - profiles are machine-specific.
    expect(inheritedGoogleAccount([], ["default", "work"], true)).toBeNull();
    expect(inheritedGoogleAccount([], ["home", "work"], true)).toBeNull();
  });

  it("Google attached, nothing picked, exactly ONE account connected => inherit it, whatever its label", () => {
    // Unambiguous, so zero friction - this is the domain-chat fix.
    expect(inheritedGoogleAccount([], ["work"], true)).toBe("work");
    expect(inheritedGoogleAccount([], ["default"], true)).toBe("default");
  });

  it("Google attached but no connected accounts => null (honest, nothing to inherit)", () => {
    expect(inheritedGoogleAccount([], [], true)).toBeNull();
  });

  it("ignores blank/whitespace entries on both sides", () => {
    expect(inheritedGoogleAccount(["  "], ["work"], true)).toBe("work");
    expect(inheritedGoogleAccount([], ["  ", "home"], true)).toBe("home");
  });
});
