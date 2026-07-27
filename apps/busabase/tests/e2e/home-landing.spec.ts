import type { Page } from "./_fixtures";
import { expect, test } from "./_fixtures";

// The workbench landing page. Inbox used to be where an unqualified visit
// resolved, which greeted anyone without a pending review — and every brand-new
// user — with an empty queue. Home is a digest instead, and the four workspace
// destinations moved into the Space Selector so the resting sidebar is just
// Home + Search + the node tree.

// `Page` comes from the fixtures rather than being derived from `typeof test`:
// `test` is overloaded, so `Parameters<...>[1]` lands on the `TestDetails`
// overload instead of the body function, and every use of the helper then
// degrades to `never`.
const spaceSelector = (page: Page) => page.getByRole("button", { name: /Local Busabase.*Local/ });

test("an unqualified visit lands on Home, not Inbox", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/dashboard\/local\/home$/);
  await expect(page.getByRole("link", { exact: true, name: "Home" })).toBeVisible();
});

test("Home shows the review / recent / activity digest", async ({ page }) => {
  await page.goto("/dashboard/local/home");

  // "Recently visited" and "Recent activity" always render (each carries its own
  // empty hint). The pending-review section is deliberately conditional, so it is
  // asserted in the seeded-workspace test below rather than here.
  await expect(page.getByRole("heading", { name: "Recently visited" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent activity" })).toBeVisible();
  await expect(page.getByRole("link", { name: /View all activity/ })).toBeVisible();
});

test("Home surfaces the seeded review queue and links out to Inbox", async ({ page }) => {
  await page.goto("/dashboard/local/home");

  // The seed always leaves change requests in review, so this section renders.
  await expect(page.getByRole("heading", { name: "Waiting for your review" })).toBeVisible();
  await page.getByRole("link", { name: /Review all/ }).click();
  await expect(page).toHaveURL(/\/dashboard\/local\/inbox/);
  await expect(page.getByRole("link", { name: /For review \d+/ })).toBeVisible();
});

test("the resting sidebar is Home + Search only", async ({ page }) => {
  await page.goto("/dashboard/local/home");
  await expect(page.getByRole("link", { exact: true, name: "Home" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Search" })).toBeVisible();

  for (const moved of ["Inbox", "Activity", "Archive", "Assets"]) {
    await expect(page.getByRole("link", { exact: true, name: moved })).toHaveCount(0);
  }

  await spaceSelector(page).click();
  for (const moved of ["Inbox", "Activity", "Archive", "Assets"]) {
    await expect(page.getByRole("menuitem", { exact: true, name: moved })).toBeVisible();
  }
});

test("entering a workspace destination adds exactly one contextual row, which lingers", async ({
  page,
}) => {
  await page.goto("/dashboard/local/home");
  await spaceSelector(page).click();
  await page.getByRole("menuitem", { exact: true, name: "Inbox" }).click();
  await expect(page).toHaveURL(/\/dashboard\/local\/inbox$/);

  // ONE row — not the whole set.
  await expect(page.getByRole("link", { exact: true, name: "Inbox" })).toBeVisible();
  for (const other of ["Activity", "Archive", "Assets"]) {
    await expect(page.getByRole("link", { exact: true, name: other })).toHaveCount(0);
  }

  // It survives wandering off into a Base: the round trip "review something →
  // go check the data → back to Inbox" must not cost another trip through the menu.
  await page.goto("/dashboard/local/base/blog");
  await expect(page.getByRole("heading", { name: "Posts" })).toBeVisible();
  await expect(page.getByRole("link", { exact: true, name: "Inbox" })).toBeVisible();

  // Visiting a different destination REPLACES it rather than stacking, so the
  // sidebar can never regrow into the shortcut list this design removed.
  await page.goto("/dashboard/local/activity");
  await expect(page.getByRole("link", { exact: true, name: "Activity" })).toBeVisible();
  await expect(page.getByRole("link", { exact: true, name: "Inbox" })).toHaveCount(0);
});

test("Recently visited fills in from nodes you open", async ({ page }) => {
  // A fresh context has an empty known-node cache, so Home shows the hint first.
  await page.goto("/dashboard/local/home");
  await expect(page.getByText(/Bases and documents you open will show up here/)).toBeVisible();

  await page.goto("/dashboard/local/base/blog");
  await expect(page.getByRole("heading", { name: "Posts" })).toBeVisible();

  await page.goto("/dashboard/local/home");
  await expect(page.getByText(/Bases and documents you open will show up here/)).toHaveCount(0);
  const recentSection = page.locator('[data-home-section="recent"]');
  await expect(recentSection.getByRole("link", { exact: true, name: "Posts" })).toBeVisible();
});

test("Inbox remains a fully working page of its own", async ({ page }) => {
  await page.goto("/dashboard/local/inbox");
  await expect(page.getByRole("link", { name: /For review \d+/ })).toBeVisible();
});
