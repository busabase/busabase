import type { BaseVO, ChangeRequestVO } from "busabase-contract/types";
import { expect, json, mergeOne, reviewOne, test } from "./_fixtures";

const RENDER_TIMEOUT = 45_000;

/**
 * An archived node's URL resolves to its own status page, which names the node
 * and offers Restore. It used to render the Trash list instead, so this spec
 * asserted a "Trash" heading — that heading now belongs only to `/archived`
 * (see `dashboard-views.spec.ts`), and matching it here silently passed for the
 * wrong reason before the archived state page existed.
 */
const ARCHIVED_HEADING = "This node is archived";

test("an active base wins when an archived base has the same slug", async ({ page, request }) => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const slug = `active-base-slug-${suffix}`;
  const archivedName = `Archived Base ${suffix}`;
  const activeName = `Active Base ${suffix}`;
  const archivedBase = await json<BaseVO>(
    await request.post("/api/v1/bases", {
      data: {
        autoMerge: true,
        fields: [{ name: "Title", required: true, slug: "title", type: "text" }],
        name: archivedName,
        slug,
      },
    }),
  );
  const archiveChangeRequest = await json<ChangeRequestVO>(
    await request.post(`/api/v1/bases/${archivedBase.id}/lifecycle/change-requests`, {
      data: {
        operation: "archive",
        message: "Archive the original Base before reusing its slug",
        submittedBy: "playwright",
      },
    }),
  );
  await reviewOne(request, archiveChangeRequest.id, "approved");
  await mergeOne(request, archiveChangeRequest.id);

  await json<BaseVO>(
    await request.post("/api/v1/bases", {
      data: {
        autoMerge: true,
        fields: [{ name: "Title", required: true, slug: "title", type: "text" }],
        name: activeName,
        slug,
      },
    }),
  );

  await page.goto(`/dashboard/local/base/${slug}`);

  await expect(page.getByRole("heading", { name: activeName })).toBeVisible({
    timeout: RENDER_TIMEOUT,
  });
  await expect(page.getByRole("heading", { name: ARCHIVED_HEADING })).toHaveCount(0);
  await expect(page.getByText(archivedName, { exact: true })).toHaveCount(0);

  // Slug navigation is canonical for the active Base, while the archived
  // Base remains directly reachable by its stable id for restore actions —
  // now through the archived status page rather than the Trash list.
  await page.goto(`/dashboard/local/base/${archivedBase.id}`);

  await expect(page.getByRole("heading", { name: ARCHIVED_HEADING })).toBeVisible({
    timeout: RENDER_TIMEOUT,
  });
  // Scope to the status page itself: the breadcrumb names the archived node too,
  // so an unscoped text match resolves to two elements and fails on strict mode.
  const archivedState = page.locator("section", {
    has: page.getByRole("heading", { name: ARCHIVED_HEADING }),
  });
  await expect(archivedState.getByText(archivedName, { exact: true })).toBeVisible();
  // The point of reaching it by id: restoring is offered right here.
  await expect(archivedState.getByRole("button", { name: "Restore" })).toBeVisible();
  await expect(page.getByRole("heading", { name: activeName })).toHaveCount(0);
});
