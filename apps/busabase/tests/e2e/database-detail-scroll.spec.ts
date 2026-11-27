import type { BaseVO, ChangeRequestVO } from "busabase-contract/types";
import {
  type APIRequestContext,
  expect,
  json,
  mergeOne,
  reviewOne,
  test,
  unique,
} from "./_fixtures";

const LONG_LIST_RECORD_COUNT = 1005;

const uploadCover = async (request: APIRequestContext) => {
  // A real uploaded attachment keeps this capacity test on the same validation
  // path as users. A made-up id is rejected when the record request merges.
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAGAAAABACAIAAABqVuVZAAAB+0lEQVR42u3avU7DMBAHcOfIxlKhdkFCRazMIPEaTLwCEwsDC1IkFgYGtr4AAxOvwYAY+wBMDCBUMbHBUCkKbeJc/XF27P9NLW0u8k/ns11SvL5/K0R3EAgABCAAAQhAg40yk3Eeflb16/m44l9YJL8PatI0g8lEeeroP8oFqJeAY4QmnQHQzeOT8Qzq/RqlodNqhAr65+LJiBKbWQDikjG3Ob1fo8TKx3lZUXqTq/60tzo4VUZJth6OUYCjxvntXYSNeT6uVizW/yJxWK11ZleXkehcn53G0oOatSNQR5L7APIxs3wYmY3W3og89R23RjbjtDQif13ZlZF9FdhkIK9rlr2RzHki5D7IxsihjnEqEhh2JOuamRHJFIXBJT4ml0FOEpsyG13or/VsmpkkDxPMy4M3ZkMgJ62kN4mAzka3IPlGq0klVjv8G1GQZSiGdY1pRPEMRr71cO5IoXRWMkfVmLlAvmunzh9Qp/fWnT+Yic2s3f2D4GWi+WmNoKOvI4r26BSJUcj/akRSPnqj4uLhvvn++eUrT51lTCcLXQVlrqOUevsYdQJBp9WIoKM3IkmdAUVttPW7d5ztsqWP0faPUqo8Odpxm7erHoelsyyi6WTh/kn7VvH11WEoRmWo/YXCY8AKz0kDCAEgAAEIQAACEIAABCAEgIziD6nf2amwW7nXAAAAAElFTkSuQmCC",
    "base64",
  );
  const fileName = "page-size-cover.png";
  const mimeType = "image/png";
  const requested = await json<{ storageKey: string; uploadUrl: string }>(
    await request.post("/api/v1/assets/upload-urls", {
      data: { fileName, mimeType, sizeBytes: bytes.byteLength },
    }),
  );
  const uploaded = await request.put(requested.uploadUrl, {
    data: bytes,
    headers: { "content-type": mimeType },
  });
  expect(uploaded.ok(), `Cover upload failed: ${uploaded.status()}`).toBe(true);
  const confirmed = await json<{ attachmentId: string; publicUrl: string }>(
    await request.post("/api/v1/assets/confirmations", {
      data: { fileName, mimeType, sizeBytes: bytes.byteLength, storageKey: requested.storageKey },
    }),
  );
  return {
    attachmentId: confirmed.attachmentId,
    fileName,
    mimeType,
    size: bytes.byteLength,
    url: confirmed.publicUrl,
  };
};

test("Table and Gallery can jump between numbered record pages", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(240_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const pageResponses: Array<{ page: number; pageSize: number; count: number; total: number }> = [];
  const responseReadErrors: string[] = [];
  page.on("response", async (response) => {
    if (!response.url().includes("/records/listPage") || !response.ok()) return;
    try {
      const body = (await response.json()) as {
        json?: { page: number; pageSize: number; records: unknown[]; total: number };
      };
      if (body.json?.records) {
        pageResponses.push({
          page: body.json.page,
          pageSize: body.json.pageSize,
          count: body.json.records.length,
          total: body.json.total,
        });
      }
    } catch (error) {
      responseReadErrors.push(error instanceof Error ? error.message : String(error));
    }
  });
  const observations: Array<Record<string, unknown>> = [];
  const observe = async (step: string, startedAt: number) => {
    observations.push({
      step,
      elapsedMs: Date.now() - startedAt,
      ...(await page.evaluate(() => ({
        domRecords: document.querySelectorAll("[data-record-id]").length,
        domImages: document.querySelectorAll("[data-record-id] img").length,
        jsHeapBytes: (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
          ?.usedJSHeapSize,
      }))),
    });
  };
  const cover = await uploadCover(request);
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
          { name: "Cover", slug: "cover", type: "attachment" },
        ],
        name: unique("Record Pagination"),
        slug: baseSlug,
      },
    }),
  );
  const marker = unique("E2E long list");
  for (let offset = 0; offset < LONG_LIST_RECORD_COUNT; offset += 1000) {
    const changeRequest = await json<{ id: string }>(
      await request.post(`/api/v1/bases/${base.id}/records/bulk-change-request`, {
        data: {
          message: marker,
          // Pinned for the same reason the view CR below is: this spec drives the
          // propose -> approve -> merge path, and `autoMerge` is permission-aware
          // when omitted. Without this the review/merge calls become no-ops that
          // still return 200, so the spec would pass while testing nothing.
          autoMerge: false,
          records: Array.from(
            { length: Math.min(1000, LONG_LIST_RECORD_COUNT - offset) },
            (_, index) => ({
              body: `${marker} body ${offset + index}`,
              cover: [cover],
              title: `${marker} row ${offset + index}`,
            }),
          ),
          submittedBy: "playwright",
        },
      }),
    );
    await reviewOne(request, changeRequest.id, "approved");
    await mergeOne(request, changeRequest.id);
  }

  const gallerySlug = `e2e-pagination-gallery-${Date.now()}`;
  const galleryChangeRequest = await json<ChangeRequestVO>(
    await request.post("/api/v1/views/change-requests", {
      data: {
        operation: "create",
        baseId: base.id,
        slug: gallerySlug,
        name: "E2E Pagination Gallery",
        type: "gallery",
        config: { filters: [], sorts: [], coverFieldSlug: "cover" },
        message: marker,
        submittedBy: "playwright",
        // Pin the review-first branch: this spec asserts the propose -> approve -> merge
        // workflow, which the endpoint would otherwise skip for a write-capable actor.
        autoMerge: false,
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
  // The bare Base route opens its leftmost view — the default "Grid view".
  await expect(page).toHaveURL(new RegExp(`/dashboard/local/base/${baseSlug}/grid-view$`), {
    timeout: 45_000,
  });
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
  // A full 100-row page is windowed (`>= VIRTUALIZE_ROW_THRESHOLD`), so the DOM
  // no longer holds every row. Prove the page size took effect via the range
  // label and that at least one row rendered.
  await expect(page.getByText(`1–100 of ${firstPage.total}`)).toBeVisible();
  await expect(rows.first()).toBeVisible();

  const tableStart = Date.now();
  await pageSizeSelect.click();
  await page.getByRole("option", { name: "1000", exact: true }).click();
  await expect(
    page.getByText(`1–1000 of ${LONG_LIST_RECORD_COUNT}`, { exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      pageResponses.some(
        (item) => item.page === 1 && item.pageSize === 1000 && item.count === 1000,
      ),
    )
    .toBe(true);
  await expect(rows.first()).toBeVisible();
  // Keep develop's source-view context when the pager changes the record slice.
  // Without the provider, opening a record would lose the view it came from.
  await expect(rows.first().locator('a[href*="fromView="]').first()).toHaveAttribute(
    "href",
    /fromView=grid-view/,
  );
  await observe("table-1000", tableStart);
  await page.screenshot({ path: testInfo.outputPath("table-1000.png") });
  await page.getByRole("link", { name: "Go to page 2", exact: true }).click();
  await expect(page).toHaveURL(/recordPage=2/);
  await expect(rows).toHaveCount(5);

  await page.goto(
    `/dashboard/local/base/${baseSlug}/${gallerySlug}?recordPage=${firstPage.totalPages}&recordPageSize=50`,
  );
  await expect(page.getByRole("navigation", { name: "Record pages" })).toBeVisible({
    timeout: 45_000,
  });
  await expect(page.locator("[data-record-id]")).toHaveCount(lastPageSize);
  for (const size of [200, 500, 1000]) {
    const galleryStart = Date.now();
    await pageSizeSelect.click();
    await page.getByRole("option", { name: String(size), exact: true }).click();
    await expect(page.locator("[data-record-id]")).toHaveCount(size);
    await expect(
      page.getByText(`1–${size} of ${LONG_LIST_RECORD_COUNT}`, { exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`recordPageSize=${size}`));
    await expect(
      page.locator("[data-record-id]").first().locator('a[href*="fromView="]').first(),
    ).toHaveAttribute("href", new RegExp(`fromView=${gallerySlug}`));
    const actual = await json<{ records: unknown[]; totalPages: number }>(
      await request.get(`/api/v1/records/page?baseId=${base.id}&page=1&pageSize=${size}`),
    );
    expect(actual.records).toHaveLength(size);
    expect(actual.totalPages).toBe(Math.ceil(LONG_LIST_RECORD_COUNT / size));
    await expect
      .poll(() =>
        pageResponses.some(
          (item) => item.page === 1 && item.pageSize === size && item.count === size,
        ),
      )
      .toBe(true);
    await expect(page.locator("[data-record-id] img")).toHaveCount(size);
    await expect
      .poll(() =>
        page
          .locator("[data-record-id] img")
          .evaluateAll((images) =>
            images.every(
              (image) =>
                (image as HTMLImageElement).complete &&
                (image as HTMLImageElement).naturalWidth > 0,
            ),
          ),
      )
      .toBe(true);
    await observe(`gallery-${size}`, galleryStart);
  }
  await page.screenshot({ path: testInfo.outputPath("gallery-1000.png") });
  await page.getByRole("link", { name: "Go to page 2", exact: true }).click();
  await expect(page.locator("[data-record-id]")).toHaveCount(5);
  await page.screenshot({ path: testInfo.outputPath("gallery-page-2-five.png") });
  await page.goBack();
  await expect(page.locator("[data-record-id]")).toHaveCount(1000);
  await page.reload();
  await expect(page.locator("[data-record-id]")).toHaveCount(1000);
  await page.locator("[data-record-id]").last().scrollIntoViewIfNeeded();
  await expect(page.locator("[data-record-id]").last()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("gallery-1000-end.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(pageSizeSelect).toBeVisible();
  await expect(page.locator("[data-record-id]")).toHaveCount(1000);
  await pageSizeSelect.click();
  await expect(page.getByRole("option", { name: "25", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("gallery-1000-mobile-menu.png") });
  await page.getByRole("option", { name: "25", exact: true }).click();
  await expect(page.locator("[data-record-id]")).toHaveCount(25);
  await page.screenshot({ path: testInfo.outputPath("gallery-back-to-25.png") });
  expect(pageErrors).toEqual([]);
  await testInfo.attach("page-size-observations", {
    body: JSON.stringify(
      {
        total: LONG_LIST_RECORD_COUNT,
        pageResponses,
        responseReadErrors,
        observations,
        pageErrors,
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
  console.log(
    JSON.stringify({ total: LONG_LIST_RECORD_COUNT, pageResponses, observations, pageErrors }),
  );
});
