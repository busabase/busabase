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
  await expect(page.getByRole("link", { name: "Inbox" })).toBeVisible();
});

test("canonical local-space dashboard path renders directly", async ({ page }) => {
  await page.goto("/dashboard/local/base/blog?demo=blog");

  await expect(page).toHaveURL(/\/dashboard\/local\/base\/blog\?demo=blog$/);
  await expect(page.getByRole("link", { name: "Posts" })).toBeVisible();
});
