import { type APIRequestContext, cmsPostFields, expect, json, test, unique } from "./_fixtures";

interface BaseVO {
  id: string;
  slug: string;
}

interface ChangeRequestVO {
  id: string;
  status: string;
  primaryOperation?: { id: string } | null;
  record?: RecordVO | null;
}

interface RecordVO {
  id: string;
  base: { slug: string };
  headCommit: { fields: Record<string, unknown> };
}

const getBlogBase = async (request: APIRequestContext) => {
  const bases = await json<BaseVO[]>(await request.get("/api/v1/bases"));
  const blogBase = bases.find((base) => base.slug === "blog");
  if (!blogBase) {
    throw new Error("Blog base not found");
  }
  return blogBase;
};

test("review -> merge -> refresh keeps user-visible lineage", async ({ page, request }) => {
  const blogBase = await getBlogBase(request);
  const title = unique("E2E lineage record");

  const created = await json<ChangeRequestVO>(
    await request.post(`/api/v1/bases/${blogBase.id}/change-requests`, {
      data: {
        fields: cmsPostFields({
          title,
          body: "Lineage should remain visible after merge and refresh.",
        }),
        message: "Create lineage test record",
        submittedBy: "e2e-agent",
        autoMerge: false,
      },
    }),
  );

  await page.goto(`/dashboard/local/inbox/${created.id}`);
  await expect(page.getByText("Waiting for your review")).toBeVisible();
  await page.getByRole("radio", { name: "Approve" }).check();
  await page.getByRole("button", { exact: true, name: "Approve" }).click();
  await expect(
    page.getByRole("complementary").getByText("Approved · ready to merge"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Merge into Base" }).click();
  await expect(page).toHaveURL(/\/dashboard\/local\/base\/blog\/rec/);
  await expect(page.getByText("Lineage", { exact: true })).toBeVisible();
  await expect(page.getByText("Review history")).toBeVisible();
  await expect(page.getByLabel("Technical IDs")).not.toHaveAttribute("open", "");
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await page.getByRole("link", { exact: true, name: "Source" }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/local/inbox/${created.id}$`));
  await page.goBack();

  await page.reload();
  await expect(page.getByText("Lineage", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
});

test("request changes is recoverable and revision returns to review", async ({ page, request }) => {
  const blogBase = await getBlogBase(request);
  const title = unique("E2E request changes");
  const fields = cmsPostFields({ title, body: "Initial body from an agent." });
  const created = await json<ChangeRequestVO>(
    await request.post(`/api/v1/bases/${blogBase.id}/change-requests`, {
      data: {
        fields,
        message: "Create request-changes test record",
        submittedBy: "e2e-agent",
        autoMerge: false,
      },
    }),
  );
  const operationId = created.primaryOperation?.id;
  if (!operationId) {
    throw new Error("Created CR has no operation");
  }

  await page.goto(`/dashboard/local/inbox/${created.id}`);
  await page.getByRole("radio", { name: "Request changes" }).check();
  await page.getByLabel("Review summary").fill("Tighten the claim and mention @ai.");
  await page.getByRole("button", { exact: true, name: "Request changes" }).click();
  await expect(page.getByText("Changes requested · awaiting revision")).toBeVisible();
  await expect(page.getByText("Changes were requested.")).toBeVisible();

  await json<ChangeRequestVO>(
    await request.post(`/api/v1/operations/${operationId}/revisions`, {
      data: {
        fields: {
          ...fields,
          body: "Revised body with a tighter claim and clear source discipline.",
        },
        message: "Agent revision",
        author: "e2e-agent",
      },
    }),
  );

  await page.reload();
  await expect(page.getByText("Waiting for your review")).toBeVisible();
  await expect(page.getByText("changed since review")).toBeVisible();
  await expect(page.getByRole("radio", { name: "Approve" })).toBeChecked();
});

test("same-field merge conflict stays visible and recoverable", async ({ page, request }) => {
  const blogBase = await getBlogBase(request);
  const title = unique("E2E conflict base");
  const fields = cmsPostFields({ title, body: "original body" });

  const createCr = await json<ChangeRequestVO>(
    await request.post(`/api/v1/bases/${blogBase.id}/change-requests`, {
      data: {
        fields,
        message: "Create conflict base record",
        submittedBy: "e2e-agent",
        autoMerge: false,
      },
    }),
  );
  await json<ChangeRequestVO>(
    await request.post(`/api/v1/change-requests/${createCr.id}/reviews`, {
      data: { verdict: "approved" },
    }),
  );
  const merged = await json<{ record: RecordVO }>(
    await request.post(`/api/v1/change-requests/${createCr.id}/merge`, { data: {} }),
  );
  const recordId = merged.record.id;

  const firstUpdate = await json<ChangeRequestVO>(
    await request.put(`/api/v1/records/${recordId}/change-requests`, {
      data: {
        fields: { ...fields, title: `${title} A` },
        message: "First title edit",
        author: "e2e-editor-a",
      },
    }),
  );
  const conflictingUpdate = await json<ChangeRequestVO>(
    await request.put(`/api/v1/records/${recordId}/change-requests`, {
      data: {
        fields: { ...fields, title: `${title} B` },
        message: "Second title edit",
        author: "e2e-editor-b",
      },
    }),
  );

  await json<ChangeRequestVO>(
    await request.post(`/api/v1/change-requests/${firstUpdate.id}/reviews`, {
      data: { verdict: "approved" },
    }),
  );
  await json<{ record: RecordVO }>(
    await request.post(`/api/v1/change-requests/${firstUpdate.id}/merge`, { data: {} }),
  );

  await page.goto(`/dashboard/local/inbox/${conflictingUpdate.id}`);
  await page.getByRole("radio", { name: "Approve" }).check();
  await page.getByRole("button", { exact: true, name: "Approve" }).click();
  await expect(page.getByText("Approved · ready to merge")).toBeVisible();
  await page.getByRole("button", { name: "Merge into Base" }).click();
  await expect(page.getByText("Merge needs review")).toBeVisible();
  // The conflict is surfaced twice by design: the raw backend message (in the
  // ReviewConflictPanel banner) embeds "Conflicting field(s): title", and the
  // ConflictDiffPanel below it restates the same fields as a styled pill list —
  // match either, .first() avoids a strict-mode multi-match failure.
  await expect(page.getByText(/Conflicting field.*title/).first()).toBeVisible();
  await expect(page.getByText("The change request is still safe here")).toBeVisible();
  await expect(page.getByRole("heading", { name: `${title} B` })).toBeVisible();
});

test("record delete request explains impact and preserves the canonical record", async ({
  page,
  request,
}) => {
  const blogBase = await getBlogBase(request);
  const title = unique("E2E delete request record");

  const createCr = await json<ChangeRequestVO>(
    await request.post(`/api/v1/bases/${blogBase.id}/change-requests`, {
      data: {
        fields: cmsPostFields({ title, body: "Delete should be reviewable first." }),
        message: "Create delete request test record",
        submittedBy: "e2e-agent",
        autoMerge: false,
      },
    }),
  );
  await json<ChangeRequestVO>(
    await request.post(`/api/v1/change-requests/${createCr.id}/reviews`, {
      data: { verdict: "approved" },
    }),
  );
  const merged = await json<{ record: RecordVO }>(
    await request.post(`/api/v1/change-requests/${createCr.id}/merge`, { data: {} }),
  );

  await page.goto(`/dashboard/local/base/blog/${merged.record.id}`);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  // Delete actions live behind the record's "⋯" menu (a <details> disclosure).
  await page.locator("details").filter({ hasText: "Delete change request" }).first().click();
  await page.getByRole("button", { name: "Delete Change Request" }).click();
  await expect(page.getByText("Create delete request?")).toBeVisible();
  await expect(page.getByText("The canonical record stays visible")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();

  await page.locator("details").filter({ hasText: "Delete change request" }).first().click();
  await page.getByRole("button", { name: "Delete Change Request" }).click();
  await page.getByRole("button", { name: "Create delete request" }).click();
  await expect(page).toHaveURL(/\/dashboard\/local\/inbox\/crq/);
  await expect(page.getByText("Waiting for your review")).toBeVisible();
  await expect(page.getByText("destructive", { exact: true })).toBeVisible();

  await page.goto(`/dashboard/local/base/blog/${merged.record.id}`);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
});
