import type { BaseVO } from "busabase-contract/types";
import { expect, json, test } from "./_fixtures";

test.setTimeout(120_000);
test.describe.configure({ mode: "serial" });

const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
const taskSlug = `field-dependency-tasks-${suffix}`;
const invoiceSlug = `field-dependency-invoices-${suffix}`;
const reviewSlug = `budget-review-${suffix}`;

let tasks: BaseVO;
let invoices: BaseVO;

test.beforeAll(async ({ request }) => {
  tasks = await json<BaseVO>(
    await request.post("/api/v1/bases", {
      data: {
        autoMerge: true,
        name: "Launch tasks",
        slug: taskSlug,
        fields: [
          { name: "Task", required: true, slug: "task", type: "text" },
          { name: "Budget", slug: "budget", type: "number" },
          {
            name: "Budget doubled",
            slug: "double_budget",
            type: "formula",
            options: { formula: { expression: "{budget} * 2" } },
          },
        ],
      },
    }),
  );
  await json(
    await request.post("/api/v1/views/change-requests", {
      data: {
        operation: "create",
        autoMerge: true,
        baseId: tasks.id,
        type: "table",
        name: "Budget review",
        slug: reviewSlug,
        config: {
          filters: [{ fieldSlug: "budget", operator: "not_empty" }],
          sorts: [{ fieldSlug: "budget", direction: "desc" }],
          visibleFieldSlugs: ["task", "budget", "double_budget"],
        },
      },
    }),
  );
  invoices = await json<BaseVO>(
    await request.post("/api/v1/bases", {
      data: {
        autoMerge: true,
        name: "Vendor invoices",
        slug: invoiceSlug,
        fields: [
          { name: "Invoice", required: true, slug: "invoice", type: "text" },
          {
            name: "Linked task",
            slug: "linked_task",
            type: "relation",
            options: { targetBaseId: tasks.id },
          },
          {
            name: "Task budget",
            slug: "task_budget",
            type: "lookup",
            options: {
              lookup: { relationFieldSlug: "linked_task", targetFieldSlug: "budget" },
            },
          },
        ],
      },
    }),
  );
});

test("reviewer sees structured dependencies before deleting a field and can inspect a view", async ({
  page,
}) => {
  await page.goto("/dashboard/local/home");
  const taskLink = page.locator(`a[data-sidebar="menu-button"][href$="/${taskSlug}"]`);
  await expect(taskLink).toBeVisible();
  await taskLink.click();
  await page.getByText("Design", { exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Delete Budget", exact: true })).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("00-base-design.png"),
    clip: { x: 255, y: 0, width: 1025, height: 720 },
  });
  await page.getByRole("button", { name: "Delete Budget", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Delete field: Budget" });
  await expect(dialog.getByText("Checking saved views…")).toBeHidden();
  await expect(dialog).toContainText("Budget review · view filter");
  await expect(dialog).toContainText("Budget review · view sort");
  await expect(dialog).toContainText("Budget review · view layout");
  await expect(dialog).toContainText(`${tasks.name} / Budget doubled · formula field`);
  await expect(dialog).toContainText(`${invoices.name} / Task budget · lookup field`);
  await expect(dialog).toContainText(
    "Hidden Bases, Forms, Workflow configurations, and AirApp source code are not checked.",
  );
  await expect(dialog.getByRole("button", { name: "Request delete" })).toBeEnabled();
  await dialog.screenshot({ path: test.info().outputPath("01-field-dependencies.png") });

  await dialog.getByRole("link", { name: "Budget review" }).first().click();
  await expect(page).toHaveURL(new RegExp(`/base/${taskSlug}/${reviewSlug}$`));
  await expect(page.getByText("Budget review", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Approved change requests appear here after merge.")).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("02-affected-view.png"),
    clip: { x: 255, y: 0, width: 1025, height: 720 },
  });
});

test("mobile reviewer can inspect and cancel without changing the field", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/dashboard/local/base/${taskSlug}/design`);
  await page.getByRole("button", { name: "Delete Budget", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Delete field: Budget" });
  await expect(dialog.getByText("Checking saved views…")).toBeHidden();
  await expect(dialog).toContainText(`${invoices.name} / Task budget · lookup field`);
  const bounds = await dialog.boundingBox();
  if (!bounds) throw new Error("Delete field dialog has no visible bounds");
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: test.info().outputPath("03-mobile-dependencies.png") });

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Delete Budget", exact: true })).toBeVisible();
});
