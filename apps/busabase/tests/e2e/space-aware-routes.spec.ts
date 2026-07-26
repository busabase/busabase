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

  await expect(page).toHaveURL(/\/dashboard\/local\/base\/blog\?demo=blog$/);
  // `exact` matters: without it this also matches any seeded record link whose
  // body happens to contain "posts", which trips strict mode.
  await expect(page.getByRole("link", { exact: true, name: "Posts" })).toBeVisible();
});
