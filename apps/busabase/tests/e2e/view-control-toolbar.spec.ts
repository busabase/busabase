import type { BaseVO, ChangeRequestVO, ViewVO } from "busabase-contract/types";
import { expect, json, test } from "./_fixtures";

test("staged view controls recover a hidden conditioned field with one update CR", async ({
  page,
  request,
}) => {
  const bases = await json<BaseVO[]>(await request.get("/api/v1/bases"));
  const blog = bases.find((base) => base.slug === "blog");
  if (!blog || blog.fields.length < 3) {
    throw new Error("The seeded blog base with at least three fields is required");
  }
  const visibleFields = blog.fields.slice(0, 2);
  const hiddenField = blog.fields[2];
  const viewSlug = `view-controls-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const createRequest = await json<ChangeRequestVO>(
    await request.post(`/api/v1/bases/${blog.id}/views/change-requests`, {
      data: {
        config: {
          cardSize: "large",
          fieldWidths: { [visibleFields[0].slug]: 220 },
          filters: [
            {
              fieldId: hiddenField.id,
              fieldSlug: hiddenField.slug,
              operator: "is_empty",
            },
          ],
          sorts: [
            {
              direction: "asc",
              fieldId: hiddenField.id,
              fieldSlug: hiddenField.slug,
            },
            {
              direction: "desc",
              fieldId: visibleFields[0].id,
              fieldSlug: visibleFields[0].slug,
            },
          ],
          visibleFieldSlugs: visibleFields.map((field) => field.slug),
        },
        name: "View control recovery",
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
    throw new Error("Expected the staged-control view to be merged");
  }

  await page.goto("/dashboard/local/base/blog");
  const readonlyToolbar = page.getByTestId("view-control-toolbar-readonly");
  await expect(readonlyToolbar).toContainText("Open a saved view or create one");
  await expect(page.getByTestId("base-new-view-button")).toBeVisible();

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
  await expect(page.locator(`[data-field-slug="${hiddenField.slug}"]`)).toHaveCount(0);
  await expect(page.getByTestId("view-control-fields")).toContainText("2/");
  await expect(page.getByTestId("view-control-filters")).toContainText("1");
  await expect(page.getByTestId("view-control-sorts")).toContainText("2");

  await page.getByTestId("view-control-filters").click();
  const panel = page.getByTestId("shared-view-config-editor");
  await expect(panel).toHaveAttribute("data-editor-source", "toolbar");
  const filterRow = panel.locator(`[data-condition-field-slug="${hiddenField.slug}"]`);
  await expect(filterRow).toContainText("Hidden");
  await panel.getByLabel("Filter 1 operator").selectOption("not_empty");
  await panel.getByRole("button", { name: "Add filter" }).click();
  await panel.getByLabel("Filter 2 field").selectOption(visibleFields[0].id);
  await panel.getByLabel("Filter 2 value").fill("E2E shared editor");

  await panel.getByRole("button", { name: /Sort/ }).click();
  const sortRow = panel.locator(`[data-condition-field-slug="${hiddenField.slug}"]`);
  await expect(sortRow).toContainText("Hidden");
  await panel.getByLabel("Sort 2 direction").selectOption("asc");
  await panel.getByRole("button", { name: "Add sort" }).click();
  await panel.getByLabel("Move sort 3 up").click();

  await panel.getByRole("button", { name: /Fields/ }).click();
  const fieldsEditor = panel.getByTestId("toolbar-shared-fields");
  const hiddenFieldRow = fieldsEditor.locator(`[data-view-field-slug="${hiddenField.slug}"]`);
  await expect(hiddenFieldRow).toContainText("Hidden");
  await hiddenFieldRow.getByRole("checkbox").check();
  await panel.getByRole("button", { name: "Reset widths" }).click();
  await page.keyboard.press("Escape");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("view-editor-discard")).toHaveAttribute(
    "aria-label",
    "Discard staged changes",
  );

  await panel.getByRole("button", { name: "More submit options" }).click();
  await panel.getByRole("button", { name: "Update View Now" }).click();

  await expect(page.locator(`[data-field-slug="${hiddenField.slug}"]`)).toBeVisible();
  await expect.poll(() => ({ ...workflowRequests })).toEqual({ merge: 1, review: 1, update: 1 });
  await expect
    .poll(async () => {
      const views = await json<ViewVO[]>(await request.get(`/api/v1/bases/${blog.id}/views`));
      const view = views.find((item) => item.id === merged.view?.id);
      return {
        cardSize: view?.config.cardSize,
        fieldWidths: view?.config.fieldWidths,
        filters: view?.config.filters,
        sorts: view?.config.sorts,
        visible: view?.config.visibleFieldSlugs,
      };
    })
    .toEqual({
      cardSize: "large",
      fieldWidths: undefined,
      filters: [
        {
          fieldId: hiddenField.id,
          fieldSlug: hiddenField.slug,
          operator: "not_empty",
        },
        {
          fieldId: visibleFields[0].id,
          fieldSlug: visibleFields[0].slug,
          operator: "contains",
          value: "E2E shared editor",
        },
      ],
      sorts: [
        {
          direction: "asc",
          fieldId: hiddenField.id,
          fieldSlug: hiddenField.slug,
        },
        {
          direction: "asc",
          fieldId: visibleFields[1].id,
          fieldSlug: visibleFields[1].slug,
        },
        {
          direction: "asc",
          fieldId: visibleFields[0].id,
          fieldSlug: visibleFields[0].slug,
        },
      ],
      visible: [...visibleFields.map((field) => field.slug), hiddenField.slug],
    });
});

test("edit view reuses the shared fields editor and preserves unrelated config", async ({
  page,
  request,
}) => {
  const bases = await json<BaseVO[]>(await request.get("/api/v1/bases"));
  const blog = bases.find((base) => base.slug === "blog");
  if (!blog || blog.fields.length < 3) {
    throw new Error("The seeded blog base with at least three fields is required");
  }
  const visibleFields = blog.fields.slice(0, 2);
  const hiddenField = blog.fields[2];
  const viewSlug = `edit-view-fields-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const createRequest = await json<ChangeRequestVO>(
    await request.post(`/api/v1/bases/${blog.id}/views/change-requests`, {
      data: {
        config: {
          cardSize: "large",
          fieldWidths: { [visibleFields[0].slug]: 240 },
          filters: [
            {
              fieldId: visibleFields[0].id,
              fieldSlug: visibleFields[0].slug,
              operator: "not_empty",
            },
          ],
          sorts: [],
          visibleFieldSlugs: visibleFields.map((field) => field.slug),
        },
        name: "Edit view shared fields",
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
    throw new Error("Expected the edit-view saved view to be merged");
  }

  await page.goto(`/dashboard/local/base/blog/${merged.view.slug}`);
  await page.getByTestId("active-view-actions").click();
  await page.getByRole("button", { name: "Edit view" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Edit View" })).toBeVisible();
  const fieldsEditor = dialog.getByTestId("edit-view-shared-fields");
  await expect(fieldsEditor).toBeVisible();
  await expect(fieldsEditor.locator("[data-field-type-icon]").first()).toBeVisible();

  const hiddenFieldRow = fieldsEditor.locator(`[data-view-field-slug="${hiddenField.slug}"]`);
  await hiddenFieldRow.getByRole("checkbox").check();
  await hiddenFieldRow.getByRole("button", { name: /^Move .+ up$/ }).click();
  await fieldsEditor
    .locator(`[data-view-field-slug="${visibleFields[1].slug}"]`)
    .getByRole("checkbox")
    .uncheck();
  await fieldsEditor.getByRole("button", { name: "Reset widths" }).click();

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

  await dialog.getByRole("button", { name: "More submit options" }).click();
  await dialog.getByRole("button", { name: "Update View Now" }).click();

  await expect(dialog).toBeHidden();
  await expect.poll(() => ({ ...workflowRequests })).toEqual({ merge: 1, review: 1, update: 1 });
  await expect
    .poll(async () => {
      const views = await json<ViewVO[]>(await request.get(`/api/v1/bases/${blog.id}/views`));
      const view = views.find((item) => item.id === merged.view?.id);
      return {
        cardSize: view?.config.cardSize,
        fieldWidths: view?.config.fieldWidths,
        filters: view?.config.filters,
        sorts: view?.config.sorts,
        visible: view?.config.visibleFieldSlugs,
      };
    })
    .toEqual({
      cardSize: "large",
      fieldWidths: undefined,
      filters: [
        {
          fieldId: visibleFields[0].id,
          fieldSlug: visibleFields[0].slug,
          operator: "not_empty",
        },
      ],
      sorts: [],
      visible: [visibleFields[0].slug, hiddenField.slug],
    });
});
