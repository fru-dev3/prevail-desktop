import { describe, expect, test } from "vitest";
import { GOOGLE_WEBSITE, goalNeedsConnector } from "./googlepanel";

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
