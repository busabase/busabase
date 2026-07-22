import type { BaseVO, ChangeRequestVO, ViewVO } from "busabase-contract/types";
import { expect, json, test } from "./_fixtures";

test("saved view column drag and resize persist through change requests", async ({
  page,
  request,
}) => {
  const bases = await json<BaseVO[]>(await request.get("/api/v1/bases"));
  const blog = bases.find((base) => base.slug === "blog");
  if (!blog || blog.fields.length < 3) {
    throw new Error("The seeded blog base with at least three fields is required");
  }
  const initialSlugs = blog.fields.slice(0, 3).map((field) => field.slug);
  const viewSlug = `column-layout-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const createRequest = await json<ChangeRequestVO>(
    await request.post(`/api/v1/bases/${blog.id}/views/change-requests`, {
      data: {
        config: { filters: [], sorts: [], visibleFieldSlugs: initialSlugs },
        name: "Column layout",
        slug: viewSlug,
        submittedBy: "playwright",
      },
    }),
  );
  await json(
    await request.post(`/api/v1/change-requests/${createRequest.id}/reviews`, {
      data: { verdict: "approved" },
    }),
  );
  const merged = await json<{ view: ViewVO | null }>(
    await request.post(`/api/v1/change-requests/${createRequest.id}/merge`, { data: {} }),
  );
  if (!merged.view) {
    throw new Error("Expected the column layout view to be merged");
  }

  await page.goto("/dashboard/local/base/blog");
  await expect(page.locator('[data-testid^="field-drag-handle-"]')).toHaveCount(0);
  await expect(page.locator('[data-testid^="field-resize-handle-"]')).toHaveCount(0);
  await page.getByTestId(`field-header-actions-${initialSlugs[0]}`).click();
  await expect(
    page.getByText("Create or open a saved view to sort, filter, resize, reorder, or hide fields."),
  ).toBeVisible();

  const workflowRequests = { merge: 0, review: 0, update: 0 };
  page.on("request", (browserRequest) => {
    if (browserRequest.method() !== "POST") {
      return;
    }
    const url = browserRequest.url();
    if (url.includes("/api/rpc/views/updateChangeRequest")) {
      workflowRequests.update += 1;
    } else if (url.includes("/api/rpc/changeRequests/review")) {
      workflowRequests.review += 1;
    } else if (url.includes("/api/rpc/changeRequests/merge")) {
      workflowRequests.merge += 1;
    }
  });

  await page.goto(`/dashboard/local/base/blog/${merged.view.slug}`);
  const grid = page.getByTestId("base-records-grid");
  const fieldSlugs = () =>
    grid
      .getByRole("columnheader")
      .evaluateAll((headers) =>
        headers.flatMap((header) =>
          header instanceof HTMLElement && header.dataset.fieldSlug
            ? [header.dataset.fieldSlug]
            : [],
        ),
      );
  await expect.poll(fieldSlugs).toEqual(initialSlugs);

  await page
    .getByTestId(`field-drag-handle-${initialSlugs[0]}`)
    .dragTo(grid.locator(`[data-field-slug="${initialSlugs[2]}"]`));
  const reorderedSlugs = [initialSlugs[1], initialSlugs[2], initialSlugs[0]];
  await expect.poll(fieldSlugs).toEqual(reorderedSlugs);

  const resizedSlug = reorderedSlugs[0];
  const resizedHeader = grid.locator(`[data-field-slug="${resizedSlug}"]`);
  const before = await resizedHeader.boundingBox();
  const resizeHandle = page.getByTestId(`field-resize-handle-${resizedSlug}`);
  const handle = await resizeHandle.boundingBox();
  if (!before || !handle) {
    throw new Error("Expected visible header and resize handle bounds");
  }
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 64, handle.y + handle.height / 2, {
    steps: 4,
  });
  await page.mouse.up();
  await expect
    .poll(async () => (await resizedHeader.boundingBox())?.width ?? 0)
    .toBeGreaterThan(before.width + 48);

  await expect.poll(() => ({ ...workflowRequests })).toEqual({ merge: 2, review: 2, update: 2 });
  await expect
    .poll(async () => {
      const views = await json<ViewVO[]>(await request.get(`/api/v1/bases/${blog.id}/views`));
      const view = views.find((item) => item.id === merged.view?.id);
      return {
        order: view?.config.visibleFieldSlugs,
        width: view?.config.fieldWidths?.[resizedSlug] ?? 0,
      };
    })
    .toEqual({ order: reorderedSlugs, width: Math.round(before.width + 64) });

  await page.reload();
  await expect.poll(fieldSlugs).toEqual(reorderedSlugs);
  await expect
    .poll(async () => (await resizedHeader.boundingBox())?.width ?? 0)
    .toBeCloseTo(Math.round(before.width + 64), 0);
});
