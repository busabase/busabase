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
  // The badge ("Graph") + summary ("{n} bases · {m} relations") render before the
  // React Flow layout settles, so they are a stable render signal for this route.
  await expect(page.getByText(/\d+ bases · \d+ relations/)).toBeVisible({
    timeout: RENDER_TIMEOUT,
  });
});

test("archived (trash) view renders with its empty state", async ({ page }) => {
  await page.goto("/dashboard/local/archived?demo=1", { waitUntil: "commit" });
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
  await expect(page.getByText("Workspace activity")).toBeVisible({ timeout: RENDER_TIMEOUT });

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
