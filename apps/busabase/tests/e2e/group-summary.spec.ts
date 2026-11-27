import type { APIRequestContext, Locator, Page, TestInfo } from "@playwright/test";
import type { BaseVO, ChangeRequestVO, RecordVO, ViewVO } from "busabase-contract/types";
import { expect, json, mergeOne, reviewOne, test } from "./_fixtures";

// Real HTTP, database and the shipped dashboard: column summaries and a grouped
// table, driven the way a reviewer would. Run with `playwright.group-summary.config.ts`.
test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);
test.use({ viewport: { width: 1512, height: 982 } });

const LEAD_ROWS = 56;
type Fixture = { base: BaseVO; view: ViewVO; wonId: string };
let fixture: Fixture;

async function createFixture(request: APIRequestContext): Promise<Fixture> {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const base = await json<BaseVO>(
    await request.post("/api/v1/bases", {
      data: {
        autoMerge: true,
        name: `Pipeline ${suffix}`,
        slug: `pipeline-${suffix}`,
        fields: [
          { slug: "title", name: "Deal", type: "text", required: true },
          {
            slug: "stage",
            name: "Stage",
            type: "select",
            options: {
              choices: [
                { id: "c_lead", name: "Lead", color: "cyan" },
                { id: "c_won", name: "Won", color: "emerald" },
                { id: "c_lost", name: "Lost", color: "rose" },
              ],
            },
          },
          { slug: "amount", name: "Amount", type: "number" },
          { slug: "notes", name: "Notes", type: "text" },
          { slug: "hot", name: "Hot", type: "checkbox" },
        ],
      },
    }),
  );
  const records = [
    ...Array.from({ length: LEAD_ROWS }, (_, index) => ({
      title: `Lead ${String(index + 1).padStart(2, "0")}`,
      stage: "c_lead",
      amount: 10,
      ...(index % 2 === 0 ? { notes: "call back" } : {}),
      ...(index % 4 === 0 ? { hot: true } : {}),
    })),
    { title: "Won deal", stage: "c_won", amount: 500, notes: "signed", hot: true },
    { title: "Unsorted deal", amount: 40 },
  ];
  const bulk = await json<ChangeRequestVO>(
    await request.post(`/api/v1/bases/${base.id}/records/bulk-change-request`, {
      data: { records, message: "Seed pipeline" },
    }),
  );
  await reviewOne(request, bulk.id, "approved");
  await mergeOne(request, bulk.id);
  const view = await json<ViewVO>(
    await request.post("/api/v1/views/change-requests", {
      data: {
        operation: "create",
        baseId: base.id,
        autoMerge: true,
        name: "Board grid",
        slug: "board-grid",
      },
    }),
  );
  const page = await json<{ records: RecordVO[] }>(
    await request.get(`/api/v1/records/page?baseId=${base.id}&pageSize=100`),
  );
  const won = page.records.find((record) => record.headCommit.payload.title === "Won deal");
  if (!won) throw new Error("Seeded Won deal is missing");
  return { base, view, wonId: won.id };
}

const shot = (page: Page, info: TestInfo, name: string) =>
  page.screenshot({ path: info.outputPath(`${name}.png`), animations: "disabled" });

const footerCell = (page: Page, slug: string): Locator =>
  page.getByTestId("grid-summary-footer").locator(`[data-summary-field="${slug}"]`);

const groupHeader = (page: Page, id: string): Locator =>
  page.locator(`[data-testid="grid-group-header"][data-group-id="${id}"]`);

async function chooseSummary(page: Page, slug: string, option: string) {
  await footerCell(page, slug).click();
  await page.getByRole("menuitemradio", { name: option, exact: true }).click();
}

test.beforeAll(async ({ request }) => {
  fixture = await createFixture(request);
});

test("summaries count the whole view, and grouping splits it by stage", async ({
  page,
  request,
}, info) => {
  await page.goto(`/dashboard/local/base/${fixture.base.slug}/${fixture.view.slug}`);
  const grid = page.getByTestId("base-records-grid");
  await expect(grid.locator("[data-record-id]").first()).toBeVisible();

  // 1. Summaries: exact over all 58 records, not just the first page.
  await chooseSummary(page, "amount", "Sum");
  await expect(footerCell(page, "amount")).toContainText("1100");
  await chooseSummary(page, "notes", "Percent filled");
  // 28 lead notes + the won deal's = 29 of 58.
  await expect(footerCell(page, "notes")).toContainText("50%");
  await expect(page.getByTestId("grid-summary-count")).toHaveText("58 records");
  // A checkbox counts checked boxes, never "filled": 14 hot leads + the won deal = 15 of 58.
  await footerCell(page, "hot").click();
  await expect(
    page.getByRole("menuitemradio", { name: "Percent filled", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("menuitemradio", { name: "Percent checked", exact: true }).click();
  await expect(footerCell(page, "hot")).toContainText("26%");
  await shot(page, info, "01-summaries");

  // 2. Group by Stage.
  await page.getByTestId("group-control").click();
  await page.getByTestId("group-option-stage").check();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(groupHeader(page, "c_lead")).toBeVisible();
  const headerIds = await page
    .getByTestId("grid-group-header")
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-group-id")));
  expect(headerIds).toEqual(["c_lead", "c_won", "__empty__"]);
  await expect(groupHeader(page, "c_lead").getByTestId("grid-group-count")).toHaveText(
    String(LEAD_ROWS),
  );
  await expect(groupHeader(page, "c_won").getByTestId("grid-group-count")).toHaveText("1");
  // Per-group sums sit in the header row, under the Amount column.
  await expect(groupHeader(page, "c_lead").locator('[data-summary-field="amount"]')).toContainText(
    String(LEAD_ROWS * 10),
  );
  // No page numbers in a grouped table.
  await expect(page.getByRole("link", { name: "Go to next page", exact: true })).toHaveCount(0);
  const saved = await json<ViewVO[]>(await request.get(`/api/v1/bases/${fixture.base.id}/views`));
  expect(saved.find((view) => view.id === fixture.view.id)?.config).toMatchObject({
    groupBy: [{ fieldSlug: "stage", direction: "asc" }],
    fieldSummaries: { amount: "sum", notes: "percent_filled", hot: "percent_checked" },
  });
  await shot(page, info, "02-grouped");

  // 3. Load more inside the Lead group: the first page holds 50 of its rows.
  const leadRows = grid.locator('[data-cell-field="title"]').filter({ hasText: /Lead \d+/ });
  await expect(leadRows).toHaveCount(50);
  await expect(page.getByTestId("grid-group-load-more")).toHaveText(`Load ${LEAD_ROWS - 50} more`);
  await page.getByTestId("grid-group-load-more").click();
  await expect(leadRows).toHaveCount(LEAD_ROWS);
  await expect(page.getByTestId("grid-group-load-more")).toHaveCount(0);
  await shot(page, info, "03-load-more");

  // 4. Collapse and expand.
  await groupHeader(page, "c_lead").getByTestId("grid-group-toggle").click();
  await expect(grid.getByText("Lead 01", { exact: true })).toHaveCount(0);
  await expect(grid.getByText("Won deal", { exact: true })).toBeVisible();
  await shot(page, info, "04-collapsed");
  await groupHeader(page, "c_lead").getByTestId("grid-group-toggle").click();
  await expect(grid.getByText("Lead 01", { exact: true })).toBeVisible();

  // 5. Edit the won deal's stage inline: it moves to Lost after the refetch.
  const stageCell = page.locator(`[data-grid-cell="${fixture.wonId}::stage"]`);
  await stageCell.scrollIntoViewIfNeeded();
  await stageCell.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("option", { name: "Lost", exact: true }).click();
  await expect(groupHeader(page, "c_lost")).toBeVisible({ timeout: 30_000 });
  await expect(groupHeader(page, "c_won")).toHaveCount(0);
  await expect(groupHeader(page, "c_lost").getByTestId("grid-group-count")).toHaveText("1");
  const order = await page
    .getByTestId("grid-group-header")
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-group-id")));
  expect(order).toEqual(["c_lead", "c_lost", "__empty__"]);
  await shot(page, info, "05-moved-group");

  // 6. A reload keeps everything: it is saved in the view, not the session.
  await page.reload();
  await expect(groupHeader(page, "c_lost")).toBeVisible();
  await expect(footerCell(page, "amount")).toContainText("1100");
});
