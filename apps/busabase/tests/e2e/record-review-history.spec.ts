import type { BaseVO, RecordVO } from "busabase-contract/types";
import { expect, json, test, unique } from "./_fixtures";

test("record review preview stays bounded and opens pageable record activity", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(180_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const title = unique("History customer");
  const base = await json<BaseVO>(
    await request.post("/api/v1/bases", {
      data: {
        autoMerge: true,
        fields: [
          { name: "Name", required: true, slug: "name", type: "text" },
          { name: "Revision", slug: "revision", type: "number" },
        ],
        name: unique("Record history"),
        slug: `record-history-${Date.now()}`,
      },
    }),
  );
  const record = await json<RecordVO>(
    await request.post(`/api/v1/bases/${base.id}/change-requests`, {
      data: { autoMerge: true, fields: { name: title, revision: 0 }, message: "Create customer" },
    }),
  );
  for (let revision = 1; revision <= 55; revision += 1) {
    await json<RecordVO>(
      await request.post(`/api/v1/records/${record.id}/change-requests`, {
        data: {
          autoMerge: true,
          fields: { revision },
          message: `Update customer revision ${revision}`,
          operation: "update",
        },
      }),
    );
  }

  const recordPath = `/dashboard/local/base/${base.slug}/${record.id}`;
  await page.goto(`/dashboard/local/base/${base.slug}`);
  await page.getByText(title, { exact: true }).dblclick();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  const history = page
    .locator("section")
    .filter({
      has: page.getByText("Review history", { exact: true }),
    })
    .last();
  const reviewLinks = history.locator('a[href*="/inbox/"]');
  await expect(reviewLinks).toHaveCount(5);
  const latestHistory = await json<Array<{ id: string }>>(
    await request.get(`/api/v1/records/${record.id}/change-requests?limit=5`),
  );
  expect(latestHistory).toHaveLength(5);
  expect(
    await reviewLinks.evaluateAll((links) =>
      links.map((link) => link.getAttribute("href")?.split("/").pop()),
    ),
  ).toEqual(latestHistory.map((changeRequest) => changeRequest.id));
  await page.screenshot({
    path: testInfo.outputPath("record-history-preview.png"),
    fullPage: true,
  });

  const more = history.getByRole("link", { name: "See all" });
  await expect(more).toHaveAttribute("href", `${recordPath}/activity`);
  await more.click();
  await expect(page).toHaveURL(new RegExp(`${record.id}/activity$`));
  const activity = page.locator('[data-dashboard-scroll="activity"]');
  await expect(activity.locator("a")).toHaveCount(50);
  const firstPageHrefs = await activity
    .locator("a")
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  const loadMore = activity.getByRole("button", { name: "Load more" });
  await loadMore.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("record-history-first-page.png"),
    fullPage: true,
  });
  await loadMore.click();
  await expect(activity.locator("a")).toHaveCount(100);
  expect(
    await activity
      .locator("a")
      .evaluateAll((links) => links.slice(0, 50).map((link) => link.getAttribute("href"))),
  ).toEqual(firstPageHrefs);
  await page.screenshot({
    path: testInfo.outputPath("record-history-activity.png"),
    fullPage: true,
  });
  for (let remainingPage = 0; remainingPage < 10 && (await loadMore.count()); remainingPage += 1) {
    const previousCount = await activity.locator("a").count();
    await loadMore.click();
    await expect.poll(() => activity.locator("a").count()).toBeGreaterThan(previousCount);
  }
  await expect(loadMore).toHaveCount(0);
  await expect(
    activity.getByText("Create record · Adds a new record", { exact: true }),
  ).toHaveCount(1);
  const completeHistoryCount = await activity.locator("a").count();
  await activity.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await activity.screenshot({ path: testInfo.outputPath("record-history-end.png") });

  await page.goBack();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await expect(reviewLinks).toHaveCount(5);
  await page.setViewportSize({ width: 390, height: 844 });
  await more.scrollIntoViewIfNeeded();
  await expect(more).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath("record-history-mobile.png"), fullPage: true });
  await more.click();
  await expect(activity.locator("a")).toHaveCount(completeHistoryCount);
  await expect(loadMore).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});
