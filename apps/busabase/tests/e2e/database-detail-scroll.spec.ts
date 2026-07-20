import type { BaseVO } from "busabase-contract/types";
import { expect, json, test, unique } from "./_fixtures";

const LONG_LIST_RECORD_COUNT = 110;

test("Database Detail scrolls after the record table starts virtualizing", async ({
  page,
  request,
}) => {
  const bases = await json<BaseVO[]>(await request.get("/api/v1/bases"));
  const blog = bases.find((base) => base.slug === "blog");
  if (!blog) {
    throw new Error("The seeded blog base is required for the Database Detail scroll test");
  }

  const marker = unique("E2E long list");
  const changeRequest = await json<{ id: string }>(
    await request.post(`/api/v1/bases/${blog.id}/records/bulk-change-request`, {
      data: {
        message: marker,
        records: Array.from({ length: LONG_LIST_RECORD_COUNT }, (_, index) => ({
          body: `${marker} body ${index}`,
          title: `${marker} row ${index}`,
        })),
        submittedBy: "playwright",
      },
    }),
  );
  await json(
    await request.post(`/api/v1/change-requests/${changeRequest.id}/reviews`, {
      data: { verdict: "approved" },
    }),
  );
  await json(await request.post(`/api/v1/change-requests/${changeRequest.id}/merge`, { data: {} }));

  await page.goto("/dashboard/local/base/blog");
  const rows = page.locator("[data-record-id]");
  const scrollViewport = page.locator("[data-base-detail-scroll]");
  await expect(rows.first()).toBeVisible({ timeout: 45_000 });
  await expect(scrollViewport).toBeVisible();

  const loadMore = page.getByRole("button", { name: "Load more" });
  for (let pageIndex = 0; pageIndex < 3 && (await loadMore.count()) > 0; pageIndex++) {
    await loadMore.click();
    await page.waitForTimeout(500);
  }

  await expect
    .poll(() => scrollViewport.evaluate((element) => element.scrollHeight > element.clientHeight))
    .toBe(true);
  const visibleRecordIdsBefore = await rows.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-record-id")),
  );

  await scrollViewport.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll"));
  });

  await expect
    .poll(() => scrollViewport.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await expect
    .poll(async () => {
      const visibleRecordIdsAfter = await rows.evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("data-record-id")),
      );
      return visibleRecordIdsAfter.join(",") !== visibleRecordIdsBefore.join(",");
    })
    .toBe(true);
});
