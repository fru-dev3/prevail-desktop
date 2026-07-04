import { describe, expect, test } from "vitest";
import { GOOGLE_WEBSITE, goalNeedsConnector, buildConnectorTurn, CONNECTOR_TURN_DOMAIN } from "./googlepanel";

// Fix 2(a): a browser-learn for Google must start at the live Gmail product, not
// the workspace.google.com MARKETING site.
describe("Google browser-learn start URL (Fix 2a)", () => {
  test("starts at the signed-in Gmail app, not the marketing site", () => {
    expect(GOOGLE_WEBSITE).toBe("https://mail.google.com");
    expect(GOOGLE_WEBSITE).not.toContain("workspace.google.com");
  });
});

// Fix 2(b): consequential goals (send/archive/...) route to the connector; pure
// read goals still learn a browser flow.
describe("consequential goal detection (Fix 2b)", () => {
  test.each([
    "send my unread emails a reply",
    "archive last week's newsletters",
    "delete the spam in my inbox",
    "reply to Dana's thread",
    "forward the invoice to accounting",
    "create a calendar invite for Friday",
    "label these as receipts",
  ])("routes to the connector: %s", (goal) => {
    expect(goalNeedsConnector(goal)).toBe(true);
  });

  test.each([
    "summarize my unread Gmail and the day on my Calendar",
    "show me today's important mail",
    "list my upcoming events",
    "",
  ])("stays a browser-learn: %s", (goal) => {
    expect(goalNeedsConnector(goal)).toBe(false);
  });
});

// The one-click "Do this with the Gmail connector" hand-off: it must open the
// Google app chat bound to a NON-EMPTY domain (so chatpanel's Act-mode guard
// passes), arm Act mode on that domain, and prefill the composer with the goal.
describe("connector hand-off (Do this with the Gmail connector)", () => {
  test("arms Act on a non-empty domain and seeds the exact goal", () => {
    const goal = "archive last week's newsletters";
    const turn = buildConnectorTurn(goal);
    // Act mode is gated on a non-empty domain in chatpanel; General ("") can't
    // run Act, so the hand-off must ground the app chat in a real, non-empty one.
    expect(turn.actDomain).toBe(CONNECTOR_TURN_DOMAIN);
    expect(turn.actDomain).not.toBe("");
    expect(turn.app.domains).toContain(CONNECTOR_TURN_DOMAIN);
    expect(turn.app.domains.every((d) => d.length > 0)).toBe(true);
    // The opened app is the Google Workspace app, same id the header chat uses.
    expect(turn.app.id).toBe("google");
    // The composer is prefilled with the user's goal verbatim (trimmed).
    expect(turn.seed).toBe(goal);
  });

  test("trims the goal and no-ops on an empty goal seed", () => {
    expect(buildConnectorTurn("  reply to Dana  ").seed).toBe("reply to Dana");
    expect(buildConnectorTurn("   ").seed).toBe("");
    expect(buildConnectorTurn("").seed).toBe("");
  });
});
