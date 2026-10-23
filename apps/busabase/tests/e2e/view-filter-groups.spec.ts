import type { BaseVO, ViewVO } from "busabase-contract/types";
import { expect, json, test } from "./_fixtures";

test("save an AND filter with an OR group, reopen it, then clear it", async ({ page, request }) => {
  const slug = `filter-groups-${Date.now()}`;
  const base = await json<BaseVO>(
    await request.post("/api/v1/bases", {
      data: {
        slug,
        name: slug,
        fields: [
          { slug: "title", name: "Task", type: "text" },
          { slug: "owner", name: "Owner", type: "text" },
          { slug: "status", name: "Status", type: "text" },
        ],
      },
    }),
  );
  for (const [title, owner, status] of [
    ["My pending task", "Kelly", "pending"],
    ["My active task", "Kelly", "active"],
    ["My completed task", "Kelly", "done"],
    ["Another active task", "Alex", "active"],
  ]) {
    await json(
      await request.post(`/api/v1/bases/${base.id}/change-requests`, {
        data: { fields: { title, owner, status }, message: "Seed browser acceptance tasks" },
      }),
    );
  }
  const view = await json<ViewVO>(
    await request.post("/api/v1/views/change-requests", {
      data: { operation: "create", baseId: base.id, name: "My active work", slug: "my-work" },
    }),
  );
  await page.goto("/dashboard/local/home?lang=en");
  await page.getByText(slug, { exact: true }).first().click();
  await page.getByText(view.name, { exact: true }).first().click();
  const rows = page.getByTestId("base-records-grid").locator("[data-record-id]");
  await expect(rows).toHaveCount(4);
  await page.getByTestId("view-control-filters").click();
  const panel = page.getByTestId("shared-view-config-editor");
  const filters = panel.getByTestId("shared-view-filters");
  const ownerId = base.fields.find((field) => field.slug === "owner")?.id;
  const statusId = base.fields.find((field) => field.slug === "status")?.id;
  if (!ownerId || !statusId) throw new Error("Expected task fields");
  await filters.getByRole("button", { name: "Add filter", exact: true }).click();
  await filters.getByLabel("Filter 1 field", { exact: true }).selectOption(ownerId);
  await filters.getByLabel("Filter 1 operator", { exact: true }).selectOption("equals");
  await filters.getByLabel("Filter 1 value", { exact: true }).fill("Kelly");
  await filters.getByRole("button", { name: "Add condition group", exact: true }).click();
  const group = filters.getByTestId("view-filter-group");
  await expect(group.getByLabel("Condition combination")).toHaveValue("or");
  await group.getByLabel("Filter 1 field", { exact: true }).selectOption(statusId);
  await group.getByLabel("Filter 1 operator", { exact: true }).selectOption("equals");
  await group.getByLabel("Filter 1 value", { exact: true }).fill("pending");
  await group.getByRole("button", { name: "Add filter", exact: true }).click();
  await group.getByLabel("Filter 2 field", { exact: true }).selectOption(statusId);
  await group.getByLabel("Filter 2 operator", { exact: true }).selectOption("equals");
  await group.getByLabel("Filter 2 value", { exact: true }).fill("active");
  await panel.getByRole("button", { name: "Update View Now", exact: true }).click();
  await expect(panel).toBeHidden();
  await expect(rows).toHaveCount(2);
  await expect(rows).toContainText(["My active task", "My pending task"]);
  await page.reload();
  await expect(rows).toHaveCount(2);
  await page.getByTestId("view-control-filters").click();
  await expect(group.getByLabel("Condition combination")).toHaveValue("or");
  await filters.getByLabel("Condition combination").first().selectOption("or");
  await panel.getByRole("button", { name: "Update View Now", exact: true }).click();
  await expect(rows).toHaveCount(4);
  await page.reload();
  await expect(rows).toHaveCount(4);
  await page.getByTestId("view-control-filters").click();
  await filters.getByRole("button", { name: "Clear all filters", exact: true }).click();
  await expect(group).toHaveCount(0);
  await panel.getByRole("button", { name: "Update View Now", exact: true }).click();
  await expect(rows).toHaveCount(4);
  await page.reload();
  await expect(page.getByTestId("view-control-filters")).toContainText("0");
});
