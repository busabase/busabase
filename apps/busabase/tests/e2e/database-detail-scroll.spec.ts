import type { BaseVO, ChangeRequestVO } from "busabase-contract/types";
import { expect, json, mergeOne, reviewOne, test, unique } from "./_fixtures";

const LONG_LIST_RECORD_COUNT = 110;

test("Table and Gallery can jump between numbered record pages", async ({ page, request }) => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const baseSlug = `record-pagination-${suffix}`;
  const base = await json<BaseVO>(
    await request.post("/api/v1/bases", {
      data: {
        autoMerge: true,
        description: "Playwright coverage for Table and Gallery pagination.",
        fields: [
          { name: "Title", required: true, slug: "title", type: "text" },
          { name: "Body", slug: "body", type: "longtext" },
        ],
        name: unique("Record Pagination"),
        slug: baseSlug,
      },
    }),
  );
  const marker = unique("E2E long list");
  const changeRequest = await json<{ id: string }>(
    await request.post(`/api/v1/bases/${base.id}/records/bulk-change-request`, {
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
  await reviewOne(request, changeRequest.id, "approved");
  await mergeOne(request, changeRequest.id);

  const gallerySlug = `e2e-pagination-gallery-${Date.now()}`;
  const galleryChangeRequest = await json<ChangeRequestVO>(
    await request.post("/api/v1/views/change-requests", {
      data: {
        operation: "create",
        baseId: base.id,
        slug: gallerySlug,
        name: "E2E Pagination Gallery",
        type: "gallery",
        config: { filters: [], sorts: [] },
        message: marker,
        submittedBy: "playwright",
      },
    }),
  );
  await reviewOne(request, galleryChangeRequest.id, "approved");
  await mergeOne(request, galleryChangeRequest.id);

  const firstPage = await json<{
    page: number;
    pageSize: number;
    records: unknown[];
    total: number;
    totalPages: number;
  }>(await request.get(`/api/v1/records/page?baseId=${base.id}&page=1&pageSize=50`));
  const lastPageSize = firstPage.total - (firstPage.totalPages - 1) * firstPage.pageSize;

  await page.goto(`/dashboard/local/base/${baseSlug}`);
  const rows = page.locator("[data-record-id]");
  await expect(rows.first()).toBeVisible({ timeout: 45_000 });
  await expect(rows).toHaveCount(firstPage.pageSize);
  await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0);

  await page.getByRole("link", { name: `Go to page ${firstPage.totalPages}` }).click();
  await expect(page).toHaveURL(new RegExp(`recordPage=${firstPage.totalPages}`));
  await expect(rows).toHaveCount(lastPageSize);
  await expect(
    page.getByText(
      `${firstPage.total - lastPageSize + 1}–${firstPage.total} of ${firstPage.total}`,
    ),
  ).toBeVisible();

  await page.goBack();
  await expect(page).not.toHaveURL(/recordPage=/);
  await expect(rows).toHaveCount(firstPage.pageSize);

  const pageSizeSelect = page.getByRole("combobox", { name: "Rows per page" });
  await pageSizeSelect.click();
  await page.getByRole("option", { name: "100", exact: true }).click();
  await expect(page).toHaveURL(/recordPage=1/);
  await expect(page).toHaveURL(/recordPageSize=100/);
  await expect(rows).toHaveCount(100);

  await page.getByRole("link", { name: "Go to page 2" }).click();
  await expect(page).toHaveURL(/recordPage=2/);

  await page.goto(
    `/dashboard/local/base/${baseSlug}/${gallerySlug}?recordPage=${firstPage.totalPages}&recordPageSize=50`,
  );
  await expect(page.getByRole("navigation", { name: "Record pages" })).toBeVisible({
    timeout: 45_000,
  });
  await expect(page.locator("[data-record-id]")).toHaveCount(lastPageSize);
});
