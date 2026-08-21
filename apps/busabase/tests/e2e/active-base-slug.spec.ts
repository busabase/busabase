import type { BaseVO, ChangeRequestVO } from "busabase-contract/types";
import { expect, json, mergeOne, reviewOne, test } from "./_fixtures";

const RENDER_TIMEOUT = 45_000;

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
  await expect(page.getByRole("heading", { name: "Trash" })).toHaveCount(0);
  await expect(page.getByText(archivedName, { exact: true })).toHaveCount(0);

  // Slug navigation is canonical for the active Base, while the archived
  // Base remains directly reachable by its stable id for restore actions.
  await page.goto(`/dashboard/local/base/${archivedBase.id}`);

  await expect(page.getByRole("heading", { name: "Trash" })).toBeVisible({
    timeout: RENDER_TIMEOUT,
  });
  await expect(page.getByText(archivedName, { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: activeName })).toHaveCount(0);
});
