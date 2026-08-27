import { expect, test } from "./_fixtures";

/**
 * The side panel opens with nothing pinned.
 *
 * It used to refuse: the topbar toggle was `disabled` while `tabs` was empty,
 * and the panel itself returned `null` for the same reason — two independent
 * gates, so lifting either one alone would still have produced a button that
 * opened nothing. These tests pin that down from the user's side: click the
 * button that was previously dead, and land somewhere that offers a way in.
 *
 * Uses the stateless demo router (`?demo=…`), the same no-DB-write path
 * dashboard-views.spec.ts takes — nothing here needs real pinned content, and
 * "nothing pinned" is precisely the state under test.
 *
 * Navigation uses waitUntil:"commit" for the reason documented in
 * dashboard-views.spec.ts: the dashboard is force-dynamic and streams its RSC
 * response, so "load" does not fire promptly under `next dev`.
 */

const RENDER_TIMEOUT = 45_000;
test.setTimeout(90_000);

const openDashboard = async (page: import("@playwright/test").Page) => {
  await page.goto("/dashboard/local/home?demo=1", { waitUntil: "commit" });
  await expect(page.locator("[data-dashboard-topbar]")).toBeVisible({ timeout: RENDER_TIMEOUT });
};

test("the toggle opens the panel when nothing is pinned", async ({ page }) => {
  await openDashboard(page);

  const toggle = page.getByRole("button", { name: "Open side panel" });
  await expect(toggle).toBeVisible({ timeout: RENDER_TIMEOUT });
  // The regression this guards: the control existed but could not be used.
  await expect(toggle).toBeEnabled();

  await toggle.click();

  const panel = page.getByRole("region", { name: "Side panel" });
  await expect(panel).toBeVisible({ timeout: RENDER_TIMEOUT });
});

test("an empty panel offers a way to fill itself", async ({ page }) => {
  await openDashboard(page);
  await page.getByRole("button", { name: "Open side panel" }).click();

  const panel = page.getByRole("region", { name: "Side panel" });
  await expect(panel).toBeVisible({ timeout: RENDER_TIMEOUT });

  // An empty panel that rendered nothing would be strictly worse than the old
  // disabled button, so assert the launcher is actually there.
  await expect(panel.getByText("Nothing pinned")).toBeVisible({ timeout: RENDER_TIMEOUT });
  await expect(panel.getByRole("button", { name: "New tab" })).toBeVisible();
});

test("the + menu lists every way into the panel", async ({ page }) => {
  await openDashboard(page);
  await page.getByRole("button", { name: "Open side panel" }).click();

  const panel = page.getByRole("region", { name: "Side panel" });
  await expect(panel).toBeVisible({ timeout: RENDER_TIMEOUT });
  await panel.getByRole("button", { name: "New tab" }).click();

  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /Search/ })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Recently visited" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Agents" })).toBeVisible();
});

test("collapsing still works from an empty panel", async ({ page }) => {
  await openDashboard(page);
  await page.getByRole("button", { name: "Open side panel" }).click();

  const panel = page.getByRole("region", { name: "Side panel" });
  await expect(panel).toBeVisible({ timeout: RENDER_TIMEOUT });

  // Closing the last tab no longer collapses the panel, so the explicit
  // collapse is now the only way to dismiss it — it must survive being empty.
  await panel.getByRole("button", { name: "Collapse side panel" }).click();
  await expect(page.getByRole("button", { name: "Open side panel" })).toBeVisible();
});
