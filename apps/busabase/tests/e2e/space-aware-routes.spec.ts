import { expect, test } from "./_fixtures";

test("legacy dashboard paths redirect to the local-space canonical URL", async ({
  page,
  request,
}) => {
  const response = await request.get("/dashboard/inbox?demo=1&source=legacy", {
    maxRedirects: 0,
  });
  expect(response.status()).toBe(308);
  expect(response.headers().location).toMatch(/\/dashboard\/local\/inbox\?demo=1&source=legacy$/);

  await page.goto("/dashboard/inbox?demo=1&source=legacy");

  await expect(page).toHaveURL(/\/dashboard\/local\/inbox\?demo=1&source=legacy$/);
  // Inbox isn't a permanent sidebar row anymore — it's the *contextual* row the
  // shell surfaces while you're inside Inbox, so seeing it here doubles as proof
  // the redirect landed on Inbox rather than the Home digest.
  await expect(page.getByRole("link", { name: "Inbox" })).toBeVisible();
});

test("canonical local-space dashboard path renders directly", async ({ page }) => {
  await page.goto("/dashboard/local/base/blog?demo=blog");

  // Renders in the local space directly; the bare Base route then opens the
  // Base's leftmost saved view, keeping the query string.
  await expect(page).toHaveURL(/\/dashboard\/local\/base\/blog\/all-records\?demo=blog$/);
  // `exact` matters: without it this also matches any seeded record link whose
  // body happens to contain "posts", which trips strict mode. Scoped to the
  // breadcrumb because on a view route the Base crumb is a link too, next to
  // the sidebar row of the same name.
  await expect(
    page.getByLabel("Breadcrumb").getByRole("link", { exact: true, name: "Posts" }),
  ).toBeVisible();
});
