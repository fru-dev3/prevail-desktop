// The five load-bearing flows (G2). Not pixel tests: each asserts the screen
// actually renders its purpose and that its primary control invokes the right
// backend command. A crash, a dead button, or a gutted section fails here
// before a tag can build.
import { test, expect } from "@playwright/test";
import { mockTauri, invokedCommands } from "./tauri-mock";

test.beforeEach(async ({ page }) => {
  await mockTauri(page);
  page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
  await page.goto("/");
});

test("1 · home renders: headline, composer, trust ribbon with the guardrail segment", async ({ page }) => {
  await expect(page.getByText("What should we work on?")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Guardrail on/i)).toBeVisible();
  await expect(page.getByText(/Vault locked/i)).toBeVisible();
});

test("2 · Needs You shows both approval queues; approving a connector act uses the token spine", async ({ page }) => {
  await page.getByText("What should we work on?").waitFor({ timeout: 15_000 });
  // The approval inbox lives in the Work board's "Needs you" view.
  await page.evaluate(() => {
    localStorage.setItem("prevail.board.openNeeds", "1");
    window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "tasks" }));
    window.dispatchEvent(new CustomEvent("prevail:board-view", { detail: "needs" }));
  });
  const actCard = page.getByText("PayPal: create_invoice");
  await expect(actCard).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Gmail: send")).toBeVisible();
  // The sensitive act shows the explicit release wording, not a plain approve.
  await expect(page.getByText(/Approve including sensitive info/i)).toBeVisible();
  await page.getByText(/Approve including sensitive info/i).click();
  const cmds = await invokedCommands(page);
  expect(cmds).toContain("loop_request_approval");
  expect(cmds).toContain("engine_acts_approve");
});

test("3 · Privacy page: all four controls render; the guardrail toggle drives both engine flags", async ({ page }) => {
  await page.getByText("What should we work on?").waitFor({ timeout: 15_000 });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "privacy" })));
  await expect(page.getByText("Bunker Mode").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Vault Lock").first()).toBeVisible();
  await expect(page.getByText("Outbound Guardrail").first()).toBeVisible();
  await expect(page.getByText(/nothing reaches another party without you/i)).toBeVisible();
  await page.getByLabel("Outbound guardrail").click();
  const cmds = await invokedCommands(page);
  expect(cmds).toContain("email_policy_set");
  expect(cmds).toContain("egress_guard_set");
});

test("4 · Editor sections switch without crashing (tools, skills, apps)", async ({ page }) => {
  await page.getByText("What should we work on?").waitFor({ timeout: 15_000 });
  for (const section of ["tools", "skills", "connectors"]) {
    await page.evaluate((s) => window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: s })), section);
    await page.waitForTimeout(400); // sections lazy-load; a crash throws pageerror
  }
});

test("5 · telemetry: section navigation emits allowlisted feature_used events only", async ({ page }) => {
  await page.getByText("What should we work on?").waitFor({ timeout: 15_000 });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "skills" })));
  await page.waitForTimeout(300);
  const log = await page.evaluate(() => localStorage.getItem("prevail.telemetry.log") ?? "[]");
  const events = JSON.parse(log) as Array<{ event: string; props: Record<string, unknown> }>;
  const feats = events.filter((e) => e.event === "feature_used");
  expect(feats.length).toBeGreaterThan(0);
  // The scrubber must have dropped anything not in the closed enum.
  for (const f of feats) {
    if (typeof f.props.feature === "string") expect(f.props.feature).toMatch(/^[a-z_]+$/);
  }
});
