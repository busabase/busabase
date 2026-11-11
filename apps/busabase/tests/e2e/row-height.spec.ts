import { writeFile } from "node:fs/promises";
import type { APIRequestContext, Locator, Page, TestInfo } from "@playwright/test";
import type { BaseVO, ChangeRequestVO, FieldType, RecordVO, ViewVO } from "busabase-contract/types";
import sharp from "sharp";
import { expect, json, mergeOne, reviewOne, test } from "./_fixtures";
import { splitBatches } from "./helpers/split-batches";

// Real HTTP, database, storage, and the shipped dashboard. No seeded demo is required.
test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);
test.use({ viewport: { width: 1512, height: 982 }, video: "on" });

const presets = { short: 32, medium: 48, tall: 96, "extra-tall": 144 } as const;
type Preset = keyof typeof presets;
type Attachment = {
  id: string;
  assetId?: string;
  attachmentId: string;
  url: string;
  fileName: string;
  mimeType: string;
  size: number;
};
type Fixture = {
  base: BaseVO;
  row: RecordVO;
  archived: RecordVO;
  views: ViewVO[];
  large: BaseVO;
  largeView: ViewVO;
  files: Attachment[];
};
let fixture: Fixture;

async function upload(request: APIRequestContext, name: string, mime: string, bytes: Buffer) {
  const input = { fileName: name, mimeType: mime, sizeBytes: bytes.length, context: "row-height" };
  const issued = await json<{ uploadUrl: string; storageKey: string }>(
    await request.post("/api/v1/assets/upload-urls", { data: input }),
  );
  const put = await request.put(issued.uploadUrl, {
    data: bytes,
    headers: { "content-type": mime },
  });
  expect(put.ok(), await put.text()).toBe(true);
  const result = await json<{
    assetId?: string;
    attachmentId: string;
    publicUrl: string;
  }>(
    await request.post("/api/v1/assets/confirmations", {
      data: { ...input, storageKey: issued.storageKey },
    }),
  );
  return {
    id: result.assetId ?? result.attachmentId,
    assetId: result.assetId,
    attachmentId: result.attachmentId,
    url: result.publicUrl,
    fileName: name,
    mimeType: mime,
    size: bytes.length,
  };
}

async function createRow(
  request: APIRequestContext,
  baseId: string,
  fields: Record<string, unknown>,
) {
  return json<RecordVO>(
    await request.post(`/api/v1/bases/${baseId}/change-requests`, {
      data: { autoMerge: true, fields, submittedBy: "row-height-e2e" },
    }),
  );
}

async function createFixture(request: APIRequestContext): Promise<Fixture> {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const png = await sharp({
    create: { width: 600, height: 400, channels: 3, background: "#2563eb" },
  })
    .png()
    .toBuffer();
  const files = await Promise.all([
    upload(request, "blue-reference.png", "image/png", png),
    upload(
      request,
      "review-notes.txt",
      "text/plain",
      Buffer.from("Complete file preview.\nSecond line."),
    ),
  ]);
  const target = await json<BaseVO>(
    await request.post("/api/v1/bases", {
      data: {
        autoMerge: true,
        name: `Row height sources ${suffix}`,
        slug: `height-sources-${suffix}`,
        fields: [
          { slug: "title", name: "Source", type: "text", required: true },
          { slug: "files", name: "Source files", type: "attachment" },
        ],
      },
    }),
  );
  const related = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      createRow(request, target.id, {
        title: `Source ${index + 1}: review evidence`,
        files: [files[index % files.length]],
      }),
    ),
  );
  const choices = Array.from({ length: 12 }, (_, i) => ({
    id: `choice-${i}`,
    name: `Review label ${i + 1}`,
    color: "blue",
  }));
  const types: FieldType[] = [
    "text",
    "longtext",
    "markdown",
    "html",
    "code",
    "json",
    "yaml",
    "whiteboard",
    "attachment",
    "drive",
    "relation",
    "member",
    "lookup",
    "number",
    "formula",
    "date",
    "checkbox",
    "select",
    "multiselect",
    "url",
    "embed",
    "email",
    "phone",
    "created_time",
    "updated_time",
    "created_by",
    "updated_by",
    "auto_number",
    "ai_summary",
    "ai_tags",
  ];
  const base = await json<BaseVO>(
    await request.post("/api/v1/bases", {
      data: {
        autoMerge: true,
        name: `Row height review ${suffix}`,
        slug: `height-review-${suffix}`,
        fields: types.map((type) => ({
          slug: type,
          name: type.replaceAll("_", " "),
          type,
          required: type === "text",
          options:
            type === "select" || type === "multiselect"
              ? { choices }
              : type === "relation"
                ? { targetBaseId: target.id, multiple: true }
                : type === "lookup"
                  ? {
                      lookup: {
                        relationFieldSlug: "relation",
                        targetFieldSlug: "files",
                        rollup: "values",
                      },
                    }
                  : type === "formula"
                    ? { formula: { expression: "{number} * 2" } }
                    : type === "date"
                      ? { date: { includeTime: true, timeZone: "UTC" } }
                      : {},
        })),
      },
    }),
  );
  const prose =
    "First line: review the customer's requirements.\n第二行：确认数据展示完整。\nThird line: keep every value recoverable.\nFourth line: compare the source.";
  const row = await createRow(request, base.id, {
    text: "Density review: complete field coverage",
    longtext: prose,
    markdown: `# Review notes\n\n${prose}`,
    html: "<p>Safe HTML preview</p><p>Second paragraph with readable content.</p>",
    code: "function review(record) {\n  return record.status;\n}\n// Preserve source lines",
    json: '{"review": true,\n"items": ["alpha", "beta"],\n"note": "Structured preview"}',
    yaml: "review: true\nitems:\n  - alpha\n  - beta\nnote: Preserve lines",
    whiteboard: {
      scene: { version: 1, elements: [], appState: {} },
      previewSvg:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 120"><rect x="8" y="8" width="224" height="104" fill="#dbeafe"/><text x="24" y="66" fill="#1e3a8a" font-size="20">Review complete</text></svg>',
    },
    attachment: Array.from({ length: 8 }, (_, i) => ({
      ...files[i % 2],
      fileName: `${i + 1}-${files[i % 2]?.fileName}`,
    })),
    drive: files.map((file) => ({ ...file, path: `review/${file.fileName}` })),
    relation: related.map((r) => r.id),
    member: Array.from({ length: 8 }, (_, i) => `former-reviewer-${i}`),
    number: 1234.5,
    date: "2026-11-10T08:30:00.000Z",
    checkbox: true,
    select: choices[0]?.id,
    multiselect: choices.map((choice) => choice.id),
    url: "https://example.com/review?preserve=destination",
    embed: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    email: "reviewer@example.com",
    phone: "+1 555 123 4567",
    ai_summary: prose,
    ai_tags: Array.from({ length: 12 }, (_, i) => `Generated tag ${i + 1}`),
  });
  await createRow(request, base.id, { text: "Empty optional cells remain readable" });
  const archived = await createRow(request, base.id, {
    text: "Archived review remains recoverable",
  });
  await json<RecordVO>(
    await request.post(`/api/v1/records/${archived.id}/change-requests`, {
      data: { operation: "delete", autoMerge: true },
    }),
  );
  const views = await Promise.all(
    ["All fields", "Text and sources"].map(async (name, i) =>
      json<ViewVO>(
        await request.post("/api/v1/views/change-requests", {
          data: {
            operation: "create",
            baseId: base.id,
            autoMerge: true,
            name,
            slug: `density-${i}`,
            config: {
              filters: [],
              sorts: [{ fieldSlug: "text", direction: "desc" }],
              fieldWidths: Object.fromEntries(base.fields.map((f) => [f.slug, 240])),
            },
          },
        }),
      ),
    ),
  );
  const large = await json<BaseVO>(
    await request.post("/api/v1/bases", {
      data: {
        autoMerge: true,
        name: `Large density table ${suffix}`,
        slug: `height-large-${suffix}`,
        fields: [
          { slug: "title", name: "Title", type: "text", required: true },
          { slug: "notes", name: "Notes", type: "text" },
          { slug: "done", name: "Done", type: "checkbox" },
        ],
      },
    }),
  );
  await json<ChangeRequestVO>(
    await request.post(`/api/v1/bases/${large.id}/records/bulk-change-request`, {
      data: {
        autoMerge: true,
        records: Array.from({ length: 130 }, (_, i) => ({
          title: `Review record ${String(i + 1).padStart(3, "0")}`,
          notes: prose,
          done: false,
        })),
      },
    }),
  );
  const largeView = await json<ViewVO>(
    await request.post("/api/v1/views/change-requests", {
      data: {
        operation: "create",
        baseId: large.id,
        autoMerge: true,
        name: "Dense review",
        slug: "dense-review",
        config: {
          filters: [],
          sorts: [{ fieldSlug: "title", direction: "asc" }],
          fieldWidths: { title: 480, notes: 640, done: 320 },
        },
      },
    }),
  );
  return { base, row, archived, views, large, largeView, files };
}

async function beat(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  await info.attach(name, { path, contentType: "image/png" });
}

async function chooseHeight(page: Page, preset: Preset) {
  const control = page.getByTestId("row-height-control");
  await control.focus();
  await control.press("Enter");
  const option = page.getByTestId(`row-height-option-${preset}`);
  await option.focus();
  await option.press("Space");
  await expect(option).toBeChecked();
  const apply = page.getByRole("button", { name: "Apply", exact: true });
  await apply.focus();
  await apply.press("Enter");
  await expect(page.getByTestId("base-records-grid")).toHaveAttribute("data-row-height", preset);
}

async function assertCellBounds(cell: Locator, pixels: number, type: string) {
  await expect(async () => {
    await expect(cell, type).toBeVisible();
    await cell.scrollIntoViewIfNeeded();
  }).toPass({ timeout: 15_000 });
  const result = await cell.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const row = element.closest("[data-record-id]")?.getBoundingClientRect();
    const controls = Array.from(
      element.querySelectorAll<HTMLElement>("a,button,input,img,[data-grid-cell-text]"),
    )
      .filter(
        (item) =>
          !item.closest("[hidden], [aria-hidden=true]") && item.getBoundingClientRect().width > 0,
      )
      .map((item) => ({
        box: item.getBoundingClientRect(),
        name: item.getAttribute("aria-label") ?? item.tagName,
      }));
    return {
      height: row?.height,
      clipped: controls
        .filter(({ box: r }) => r.top < box.top - 1 || r.bottom > box.bottom + 1)
        .map(({ name }) => name),
    };
  });
  expect(result.height, type).toBe(pixels);
  expect(result.clipped, `${type} controls must fit vertically`).toEqual([]);
}

test.beforeAll(async ({ request }) => {
  fixture = await createFixture(request);
});

test("reviewer reads all 30 column types at four saved heights and returns from full previews", async ({
  page,
  request,
}, info) => {
  await page.goto("/dashboard/local/home");
  const entry = page.getByRole("link", { name: fixture.base.name, exact: true }).first();
  // The first browser RPC route can still be compiling on a cold dev server.
  await expect(entry).toBeVisible({ timeout: 60_000 });
  const activity = page.locator('[data-home-section="activity"]');
  await expect(activity).toBeVisible();
  await expect(activity.locator(".bg-gradient-to-r")).toHaveCount(0);
  await beat(page, info, "01-enter-workspace");
  await entry.click();
  await page.locator(`a[href$="/${fixture.views[0]?.slug}"]`).click();
  const grid = page.getByTestId("base-records-grid");
  await expect(grid).toHaveAttribute("data-row-height", "medium");
  const row = grid.locator(`[data-record-id="${fixture.row.id}"]`);
  await expect(row).toBeVisible();
  const coverage: { type: string; preset: Preset; pixels: number }[] = [];
  for (const [preset, pixels] of Object.entries(presets) as [Preset, number][]) {
    await chooseHeight(page, preset);
    if (preset === "short") {
      await page.getByTestId("active-view-actions").click();
      await page.getByTestId("archived-records-menu-item").click();
    }
    const archived = grid.locator(`[data-record-id="${fixture.archived.id}"]`);
    await expect(archived).toBeVisible();
    await expect
      .poll(() => archived.evaluate((element) => element.getBoundingClientRect().height))
      .toBe(pixels);
    for (const field of fixture.base.fields) {
      await assertCellBounds(row.locator(`[data-cell-field="${field.slug}"]`), pixels, field.type);
      const cell = row.locator(`[data-cell-field="${field.slug}"]`);
      if (field.type !== "whiteboard" && field.type !== "checkbox") {
        await expect(
          cell,
          `${field.type} must display its fixture value or recovery action`,
        ).not.toHaveText(/^\s*-\s*$/);
      }
      if (field.type === "attachment" || field.type === "drive") {
        await expect(cell.locator("[data-attachment-count]")).toHaveAttribute(
          "data-attachment-count",
          field.type === "drive" ? "2" : "8",
        );
      }
      if (field.type === "lookup") {
        await expect(cell.locator("[data-attachment-count]")).toHaveAttribute(
          "data-attachment-count",
          "8",
        );
      }
      if (field.type === "checkbox") {
        await expect(cell.getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
      }
      if (field.type === "whiteboard") {
        await expect(cell.locator("svg")).toHaveCount(1);
      }
      coverage.push({ type: field.type, preset, pixels });
    }
    await row.locator('[data-cell-field="longtext"]').scrollIntoViewIfNeeded();
    await beat(page, info, `02-${preset}-read-text`);
  }
  expect(new Set(coverage.map((item) => item.type)).size).toBe(30);
  expect(coverage).toHaveLength(120);
  await writeFile(info.outputPath("field-height-coverage.json"), JSON.stringify(coverage, null, 2));
  await info.attach("120 real cell checks", {
    path: info.outputPath("field-height-coverage.json"),
    contentType: "application/json",
  });
  const links = [
    ["url", "https://example.com/review?preserve=destination"],
    ["email", "mailto:reviewer@example.com"],
    ["phone", "tel:+1 555 123 4567"],
  ];
  await expect(row.locator('[data-cell-field="formula"]')).toContainText(/2[,\s]?469/);
  await expect(row.locator('[data-cell-field="longtext"]')).toContainText(
    "第二行：确认数据展示完整",
  );
  for (const [slug, href] of links) {
    await expect(row.locator(`[data-cell-field="${slug}"] a`).first()).toHaveAttribute(
      "href",
      href ?? "",
    );
  }
  const attachment = row.locator('[data-cell-field="attachment"]');
  await attachment.scrollIntoViewIfNeeded();
  await attachment.locator("[data-attachment-overflow]").click();
  const expanded = page.getByTestId("attachment-cell-expanded");
  await expect(expanded).toBeVisible();
  await expect(expanded.locator("[data-attachment-cell-item]")).toHaveCount(8);
  await beat(page, info, "03-recover-all-attachments");
  await expanded.locator("[data-attachment-cell-item]").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.locator("[data-attachment-index='7']").click();
  await expect(page.getByRole("dialog")).toContainText("8-review-notes.txt");
  await beat(page, info, "04-open-final-attachment");
  await page.keyboard.press("Escape");
  await attachment.scrollIntoViewIfNeeded();
  await row.locator('[data-cell-field="lookup"]').scrollIntoViewIfNeeded();
  await row.getByTestId("lookup-sources-lookup").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await beat(page, info, "04-inspect-lookup-sources");
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(grid).toHaveAttribute("data-row-height", "extra-tall");
  await page.locator(`a[href$="/${fixture.views[1]?.slug}"]`).click();
  await expect(grid).toHaveAttribute("data-row-height", "medium");
  const saved = await json<ViewVO[]>(await request.get(`/api/v1/bases/${fixture.base.id}/views`));
  expect(saved.find((v) => v.id === fixture.views[0]?.id)?.config.rowHeight).toBe("extra-tall");
  expect(saved.find((v) => v.id === fixture.views[1]?.id)?.config.rowHeight).toBeUndefined();
  await beat(page, info, "05-independent-view-default");
});

test("a failed height update can retry and a reviewed update waits for merge", async ({
  page,
  request,
}, info) => {
  const view = fixture.views[1];
  if (!view) throw new Error("Expected second view");
  await splitBatches(page);
  await page.goto(`/dashboard/local/base/${fixture.base.slug}/${view.slug}`);
  await page.route(
    "**/api/rpc/views/changeRequest",
    async (route) => {
      await route.fulfill({ status: 500, body: '{"message":"Injected save failure"}' });
    },
    { times: 1 },
  );
  await page.getByTestId("row-height-control").click();
  await page.getByTestId("row-height-option-tall").check();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await expect(page.getByTestId("base-records-grid")).toHaveAttribute("data-row-height", "medium");
  await beat(page, info, "01-failed-save-retains-height");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByTestId("base-records-grid")).toHaveAttribute("data-row-height", "tall");
  await page.getByTestId("row-height-control").click();
  await page.getByTestId("row-height-option-short").check();
  await page.getByRole("button", { name: /more submit options/i }).click();
  const response = page.waitForResponse(
    (r) => r.url().includes("/views/changeRequest") && r.request().method() === "POST",
  );
  await page.getByRole("menuitem", { name: /submit for review/i }).click();
  const pending = (await (await response).json()).json as ChangeRequestVO;
  await expect(
    page.getByRole("status").filter({ hasText: "Row height submitted for review." }),
  ).toBeVisible();
  await expect(page.getByTestId("base-records-grid")).toHaveAttribute("data-row-height", "tall");
  await beat(page, info, "02-review-pending-keeps-saved-density");
  await reviewOne(request, pending.id, "approved");
  await mergeOne(request, pending.id);
  await page.reload();
  await expect(page.getByTestId("base-records-grid")).toHaveAttribute("data-row-height", "short");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("row-height-control")).toBeVisible();
  await chooseHeight(page, "tall");
  await page.getByTestId("view-control-toolbar").evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  await page.getByTestId("row-height-control").click();
  await expect(page.getByRole("radio", { name: "Tall", exact: true })).toBeChecked();
  await beat(page, info, "03-narrow-viewport-picker");
  await page.keyboard.press("Escape");
  await beat(page, info, "03-narrow-viewport-density");
});

test("large tables remeasure virtual rows and preserve sticky selection and inline edits", async ({
  page,
  request,
}, info) => {
  await page.goto(
    `/dashboard/local/base/${fixture.large.slug}/${fixture.largeView.slug}?recordPageSize=100`,
  );
  const grid = page.getByTestId("base-records-grid");
  await expect(grid.locator("[data-record-id]").first()).toBeVisible();
  for (const preset of ["short", "tall", "extra-tall", "medium"] as const) {
    await chooseHeight(page, preset);
    const scroll = page.locator("[data-base-detail-scroll]").first();
    const viewport = (await scroll.count()) ? scroll : page.locator("main").first();
    await viewport.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(grid.getByText("Review record 100", { exact: true })).toBeVisible();
    const offsets = await grid
      .locator("[data-record-id]")
      .evaluateAll((rows) =>
        rows.map((r) => ({ y: r.getBoundingClientRect().y, h: r.getBoundingClientRect().height })),
      );
    for (let i = 1; i < offsets.length; i++) {
      expect(
        Math.abs((offsets[i]?.y ?? 0) - (offsets[i - 1]?.y ?? 0) - presets[preset]),
      ).toBeLessThanOrEqual(1);
    }
    expect(offsets.every((r) => r.h === presets[preset])).toBe(true);
    await viewport.evaluate((element) => {
      element.scrollTop = 0;
    });
  }
  await beat(page, info, "01-virtual-rows-remeasured");
  const viewport = page.locator("[data-base-detail-scroll]");
  await chooseHeight(page, "extra-tall");
  await viewport.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(grid.getByText("Review record 100", { exact: true })).toBeVisible();
  const anchor = await grid.locator("[data-record-id]").evaluateAll((rows) => {
    const viewport = rows[0]?.closest("[data-base-detail-scroll]")?.getBoundingClientRect();
    return rows
      .find((row) => row.getBoundingClientRect().bottom > (viewport?.top ?? 0))
      ?.getAttribute("data-record-id");
  });
  expect(anchor).toBeTruthy();
  // A collaborator changes the shared density while this reader is at the end.
  await json<ViewVO>(
    await request.post("/api/v1/views/change-requests", {
      data: {
        operation: "update",
        viewId: fixture.largeView.id,
        autoMerge: true,
        config: { rowHeight: "short" },
      },
    }),
  );
  await expect(grid).toHaveAttribute("data-row-height", "short", { timeout: 30_000 });
  await expect(grid.locator(`[data-record-id="${anchor}"]`)).toBeInViewport();
  await expect(grid.getByText("Review record 100", { exact: true })).toBeVisible();
  await beat(page, info, "02-bottom-shrink-keeps-record-in-view");
  await viewport.evaluate((element) => {
    element.scrollTop = 0;
  });
  // Wait for virtual rows to catch up, then keep every edit tied to this record.
  const first = grid
    .locator("[data-record-id]")
    .filter({ has: page.getByText("Review record 001", { exact: true }) });
  await expect(first).toBeVisible();
  const firstId = await first.getAttribute("data-record-id");
  await first.getByTestId("base-record-select").check();
  const primary = first.locator('[data-cell-field="title"]');
  const frozenX = await primary.evaluate((element) => element.getBoundingClientRect().x);
  const select = first.getByTestId("base-record-select");
  const selectX = await select.evaluate((element) => element.getBoundingClientRect().x);
  await page.locator("[data-base-table-scroll]").evaluate((element) => {
    element.scrollLeft = 500;
  });
  await expect
    .poll(() =>
      primary.evaluate((element, x) => Math.abs(element.getBoundingClientRect().x - x), frozenX),
    )
    .toBeLessThanOrEqual(1);
  await expect
    .poll(() =>
      select.evaluate((element, x) => Math.abs(element.getBoundingClientRect().x - x), selectX),
    )
    .toBeLessThanOrEqual(1);
  const cell = first.locator('[data-cell-field="notes"]');
  await cell.dblclick();
  const editor = page.locator("[data-inline-cell-editor] textarea");
  const editorBounds = await editor.boundingBox();
  const cellBounds = await cell.boundingBox();
  expect(editorBounds).not.toBeNull();
  expect(cellBounds).not.toBeNull();
  expect((editorBounds?.y ?? 0) - (cellBounds?.y ?? 0)).toBeGreaterThanOrEqual(-1);
  expect(
    (editorBounds?.y ?? 0) +
      (editorBounds?.height ?? 0) -
      (cellBounds?.y ?? 0) -
      (cellBounds?.height ?? 0),
  ).toBeLessThanOrEqual(1);
  await editor.fill("Edited after density changes\nSecond persisted line.");
  await editor.press("Control+Enter");
  await expect(editor).toBeHidden();
  await expect
    .poll(async () => {
      const saved = await json<RecordVO>(
        await request.get(`/api/v1/records/get?recordId=${firstId}`),
      );
      return saved.headCommit.payload.notes;
    })
    .toBe("Edited after density changes\nSecond persisted line.");
  await page.reload();
  await expect(
    grid.locator("[data-record-id]").first().locator('[data-cell-field="notes"]'),
  ).toContainText("Edited after density changes");
  await beat(page, info, "03-inline-edit-persists");
  await page.getByRole("link", { name: "Go to next page", exact: true }).click();
  await expect(page).toHaveURL(/recordPage=2/);
  await expect(grid.getByText("Review record 130", { exact: true })).toHaveCount(1);
  await viewport.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(grid.getByText("Review record 130", { exact: true })).toBeVisible();
  await beat(page, info, "04-final-record-remains-reachable");
});
