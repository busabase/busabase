import { appendFileSync, existsSync } from "node:fs";
import type { TestInfo } from "@playwright/test";
import { type APIRequestContext, expect, json, type Page, test } from "./_fixtures";

test.setTimeout(240_000);
test.use({ video: "on", viewport: { width: 1440, height: 1000 } });
test.afterEach(async ({ page }, info) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
  const path = info.outputPath("search-network.ndjson");
  if (existsSync(path))
    await info.attach("search-network", { path, contentType: "application/x-ndjson" });
});

const shot = async (page: Page, info: TestInfo, name: string) => {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await info.attach(name, { path, contentType: "image/png" });
};

const createBase = async (request: APIRequestContext, prefix: string) =>
  json<{ id: string; slug: string }>(
    await request.post("/api/v1/bases", {
      data: {
        slug: `${prefix}-${Date.now()}`,
        name: "Query load acceptance",
        autoMerge: true,
        fields: [
          { slug: "title", name: "Title", type: "text", options: {} },
          { slug: "notes", name: "Notes", type: "longtext", options: {} },
        ],
      },
    }),
  );

const openSearch = async (page: Page) => {
  const trigger = page.getByRole("button", { name: "Search", exact: true });
  const dialog = page.getByRole("dialog", { name: "Search", exact: true });
  // The streamed shell is visible before its click handler hydrates.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await page.locator("#busabase-dashboard-search").isVisible()) return dialog;
    await trigger.click();
    try {
      await page
        .locator("#busabase-dashboard-search")
        .waitFor({ state: "visible", timeout: 3_000 });
      return dialog;
    } catch {
      await page.waitForTimeout(250);
    }
  }
  throw new Error("Search dialog did not open after hydration");
};

test("search preserves real results, cancels superseded work and recovers by manual retry", async ({
  page,
  request,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", async (response) => {
    if (!response.url().endsWith("/api/rpc/search")) return;
    const body = await response.json().catch(() => undefined);
    appendFileSync(
      info.outputPath("search-network.ndjson"),
      `${JSON.stringify({
        status: response.status(),
        request: response.request().postData(),
        response: body,
      })}\n`,
    );
  });
  const base = await createBase(request, "green-search");
  for (const title of ["人工智能客服", "Discount 50% policy", "Literal_under_score", "C:\\files"]) {
    await json(
      await request.post(`/api/v1/bases/${base.id}/change-requests`, {
        data: { fields: { title, notes: "Acceptance fixture" }, autoMerge: true },
      }),
    );
  }
  await page.goto("/dashboard/local/home");
  await expect(page.getByRole("button", { name: "Search", exact: true })).toBeVisible({
    timeout: 120_000,
  });
  await shot(page, info, "01-workspace-home");

  const dialog = await openSearch(page);
  const field = dialog.getByRole("combobox", { name: "Search", exact: true });
  await field.fill("人工");
  await expect(
    dialog.getByTestId("search-result").filter({ hasText: "人工智能客服" }).first(),
  ).toBeVisible();
  await shot(page, info, "02-chinese-short-query");
  await field.fill("%");
  await expect(
    dialog.getByTestId("search-result").filter({ hasText: "Discount 50% policy" }).first(),
  ).toBeVisible();
  await expect(dialog.getByTestId("search-result").filter({ hasText: "人工智能客服" })).toHaveCount(
    0,
  );
  await shot(page, info, "03-literal-percent");

  const canceled: string[] = [];
  const held: Array<() => void> = [];
  let blocked = 0;
  let failedAttempts = 0;
  let recoveredAttempts = 0;
  let injectTimeout = true;
  page.on("requestfailed", (req) => {
    if (req.url().includes("/api/rpc/search") && req.postData()?.includes("superseded-query")) {
      canceled.push(req.url());
    }
  });
  await page.route("**/api/rpc/search", async (route) => {
    const body = route.request().postData() ?? "";
    if (body.includes("superseded-query")) {
      blocked++;
      await new Promise<void>((resolve) => held.push(resolve));
      await route.continue().catch(() => undefined);
    } else if (body.includes("manual-retry-query") && injectTimeout) {
      failedAttempts++;
      await route.fulfill({
        status: 504,
        contentType: "application/json",
        body: JSON.stringify({
          json: {
            defined: false,
            code: "TIMEOUT",
            status: 504,
            message: "Search took too long.",
          },
        }),
      });
    } else {
      if (body.includes("manual-retry-query")) recoveredAttempts++;
      await route.continue();
    }
  });
  await field.fill("superseded-query");
  await expect.poll(() => blocked).toBe(4);
  await field.fill("人工");
  for (const release of held) release();
  await expect.poll(() => canceled.length).toBe(4);
  await expect(
    dialog.getByTestId("search-result").filter({ hasText: "人工智能客服" }).first(),
  ).toBeVisible();
  await shot(page, info, "04-superseded-search-recovered");

  await field.fill("manual-retry-query");
  const retry = dialog.getByRole("button", { name: "Try again", exact: true });
  await expect(retry).toBeVisible();
  await expect.poll(() => failedAttempts).toBe(4);
  await page.waitForTimeout(1_200);
  expect(failedAttempts).toBe(4);
  await shot(page, info, "05-timeout-manual-retry");
  injectTimeout = false;
  await retry.click();
  await expect.poll(() => recoveredAttempts).toBe(4);
  await expect(retry).toBeHidden();
  await field.fill("人工");
  await expect(
    dialog.getByTestId("search-result").filter({ hasText: "人工智能客服" }).first(),
  ).toBeVisible();
  await shot(page, info, "05b-manual-retry-recovered");
  await dialog.getByRole("button", { name: "Advanced search", exact: true }).click();
  await expect(page).toHaveURL(/\/search\?/);
  await expect(page.getByRole("heading", { name: "Search", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "人工智能客服", exact: true }).first()).toBeVisible();
  await shot(page, info, "06-advanced-search");
  await page.getByRole("link", { name: "人工智能客服", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "人工智能客服", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "人工智能客服", exact: true })).toBeVisible();
  await shot(page, info, "07-record-after-refresh");
  expect(errors).toEqual([]);
});

test("a 360-operation proposal keeps comments, approval, merge and refreshed records usable", async ({
  page,
  request,
}, info) => {
  const base = await createBase(request, "green-scope");
  const cr = await json<{ id: string; operations: Array<{ id: string }> }>(
    await request.post(`/api/v1/bases/${base.id}/records/bulk-change-request`, {
      data: {
        message: "Review customer import",
        autoMerge: false,
        records: Array.from({ length: 360 }, (_, index) => ({
          title: `Customer import ${String(index).padStart(3, "0")}`,
          notes: "Full review payload remains available. ".repeat(20),
        })),
      },
    }),
  );
  expect(cr.operations).toHaveLength(360);
  const operationId = cr.operations[0]?.id;
  if (!operationId) throw new Error("Missing proposal operation");
  await page.goto("/dashboard/local/home");
  await page.locator(`a[href*="/inbox/${cr.id}"]`).first().click();
  await expect(page.getByText("Waiting for your review")).toBeVisible();
  await shot(page, info, "08-bulk-proposal");
  const operation = page.locator(`#op-${operationId}`);
  await operation.locator("button").first().click();
  const body = "Verified this customer import before approval.";
  await operation.getByRole("textbox").fill(body);
  await operation.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(operation.getByRole("textbox")).toHaveValue("");
  await expect(operation.getByText(body, { exact: true })).toBeVisible();
  await shot(page, info, "09-operation-comment");
  const comments = await json<Array<{ body: string }>>(
    await request.get(`/api/v1/comments?subjectType=operation&subjectId=${operationId}`),
  );
  expect(comments.some((comment) => comment.body === body)).toBe(true);
  await page.getByRole("radio", { name: "Approve", exact: true }).check();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(
    page.getByRole("complementary").getByText("Approved · ready to merge"),
  ).toBeVisible();
  await shot(page, info, "10-bulk-approved");
  await page.getByRole("button", { name: "Merge into Base", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/base/${base.slug}`));
  await expect(
    page.getByRole("heading", { name: "Customer import 000", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Customer import 000", exact: true }),
  ).toBeVisible();
  await shot(page, info, "11-merged-records-after-refresh");
  await page
    .getByRole("navigation", { name: "Breadcrumb" })
    .getByRole("link", { name: "Query load acceptance", exact: true })
    .click();
  await expect(page.getByRole("grid")).toBeVisible();
  await expect(
    page.getByRole("grid").getByText("Customer import 359", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("360 records", { exact: true })).toBeVisible();
  await shot(page, info, "12-merged-base-grid");
  const persisted = await json<{
    status: string;
    operations: Array<{ mergedRecordId: string | null }>;
  }>(await request.get(`/api/v1/change-requests/${cr.id}`));
  expect(persisted.status).toBe("merged");
  expect(persisted.operations).toHaveLength(360);
  expect(persisted.operations.every((item) => item.mergedRecordId)).toBe(true);
});
