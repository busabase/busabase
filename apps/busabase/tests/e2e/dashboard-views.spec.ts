import { expect, test } from "./_fixtures";

// Read-only renders of the dashboard SPA routes that the existing suite only
// reaches via a menu (Graph / Archived / Assets) or asserts at the header level
// (Activity). These go through the stateless demo router (`?demo=…`) — the same
// deterministic, no-DB-write path demo-mode.spec.ts uses — so they render without
// touching the single-connection PGLite dev DB.
//
// Navigation uses waitUntil:"commit" (not "load"/"domcontentloaded"): the
// dashboard page is force-dynamic and its RSC response streams, so those
// milestones don't fire promptly under `next dev` even though the content mounts.
// The web-first content assertions (with a generous timeout) wait for the actual
// hydrated route content instead.

// The dashboard client bundle is large; give hydrated content room to appear.
const RENDER_TIMEOUT = 45_000;
test.setTimeout(90_000);

test("graph view renders the relation summary badge", async ({ page }) => {
  await page.goto("/dashboard/local/graph?demo=1", { waitUntil: "commit" });
  await expect(
    page.locator("[data-dashboard-topbar]").getByText("Graph View", { exact: true }),
  ).toBeVisible({
    timeout: RENDER_TIMEOUT,
  });
  // The badge ("Graph") + summary ("{n} bases · {m} relations") render before the
  // React Flow layout settles, so they are a stable render signal for this route.
  await expect(page.getByText(/\d+ bases · \d+ relations/)).toBeVisible({
    timeout: RENDER_TIMEOUT,
  });
});

test("archived (trash) view renders with its empty state", async ({ page }) => {
  await page.goto("/dashboard/local/archived?demo=1", { waitUntil: "commit" });
  await expect(
    page.locator("[data-dashboard-topbar]").getByText("Trash", { exact: true }),
  ).toBeVisible({
    timeout: RENDER_TIMEOUT,
  });
  await expect(page.getByRole("heading", { name: "Trash" })).toBeVisible({
    timeout: RENDER_TIMEOUT,
  });
  // The demo seed keeps every base active, so the archived list is empty.
  await expect(page.getByText("No archived bases")).toBeVisible();
});

test("assets library route renders the seeded media", async ({ page }) => {
  await page.goto("/dashboard/local/assets?demo=media", { waitUntil: "commit" });
  await expect(page.getByRole("heading", { name: "Assets", exact: true })).toBeVisible({
    timeout: RENDER_TIMEOUT,
  });
  // The library must resolve rather than error out.
  await expect(page.getByText("Failed to load assets")).toHaveCount(0);
});

test("activity entries link through to a working detail page", async ({ page }) => {
  await page.goto("/dashboard/local/activity?demo=1", { waitUntil: "commit" });
  await expect(page.locator('[data-dashboard-scroll="activity"]')).toBeVisible({
    timeout: RENDER_TIMEOUT,
  });

  // Activity rows link to a change request detail at /dashboard/local/inbox/{id} (the
  // sidebar "Inbox" nav is /dashboard/local/inbox with no trailing id, so this href
  // uniquely targets a feed entry rather than the nav). Follow the first one and
  // confirm it lands on a real detail route, not a not-found page.
  const entry = page.locator('a[href*="/dashboard/local/inbox/"]').first();
  await expect(entry).toBeVisible({ timeout: RENDER_TIMEOUT });
  await entry.click();

  await expect(page).toHaveURL(/\/dashboard\/local\/inbox\/.+/, { timeout: RENDER_TIMEOUT });
  await expect(page.getByText(/not found/i)).toHaveCount(0);
});

// `label` is the user-visible nav string the topbar renders (`nav.*` in
// packages/busabase-core/src/i18n/messages.ts), not the route segment — the two
// deliberately differ for App Launcher, whose path stays `/apps`. Renaming a
// nav label means updating it here too.
for (const view of [
  { label: "Agents", path: "/agents" },
  { label: "App Launcher", path: "/apps" },
  { label: "Templates", path: "/templates" },
]) {
  test(`${view.label} route shows the correct topbar label`, async ({ page }) => {
    await page.goto(`/dashboard/local${view.path}?demo=1`, { waitUntil: "commit" });
    await expect(
      page.locator("[data-dashboard-topbar]").getByText(view.label, { exact: true }),
    ).toBeVisible({ timeout: RENDER_TIMEOUT });
  });
}

test("App Launcher renders accessible launcher items without changing their links", async ({
  page,
}) => {
  await page.goto("/dashboard/local/apps?demo=1", { waitUntil: "commit" });

  await expect(
    page.locator("[data-dashboard-topbar]").getByText("App Launcher", { exact: true }),
  ).toBeVisible({ timeout: RENDER_TIMEOUT });
  // The in-body <h1> is intentional and matches `AgentsListView` — sibling list
  // views reached from the Space Selector all open with their own heading over a
  // `border-b`, so content starts at the same height on every one of them.
  await expect(page.getByRole("heading", { name: "App Launcher", exact: true })).toHaveCount(1);

  const items = page.locator("[data-app-launcher-item]");
  await expect(items.first()).toBeVisible({ timeout: RENDER_TIMEOUT });
  expect(await items.count()).toBeGreaterThan(0);

  const firstItem = items.first();
  await expect(firstItem.locator("[data-airapp-icon]")).toBeVisible();
  await expect(firstItem).toHaveAttribute("aria-label", /\S+/);
  await expect(firstItem).toHaveAttribute("href", /\/airapp\/[^?]+\?.*demo=1/);

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);

  await firstItem.click();
  await expect(page).toHaveURL(/\/dashboard\/local\/airapp\/[^?]+\?.*demo=1/, {
    timeout: RENDER_TIMEOUT,
  });
  await expect(page.getByText(/not found/i)).toHaveCount(0);
});
