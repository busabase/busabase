import { readFile } from "node:fs/promises";
import type { Locator, Page } from "@playwright/test";
import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import type { BaseVO, RecordVO } from "busabase-contract/types";
import { expect, json, test } from "./_fixtures";

// Deliberately uses stored uploads and the real table, rather than a component
// gallery: the same icons must survive list serialization and record expansion.
test("recognize stored file types, resize rows, and open the same attachment", async ({
  page,
  request,
}, info) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(25_000);
  test.skip(Boolean(info.project.metadata.desktopShell), "This story enters the OSS workspace");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const zip = new ZipWriter(new Uint8ArrayWriter());
  await zip.add("notes.txt", new TextReader("Stored attachment acceptance fixture"));
  const archive = Buffer.from(await zip.close());
  const imageBytes = await readFile("public/assets/readme/scenarios/blog-cms-base.png");
  const cases = [
    {
      name: "Revenue.xlsx",
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      kind: "spreadsheet",
      bytes: archive,
    },
    {
      name: "Brief.docx",
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      kind: "document",
      bytes: archive,
    },
    {
      name: "Pitch.pptx",
      mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      kind: "presentation",
      bytes: archive,
    },
    {
      name: "Report.pdf",
      mime: "application/pdf",
      kind: "pdf",
      bytes: Buffer.from("%PDF-1.4\n%%EOF"),
    },
    {
      name: "Data.JSON",
      mime: "application/octet-stream",
      kind: "json",
      bytes: Buffer.from('{"verified":true}'),
    },
    {
      name: "Readme.MD",
      mime: "text/plain",
      kind: "markdown",
      bytes: Buffer.from("# Attachment notes"),
    },
    {
      name: "Forecast.csv",
      mime: "text/csv",
      kind: "spreadsheet",
      bytes: Buffer.from("quarter,revenue\nQ1,123"),
    },
    { name: "Sources.zip", mime: "application/zip", kind: "archive", bytes: archive },
    {
      name: "Widget.tsx",
      mime: "text/plain",
      kind: "code",
      bytes: Buffer.from("export const value = 42;"),
    },
    { name: "Notes.txt", mime: "text/plain", kind: "text", bytes: Buffer.from("Meeting notes") },
    {
      name: "Settings.yaml",
      mime: "text/plain",
      kind: "config",
      bytes: Buffer.from("project: attachments\n"),
    },
    {
      name: "Recording.wav",
      mime: "audio/wav",
      kind: "audio",
      bytes: Buffer.from("Audio attachment icon fixture"),
    },
    {
      name: "Walkthrough.webm",
      mime: "video/webm",
      kind: "video",
      bytes: Buffer.from("Video attachment icon fixture"),
    },
    {
      name: "Image-reference.png",
      mime: "application/octet-stream",
      kind: "image",
      bytes: imageBytes,
    },
    {
      name: "Unknown.custom",
      mime: "application/octet-stream",
      kind: "file",
      bytes: Buffer.from("Unknown format"),
    },
    {
      name: "Image.png",
      mime: "image/png",
      kind: "image",
      bytes: imageBytes,
    },
  ];
  const files = [];
  for (const item of cases) {
    const input = { fileName: item.name, mimeType: item.mime, sizeBytes: item.bytes.length };
    const upload = await json<{ storageKey: string; uploadUrl: string }>(
      await request.post("/api/v1/assets/upload-urls", { data: input }),
    );
    expect(
      (
        await request.put(upload.uploadUrl, {
          data: item.bytes,
          headers: { "content-type": item.mime },
        })
      ).ok(),
    ).toBe(true);
    const saved = await json<{ attachmentId: string; publicUrl: string }>(
      await request.post("/api/v1/assets/confirmations", {
        data: { ...input, storageKey: upload.storageKey },
      }),
    );
    files.push({
      attachmentId: saved.attachmentId,
      fileName: item.name,
      mimeType: item.mime,
      size: item.bytes.length,
      url: saved.publicUrl,
    });
  }
  const slug = `file-types-${Date.now()}`;
  const name = `Project files ${Date.now().toString().slice(-4)}`;
  const base = await json<BaseVO>(
    await request.post("/api/v1/bases", {
      data: {
        autoMerge: true,
        name,
        slug,
        fields: [
          { name: "File", slug: "title", type: "text", required: true },
          { name: "Attachments", slug: "files", type: "attachment" },
        ],
      },
    }),
  );
  const rows: RecordVO[] = [];
  for (const [index, file] of files.entries()) {
    rows.push(
      await json<RecordVO>(
        await request.post(`/api/v1/bases/${base.id}/change-requests`, {
          data: {
            autoMerge: true,
            fields: {
              title: `${String(index + 1).padStart(2, "0")} ${file.fileName}`,
              files: [file],
            },
            submittedBy: "file-icon-acceptance",
          },
        }),
      ),
    );
  }
  const bundle = await json<RecordVO>(
    await request.post(`/api/v1/bases/${base.id}/change-requests`, {
      data: {
        autoMerge: true,
        fields: { title: "00 Project bundle", files: files.slice(0, 10) },
        submittedBy: "file-icon-acceptance",
      },
    }),
  );
  await json(
    await request.post("/api/v1/views/change-requests", {
      data: {
        operation: "create",
        baseId: base.id,
        autoMerge: true,
        name: "File library",
        slug: "file-library",
        config: {
          sorts: [{ fieldSlug: "title", direction: "asc" }],
          fieldWidths: { title: 270, files: 240 },
        },
      },
    }),
  );

  await page.goto("/dashboard/local");
  await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("01-workspace-entry.png") });
  await page.getByRole("link", { name, exact: true }).click();
  const grid = page.getByTestId("base-records-grid");
  await expect(grid).toBeVisible();
  await page
    .getByTestId("base-view-tabs")
    .getByRole("link", { name: "File library", exact: true })
    .click();
  const cell = (row: RecordVO) =>
    grid.locator(`[data-record-id="${row.id}"] [data-attachment-preview]`);
  const rowAt = (index: number) => {
    const row = rows[index];
    if (!row) throw new Error(`Missing uploaded file row ${index}`);
    return row;
  };
  const fileAt = (index: number) => {
    const item = cases[index];
    if (!item) throw new Error(`Missing uploaded file fixture ${index}`);
    return item;
  };
  const palette = new Map<string, string>();
  for (const [index, item] of cases.entries()) {
    const target = cell(rowAt(index));
    await target.scrollIntoViewIfNeeded();
    const link = target.getByRole("link", { name: item.name, exact: true });
    await expect(link).toBeVisible();
    if (item.mime.startsWith("image/")) {
      await expect(link.locator("img")).toBeVisible();
      expect(
        await link
          .locator("img")
          .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
      ).toBe(true);
    } else {
      await expect(link.locator("[data-attachment-file-kind]")).toHaveAttribute(
        "data-attachment-file-kind",
        item.kind,
      );
      const color = await fileColor(link);
      expect(
        whiteContrast(color),
        `${item.name}: the white symbol must contrast with its file color`,
      ).toBeGreaterThanOrEqual(3);
      if (palette.has(item.kind)) expect(color).toBe(palette.get(item.kind));
      palette.set(item.kind, color);
      await expectContentsInside(link);
    }
  }
  expect(palette.size).toBe(14);
  expect(
    new Set(palette.values()).size,
    "File families need a varied palette",
  ).toBeGreaterThanOrEqual(10);
  const green = rgb(palette.get("spreadsheet") ?? "");
  expect(green[1]).toBeGreaterThan(green[0]);
  expect(green[1]).toBeGreaterThan(green[2]);
  await info.attach("file-type-palette", {
    body: JSON.stringify(Object.fromEntries(palette)),
    contentType: "application/json",
  });
  await cell(rowAt(0)).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("02-distinct-file-types-light.png") });

  for (const preset of ["short", "medium", "tall", "extra-tall"] as const) {
    await chooseHeight(page, preset);
    // JSON and Markdown reproduce the two originally clipped labels.
    for (const index of [4, 5]) {
      const target = cell(rowAt(index)).getByRole("link", {
        name: fileAt(index).name,
        exact: true,
      });
      await target.scrollIntoViewIfNeeded();
      await expectContentsInside(target);
      await expect(target.locator("[data-attachment-file-kind]")).toBeVisible();
    }
    if (preset === "tall" || preset === "extra-tall") {
      const spreadsheet = cell(rowAt(0)).getByRole("link", { name: "Revenue.xlsx", exact: true });
      await spreadsheet.scrollIntoViewIfNeeded();
      const box = await spreadsheet.boundingBox();
      const art = await spreadsheet.locator("[data-attachment-file-kind]").boundingBox();
      expect(box).not.toBeNull();
      expect(art).not.toBeNull();
      expect(
        art?.height ?? 0,
        "Tall rows must use a substantial colored file illustration",
      ).toBeGreaterThan((box?.height ?? 0) * 0.5);
      await expectContentsInside(spreadsheet);
    }
    if (preset === "medium" || preset === "extra-tall") {
      await page.screenshot({ path: info.outputPath(`03-${preset}-row-height.png`) });
    }
  }
  await chooseHeight(page, "medium");
  await page.evaluate(() => {
    localStorage.setItem("theme", "dark");
  });
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(cell(rowAt(4)).locator("[data-attachment-file-kind]")).toHaveAttribute(
    "data-attachment-file-kind",
    "json",
  );
  for (const [index, item] of cases.entries()) {
    if (item.mime.startsWith("image/")) continue;
    const target = cell(rowAt(index)).getByRole("link", { name: item.name, exact: true });
    await target.scrollIntoViewIfNeeded();
    expect(
      await fileColor(target),
      `${item.name}: file identity colors should survive dark mode`,
    ).toBe(palette.get(item.kind));
  }
  await cell(rowAt(0)).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("04-distinct-file-types-dark.png") });

  const bundleCell = cell(bundle);
  await bundleCell.scrollIntoViewIfNeeded();
  await bundleCell.locator("[data-attachment-expand]").click();
  const expanded = page.getByTestId("attachment-cell-expanded");
  await expect(expanded.locator("[data-attachment-cell-item]")).toHaveCount(10);
  for (const item of cases.slice(0, 10)) {
    await expect(
      expanded
        .getByRole("button", { name: item.name, exact: true })
        .locator("[data-attachment-file-kind]"),
    ).toHaveAttribute("data-attachment-file-kind", item.kind);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => {
      const box = await expanded.boundingBox();
      return Boolean(box && box.x >= 0 && box.x + box.width <= 390);
    })
    .toBe(true);
  await page.screenshot({ path: info.outputPath("05-expanded-types-phone.png") });
  await page.setViewportSize({ width: 1500, height: 1000 });
  await expanded.getByRole("button", { name: "Data.JSON", exact: true }).click();
  const preview = page.getByTestId("attachment-preview-dialog");
  await expect(preview.getByRole("heading", { name: "Data.JSON", exact: true })).toBeVisible();
  for (const [index, item] of cases.slice(0, 10).entries()) {
    const option = preview.locator(`[data-attachment-index="${index}"]`);
    await expect(option.locator("[data-attachment-file-kind]")).toHaveAttribute(
      "data-attachment-file-kind",
      item.kind,
    );
  }
  const original = await preview
    .getByRole("link", { name: "Open in new tab", exact: true })
    .getAttribute("href");
  expect(original).toBeTruthy();
  if (!original) throw new Error("The preview must retain the original file link");
  expect((await (await request.get(original)).body()).equals(fileAt(4).bytes)).toBe(true);
  await page.screenshot({ path: info.outputPath("06-preview-and-file-switcher.png") });
  await preview.getByRole("button", { name: "Readme.MD", exact: true }).click();
  await expect(preview.getByTestId("attachment-markdown-preview")).toContainText(
    "Attachment notes",
  );
  await expect(
    preview
      .getByRole("button", { name: "Readme.MD", exact: true })
      .locator("[data-attachment-file-kind]"),
  ).toHaveAttribute("data-attachment-file-kind", "markdown");
  await page.screenshot({ path: info.outputPath("06-markdown-preview-with-type-icons.png") });
  await page.keyboard.press("Escape");
  await expect(bundleCell.locator("[data-attachment-expand]")).toBeFocused();
  await grid.getByRole("link", { name: "00 Project bundle", exact: true }).click();
  const detail = page.getByTestId("record-detail-dialog");
  const detailFiles = detail.locator("[data-attachment-preview]");
  await expect(detailFiles.locator("a")).toHaveCount(10);
  await expect(
    detailFiles
      .getByRole("link", { name: "Readme.MD", exact: true })
      .locator("[data-attachment-file-kind]"),
  ).toHaveAttribute("data-attachment-file-kind", "markdown");
  await page.screenshot({ path: info.outputPath("07-record-detail-types.png") });
  expect(errors).toEqual([]);
});

async function chooseHeight(page: Page, preset: string) {
  const control = page.getByTestId("row-height-control");
  await control.evaluate((element) => element.scrollIntoView({ block: "center" }));
  await control.focus();
  await control.press("Enter");
  const option = page.getByTestId(`row-height-option-${preset}`);
  await option.focus();
  await option.press("Space");
  const apply = page.getByRole("button", { name: "Apply", exact: true });
  await apply.focus();
  await apply.press("Enter");
  await expect(page.getByTestId("base-records-grid")).toHaveAttribute("data-row-height", preset);
}

async function expectContentsInside(link: Locator) {
  const clipped = await link.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return Array.from(element.querySelectorAll("svg, [data-attachment-extension]")).some(
      (child) => {
        const box = child.getBoundingClientRect();
        return (
          box.top < bounds.top ||
          box.bottom > bounds.bottom ||
          box.left < bounds.left ||
          box.right > bounds.right
        );
      },
    );
  });
  expect(clipped, "The type icon and extension must fit their tile").toBe(false);
}

async function fileColor(link: Locator) {
  return link
    .locator("[data-attachment-file-sheet]")
    .evaluate((element) => getComputedStyle(element).fill);
}

function rgb(color: string): [number, number, number] {
  const values = color.match(/[\d.]+/g)?.map(Number);
  if (!values || values.length < 3) throw new Error(`Expected a resolved RGB file color: ${color}`);
  return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0];
}

function whiteContrast(color: string) {
  const [red, green, blue] = rgb(color).map((channel) => {
    const s = channel / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const luminance = (red ?? 0) * 0.2126 + (green ?? 0) * 0.7152 + (blue ?? 0) * 0.0722;
  return 1.05 / (luminance + 0.05);
}
