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

// Demo Agent sessions live in the Next server process and intentionally survive
// page contexts. Establish the empty-state precondition explicitly so an earlier
// Agent journey cannot turn these two stories into the connected-agent picker.
const mockNoConnectedAgents = async (page: import("@playwright/test").Page) => {
  await page.route("**/api/rpc/agents/connections/list", (route) =>
    route.fulfill({ json: { json: [] } }),
  );
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

/**
 * PUL-232: the Agents launcher card used to navigate the main canvas away to
 * `/agents`, leaving the panel itself empty. It now stays put and drills into
 * a connected-agent picker in place — these pin that contract down from the
 * user's side: the card announces the extra step, picking it keeps you in
 * the panel, and there is always a way back to the original launcher.
 */
test("the Agents card announces a next step and stays inside the panel", async ({ page }) => {
  await mockNoConnectedAgents(page);
  await openDashboard(page);
  await page.getByRole("button", { name: "Open side panel" }).click();

  const panel = page.getByRole("region", { name: "Side panel" });
  await expect(panel).toBeVisible({ timeout: RENDER_TIMEOUT });

  const agentsCard = panel.getByRole("button", { name: /Agents/ });
  await expect(agentsCard).toBeVisible();
  // The forward chevron visually distinguishes this drill-in card from the
  // Pin and Search cards, which act immediately.
  await expect(agentsCard.locator(".lucide-chevron-right")).toBeVisible();

  await agentsCard.click();

  // Still the same region — no navigation away from the panel happened.
  await expect(panel).toBeVisible();
  await expect(page.getByRole("button", { name: "Back" })).toBeVisible();
  await expect(page).not.toHaveURL(/\/agents$/);

  // The demo router seeds no connected agents until a session exists, so the
  // deterministic first-visit state is the connect-agent fallback.
  await expect(panel.getByText("No agents connected yet.")).toBeVisible({
    timeout: RENDER_TIMEOUT,
  });
  await expect(panel.getByRole("button", { name: "Connect an agent" })).toBeVisible();

  await page.getByRole("button", { name: "Back" }).click();
  await expect(panel.getByText("Nothing pinned")).toBeVisible();
  await expect(panel.getByRole("button", { name: /Agents/ })).toBeVisible();
});

test("the connect-agent fallback routes to setting up an agent", async ({ page }) => {
  await mockNoConnectedAgents(page);
  await openDashboard(page);
  await page.getByRole("button", { name: "Open side panel" }).click();

  const panel = page.getByRole("region", { name: "Side panel" });
  await panel.getByRole("button", { name: /Agents/ }).click();

  await panel.getByRole("button", { name: "Connect an agent" }).click();

  // This is the one case where leaving the panel is correct: there is nothing
  // connected yet to chat with, so the fallback takes the user to set one up.
  await expect(page).toHaveURL(/\/agents\/new/);
});
