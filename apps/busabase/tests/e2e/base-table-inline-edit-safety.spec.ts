import type { TestInfo } from "@playwright/test";
import type { BaseVO, RecordVO } from "busabase-contract/types";
import { type APIRequestContext, expect, json, type Page, test } from "./_fixtures";

test.setTimeout(180_000);
test.use({ video: "on", viewport: { width: 1440, height: 900 } });

async function fixture(request: APIRequestContext, label: string, sku = "ORIGINAL") {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const name = `Inline safety ${label} ${suffix}`;
  const base = await json<BaseVO>(
    await request.post("/api/v1/bases", {
      data: {
        name,
        slug: `inline-safety-${suffix}`,
        autoMerge: true,
        fields: [
          { slug: "title", name: "Title", type: "text", required: true },
          { slug: "price", name: "Price", type: "number" },
          { slug: "sku", name: "SKU", type: "text" },
          {
            slug: "status",
            name: "Status",
            type: "select",
            options: {
              choices: [
                { id: "chc_new", name: "New" },
                { id: "chc_live", name: "Live" },
              ],
            },
          },
          { slug: "checked", name: "Checked", type: "checkbox" },
          { slug: "launch", name: "Launch", type: "date" },
          { slug: "url", name: "URL", type: "url" },
          { slug: "email", name: "Email", type: "email" },
          { slug: "phone", name: "Phone", type: "phone" },
        ],
      },
    }),
  );
  const record = await json<RecordVO>(
    await request.post(`/api/v1/bases/${base.id}/change-requests`, {
      data: {
        autoMerge: true,
        message: "Create isolated inline-edit safety fixture",
        fields: {
          title: "Walking Robot Buddy",
          price: 24,
          sku,
          status: "chc_new",
          checked: false,
          launch: "2026-11-20",
          url: "https://example.com",
          email: "old@example.com",
          phone: "+1 555 0100",
        },
      },
    }),
  );
  return { base, record, name };
}

async function readRecord(request: APIRequestContext, recordId: string) {
  const result = await json<{ json: RecordVO }>(
    await request.post("/api/rpc/records/get", { data: { json: { recordId } } }),
  );
  return result.json;
}

const cell = (page: Page, recordId: string, slug: string) =>
  page.locator(`[data-grid-cell="${recordId}::${slug}"]`);

async function enterTable(page: Page, name: string) {
  await page.goto("/dashboard/local/home");
  await page.getByRole("link", { name, exact: true }).first().click();
  await expect(page.getByTestId("base-records-grid")).toBeVisible();
}

async function openEditor(page: Page, recordId: string, slug: string) {
  const target = cell(page, recordId, slug);
  await target.focus();
  await page.keyboard.press("Enter");
  const input = target.getByRole("textbox");
  await expect(input).toBeFocused();
  return input;
}

async function edit(page: Page, recordId: string, slug: string, value: string) {
  const input = await openEditor(page, recordId, slug);
  await input.fill(value);
  await input.press("Enter");
  await expect(cell(page, recordId, slug).getByRole("textbox")).toHaveCount(0);
  await expect(cell(page, recordId, slug)).toBeFocused();
}

async function shot(page: Page, info: TestInfo, name: string) {
  await page.screenshot({ path: info.outputPath(`${name}.png`), animations: "disabled" });
}

test("an owner still saves all eight inline field types and reads them after reload", async ({
  page,
  request,
}, info) => {
  const { name, record } = await fixture(request, "common fields");
  await enterTable(page, name);
  await shot(page, info, "01-enter-from-workspace");
  await edit(page, record.id, "price", "$1,299.50");
  await edit(page, record.id, "sku", "ROBOT-V2");
  await cell(page, record.id, "status").focus();
  await page.keyboard.press("Enter");
  await page.getByRole("option", { name: "Live", exact: true }).click();
  await expect(cell(page, record.id, "status")).toBeFocused();
  await cell(page, record.id, "checked").getByRole("checkbox").click();
  await cell(page, record.id, "launch").focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: /November 25th, 2026/ }).click();
  await expect(cell(page, record.id, "launch")).toBeFocused();
  await edit(page, record.id, "url", "https://example.org/new");
  await edit(page, record.id, "email", "new@example.org");
  await edit(page, record.id, "phone", "+86 138 0013 8000");
  const expected = {
    price: 1299.5,
    sku: "ROBOT-V2",
    status: "chc_live",
    checked: true,
    launch: "2026-11-25",
    url: "https://example.org/new",
    email: "new@example.org",
    phone: "+86 138 0013 8000",
  };
  await expect
    .poll(async () => (await readRecord(request, record.id)).headCommit.payload)
    .toMatchObject(expected);
  await page.reload();
  await expect(cell(page, record.id, "sku")).toContainText("ROBOT-V2");
  await expect(cell(page, record.id, "price")).toContainText("1299.5");
  await cell(page, record.id, "sku").focus();
  await shot(page, info, "02-eight-types-saved-and-reloaded");
});

test("a queued edit refuses a concurrent same-field change while the other field saves", async ({
  page,
  request,
}, info) => {
  const { name, record } = await fixture(request, "concurrent edits");
  await enterTable(page, name);
  const before = await readRecord(request, record.id);
  let release = () => {};
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  let paused = false;
  const writes: Array<{ fields: Record<string, unknown>; baseCommitId: string }> = [];
  const rejectedStatuses: number[] = [];
  page.on("response", (response) => {
    if (response.url().endsWith("/api/rpc/records/changeRequest") && response.status() === 409) {
      rejectedStatuses.push(response.status());
    }
  });
  await page.route("**/api/rpc/records/changeRequest", async (route) => {
    const input = route.request().postDataJSON().json;
    if (input.recordId !== record.id) return route.continue();
    writes.push(input);
    if (!paused && input.fields.price === 25) {
      paused = true;
      await barrier;
    }
    await route.continue();
  });
  try {
    await edit(page, record.id, "price", "25");
    await expect.poll(() => paused).toBe(true);
    await edit(page, record.id, "sku", "MY-SKU");
    const theirs = await json<RecordVO>(
      await request.post(`/api/v1/records/${record.id}/change-requests`, {
        data: {
          operation: "update",
          autoMerge: true,
          baseCommitId: before.headCommitId,
          fields: { sku: "THEIR-SKU" },
          message: "Concurrent client saves SKU before the queued edit",
        },
      }),
    );
    expect(theirs.headCommit.payload.sku).toBe("THEIR-SKU");
    release();
    await expect(page.getByTestId("inline-edit-notice")).toContainText(/Conflicting field: "sku"/);
    await expect
      .poll(async () => (await readRecord(request, record.id)).headCommit.payload)
      .toMatchObject({ price: 25, sku: "THEIR-SKU" });
    expect(writes).toHaveLength(2);
    expect(writes[1]?.baseCommitId).toBe(before.headCommitId);
    expect(rejectedStatuses).toEqual([409]);
    await info.attach("concurrent-edit-proof", {
      body: JSON.stringify(
        {
          openingHead: before.headCommitId,
          remoteHead: theirs.headCommitId,
          remoteSku: theirs.headCommit.payload.sku,
          queuedWrites: writes.map(({ fields, baseCommitId }) => ({ fields, baseCommitId })),
          rejectedStatuses,
          persistedFields: (await readRecord(request, record.id)).headCommit.payload,
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
    await cell(page, record.id, "sku").focus();
    await shot(page, info, "03-concurrent-sku-refused-price-kept");
    await page.reload();
    await expect(cell(page, record.id, "price")).toContainText("25");
    await expect(cell(page, record.id, "sku")).toContainText("THEIR-SKU");
    await shot(page, info, "04-concurrent-value-survives-reload");
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("one owner's queued edits to the same cell still save in order", async ({ page, request }) => {
  const { name, record } = await fixture(request, "same cell queue");
  await enterTable(page, name);
  let release = () => {};
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  let paused = false;
  await page.route("**/api/rpc/records/changeRequest", async (route) => {
    const input = route.request().postDataJSON().json;
    if (!paused && input.recordId === record.id && input.fields.sku === "FIRST") {
      paused = true;
      await barrier;
    }
    await route.continue();
  });
  try {
    await edit(page, record.id, "sku", "FIRST");
    await expect.poll(() => paused).toBe(true);
    await edit(page, record.id, "sku", "SECOND");
    await edit(page, record.id, "sku", "THIRD");
    release();
    await expect
      .poll(async () => (await readRecord(request, record.id)).headCommit.payload.sku)
      .toBe("THIRD");
    await expect(page.getByTestId("inline-edit-notice")).toHaveCount(0);
    await page.reload();
    await expect(cell(page, record.id, "sku")).toContainText("THIRD");
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("a refused draft survives another cell edit, can be corrected, and Esc cancels it", async ({
  page,
  request,
}, info) => {
  const { name, record } = await fixture(request, "recover draft");
  await enterTable(page, name);
  const price = await openEditor(page, record.id, "price");
  await price.fill("twelve");
  await price.press("Enter");
  await expect(cell(page, record.id, "price").getByRole("alert")).toBeVisible();
  await shot(page, info, "05-price-refused");
  await cell(page, record.id, "sku").dblclick();
  await cell(page, record.id, "sku").getByRole("textbox").fill("ROBOT-V2");
  await cell(page, record.id, "sku").getByRole("textbox").press("Enter");
  await expect
    .poll(async () => (await readRecord(request, record.id)).headCommit.payload.sku)
    .toBe("ROBOT-V2");
  const recovered = await openEditor(page, record.id, "price");
  await expect(recovered).toHaveValue("twelve");
  await expect(cell(page, record.id, "price").getByRole("alert")).toBeVisible();
  await shot(page, info, "06-price-draft-restored");
  await recovered.fill("26");
  await recovered.press("Enter");
  await expect
    .poll(async () => (await readRecord(request, record.id)).headCommit.payload.price)
    .toBe(26);
  const cancelled = await openEditor(page, record.id, "price");
  await cancelled.fill("not-a-number");
  await cancelled.press("Enter");
  await cancelled.press("Escape");
  const reopened = await openEditor(page, record.id, "price");
  await expect(reopened).toHaveValue("26");
  await reopened.press("Escape");
  await page.reload();
  await expect(cell(page, record.id, "price")).toContainText("26");
  await expect(cell(page, record.id, "sku")).toContainText("ROBOT-V2");
  await shot(page, info, "07-corrected-values-persist");
});

test("appending to text preserves existing LF, CRLF and mixed line endings", async ({
  page,
  request,
}, info) => {
  const roundTrips: Array<{ label: string; original: string; persisted: unknown }> = [];
  for (const [label, original] of [
    ["LF", "LINE1\nLINE2"],
    ["CRLF", "LINE1\r\nLINE2"],
    ["mixed", "LINE1\r\nLINE2\nLINE3\rLINE4"],
  ] as const) {
    const { name, record } = await fixture(request, `line endings ${label}`, original);
    await enterTable(page, name);
    const input = await openEditor(page, record.id, "sku");
    const visibleText = original.replace(/\r\n?/g, "\n");
    await expect(input).toHaveValue(visibleText);
    // Opening selects the value; Right collapses that selection to its end on every OS.
    await input.press("ArrowRight");
    await expect
      .poll(() =>
        input.evaluate((element: HTMLInputElement | HTMLTextAreaElement) => [
          element.selectionStart,
          element.selectionEnd,
        ]),
      )
      .toEqual([visibleText.length, visibleText.length]);
    await input.press("X");
    await shot(page, info, `08-${label}-text-during-edit`);
    await input.press("Enter");
    await expect
      .poll(async () => (await readRecord(request, record.id)).headCommit.payload.sku)
      .toBe(`${original}X`);
    await page.reload();
    const persisted = (await readRecord(request, record.id)).headCommit.payload.sku;
    expect(persisted).toBe(`${original}X`);
    roundTrips.push({ label, original, persisted });
    await expect(cell(page, record.id, "sku")).toContainText("LINE2");
    await cell(page, record.id, "sku").focus();
    await shot(page, info, `09-${label}-text-saved-and-reloaded`);
  }
  await info.attach("line-ending-round-trips", {
    body: JSON.stringify(roundTrips, null, 2),
    contentType: "application/json",
  });
});
