import type { ChangeRequestVO } from "busabase-contract/types";
import { expect, json, test } from "./_fixtures";

test.use({ locale: "zh-CN" });

test("Inbox dates follow the application locale instead of the browser locale", async ({
  page,
  request,
}) => {
  const changeRequest = await json<ChangeRequestVO>(
    await request.get("/api/v1/change-requests/crq_seed_newsletter_html_brief?demo=1"),
  );
  await page.addInitScript(() => window.localStorage.setItem("busabaseLocale", "en"));
  await page.goto("/dashboard/local/inbox?demo=1");

  const row = page.locator('a[href*="/inbox/crq_seed_newsletter_html_brief"]');
  await expect(row).toBeVisible();

  const [englishDate, browserLocaleDate] = await page.evaluate((updatedAt) => {
    const updatedDate = new Date(updatedAt);
    const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
    return [
      updatedDate.toLocaleDateString("en", options),
      updatedDate.toLocaleDateString(undefined, options),
    ];
  }, changeRequest.updatedAt);

  expect(browserLocaleDate).not.toBe(englishDate);
  await expect(row.getByTestId("change-request-updated-at")).toHaveText(englishDate);
});
