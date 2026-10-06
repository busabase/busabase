import { readFileSync } from "node:fs";
import type { ChangeRequestVO } from "busabase-contract/types";
import { expect, json, test } from "./_fixtures";

interface ScaleFixture {
  baseSlug: string;
  recordId: string;
  historyCount: number;
  historicalBodyBytes: number;
}

const readFixture = (): ScaleFixture => {
  const fixturePath = process.env.HISTORY_SCALE_FIXTURE;
  if (!fixturePath) throw new Error("Run verify-record-history-scale.ts before this spec");
  return JSON.parse(readFileSync(fixturePath, "utf8")) as ScaleFixture;
};

test.use({ video: "on", viewport: { width: 1440, height: 1100 } });

test("10,000 histories stay bounded and recover after a failed next page", async ({
  page,
  request,
}, testInfo) => {
  test.skip(!process.env.HISTORY_SCALE_FIXTURE, "Requires the isolated scale fixture");
  test.setTimeout(120_000);
  const fixture = readFixture();
  expect(fixture.historyCount).toBe(10_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/dashboard/local/home");
  await page.getByRole("link", { name: "Customer history acceptance", exact: true }).click();
  await expect(page.getByRole("grid")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("scale-base-entry.png"), fullPage: true });
  await page.getByText("Scale customer", { exact: true }).dblclick();
  await expect(page.getByRole("heading", { name: "Scale customer", exact: true })).toBeVisible();
  const recordPath = `/dashboard/local/base/${fixture.baseSlug}/${fixture.recordId}`;
  await page.goto(`${recordPath}?source=history-acceptance`);
  const history = page
    .locator("section")
    .filter({ has: page.getByText("Review history", { exact: true }) })
    .last();
  const reviewLinks = history.locator('a[href*="/inbox/"]');
  await expect(reviewLinks).toHaveCount(5);
  expect(
    await reviewLinks.evaluateAll((links) =>
      links.map((link) => link.getAttribute("href")?.split("?")[0].split("/").pop()),
    ),
  ).toEqual(
    [9999, 9998, 9997, 9996, 9995].map((index) => `crq_scale_${String(index).padStart(5, "0")}`),
  );
  await page.screenshot({ path: testInfo.outputPath("scale-record-preview.png"), fullPage: true });
  const fullReview = await json<ChangeRequestVO>(
    await request.get("/api/v1/change-requests/crq_scale_09999"),
  );
  expect(fullReview.reviews).toHaveLength(1);
  expect(Buffer.byteLength(String(fullReview.primaryOperation?.headCommit.payload.note))).toBe(
    fixture.historicalBodyBytes,
  );
  await reviewLinks.first().click();
  await expect(page).toHaveURL(/inbox\/crq_scale_09999\?source=history-acceptance$/);
  await expect(page.getByText("Merged", { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("scale-full-review.png"), fullPage: true });
  await page.goBack();
  await expect(reviewLinks).toHaveCount(5);
  const seeAll = history.getByRole("link", { name: "See all" });
  await expect(seeAll).toHaveAttribute("href", `${recordPath}/activity?source=history-acceptance`);
  let failNextPage = false;
  await page.route("**/api/rpc/activity/listForRecordPaged", async (route) => {
    if (failNextPage) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "Temporarily unavailable" }),
      });
    } else {
      await route.continue();
    }
  });
  await seeAll.click();
  const activity = page.locator('[data-dashboard-scroll="activity"]');
  await expect(activity.locator("a")).toHaveCount(50);
  const initialLinks = await activity
    .locator("a")
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  const loadMore = activity.getByRole("button", { name: "Load more" });
  await loadMore.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("scale-activity-first-page.png"),
    fullPage: true,
  });
  failNextPage = true;
  await loadMore.click();
  const retry = activity.getByRole("button", { name: "Retry" });
  await expect(retry).toBeVisible({ timeout: 30_000 });
  await expect(activity.locator("a")).toHaveCount(50);
  await page.screenshot({ path: testInfo.outputPath("scale-next-page-error.png"), fullPage: true });
  failNextPage = false;
  await retry.click();
  await expect(activity.locator("a")).toHaveCount(100);
  expect(
    await activity
      .locator("a")
      .evaluateAll((links) => links.slice(0, 50).map((link) => link.getAttribute("href"))),
  ).toEqual(initialLinks);
  await loadMore.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("scale-activity-recovered.png"),
    fullPage: true,
  });
  await page.goBack();
  await expect(reviewLinks).toHaveCount(5);
  await page.screenshot({ path: testInfo.outputPath("scale-return-record.png"), fullPage: true });
  expect(pageErrors).toEqual([]);
});

test("10,000 histories remain usable on a narrow screen", async ({ page }, testInfo) => {
  test.skip(!process.env.HISTORY_SCALE_FIXTURE, "Requires the isolated scale fixture");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => window.localStorage.setItem("busabaseLocale", "zh-CN"));
  const fixture = readFixture();
  await page.goto("/dashboard/local/home");
  const baseLink = page.getByRole("link", { name: "Customer history acceptance", exact: true });
  if (!(await baseLink.isVisible()))
    await page.getByRole("button", { name: "切换侧边栏", exact: true }).click();
  await baseLink.click();
  if (await page.getByRole("dialog", { name: "侧边栏", exact: true }).isVisible()) {
    await page.keyboard.press("Escape");
  }
  await expect(page.getByRole("grid")).toBeVisible();
  await page.getByText("Scale customer", { exact: true }).dblclick();
  await expect(page.getByRole("heading", { name: "Scale customer", exact: true })).toBeVisible();
  const history = page
    .locator("section")
    .filter({ has: page.getByText("评审历史", { exact: true }) })
    .last();
  await expect(history.locator('a[href*="/inbox/"]')).toHaveCount(5);
  const seeAll = history.getByRole("link", { name: "查看全部" });
  await seeAll.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("scale-mobile-preview.png"), fullPage: true });
  await seeAll.click();
  await expect(page).toHaveURL(new RegExp(`${fixture.recordId}/activity$`));
  const activity = page.locator('[data-dashboard-scroll="activity"]');
  await expect(activity.locator("a")).toHaveCount(50);
  const loadMore = activity.getByRole("button", { name: "加载更多" });
  await loadMore.scrollIntoViewIfNeeded();
  await loadMore.click();
  await expect(activity.locator("a")).toHaveCount(100);
  await page.screenshot({ path: testInfo.outputPath("scale-mobile-activity.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.goBack();
  await expect(history.locator('a[href*="/inbox/"]')).toHaveCount(5);
});

test("record activity recovers when its first page fails", async ({ page }, testInfo) => {
  test.skip(!process.env.HISTORY_SCALE_FIXTURE, "Requires the isolated scale fixture");
  const fixture = readFixture();
  await page.goto("/dashboard/local/home");
  await page.getByRole("link", { name: "Customer history acceptance", exact: true }).click();
  await page.getByText("Scale customer", { exact: true }).dblclick();
  await expect(page.getByRole("heading", { name: "Scale customer", exact: true })).toBeVisible();
  let failFirstPage = true;
  await page.route("**/api/rpc/activity/listForRecordPaged", async (route) => {
    if (failFirstPage) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "Temporarily unavailable" }),
      });
    } else {
      await route.continue();
    }
  });
  const history = page
    .locator("section")
    .filter({ has: page.getByText("Review history", { exact: true }) })
    .last();
  await history.getByRole("link", { name: "See all" }).click();
  await expect(page).toHaveURL(new RegExp(`${fixture.recordId}/activity$`));
  const activity = page.locator('[data-dashboard-scroll="activity"]');
  const retry = activity.getByRole("button", { name: "Retry" });
  await expect(retry).toBeVisible({ timeout: 30_000 });
  await expect(activity.locator("a")).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("scale-initial-page-error.png"),
    fullPage: true,
  });
  failFirstPage = false;
  await retry.click();
  await expect(activity.locator("a")).toHaveCount(50);
  await expect(activity.getByRole("alert")).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("scale-initial-page-recovered.png"),
    fullPage: true,
  });
  await page.goBack();
  await expect(history.locator('a[href*="/inbox/"]')).toHaveCount(5);
});
