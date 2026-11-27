import type { BaseVO, RecordVO } from "busabase-contract/types";
import { expect, json, test } from "./_fixtures";

// On a phone the node topbar, the Base toolbar and long-text fields used to
// crowd each other out: the breadcrumb shrank to a character or two, the
// record search to a few letters, and the fullscreen button sat on top of the
// text. Each check below fails if that layout comes back.
test.use({ viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true });

test("phone layout keeps the node name, search and long text readable", async ({
  page,
  request,
}) => {
  const slug = `mobile-layout-${Date.now()}`;
  const baseName = `Mobile layout ${Date.now()}`;
  const base = await json<BaseVO>(
    await request.post("/api/v1/bases", {
      data: {
        autoMerge: true,
        name: baseName,
        slug,
        fields: [
          { name: "Title", slug: "title", type: "text", required: true },
          { name: "Notes", slug: "notes", type: "longtext" },
        ],
      },
    }),
  );
  const record = await json<RecordVO>(
    await request.post(`/api/v1/bases/${base.id}/change-requests`, {
      data: {
        autoMerge: true,
        fields: {
          title: "Phone layout record",
          notes: "A long note that runs past the first line of a phone screen. ".repeat(4),
        },
        message: "Create mobile layout fixture",
        submittedBy: "playwright",
      },
    }),
  );

  // Topbar: the Base's own name, not "Workspace > …" squeezed beside the actions.
  await page.goto(`/dashboard/local/base/${slug}`);
  const crumb = page.locator("[data-dashboard-topbar] [data-topbar-current-item]");
  await expect(crumb).toHaveText(baseName);
  expect((await crumb.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(60);
  // The Records / Design switch is icons only here, and keeps its names.
  await expect(page.getByRole("link", { name: "Records", exact: true })).toBeVisible();

  // Toolbar: the search folds to an icon in the same row and opens over the
  // whole row, instead of sitting inline a few letters wide.
  const toolbar = page.getByTestId("view-control-toolbar");
  const rowHeight = (await toolbar.boundingBox())?.height;
  const findInput = page.getByTestId("base-record-find-input");
  await expect(findInput).toBeHidden();
  await page.getByTestId("base-record-find-open").tap();
  await expect(findInput).toBeFocused();
  expect((await findInput.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(150);
  expect((await toolbar.boundingBox())?.height).toBe(rowHeight);
  await findInput.press("Enter");
  await expect(findInput).toBeHidden();

  // The Info marker left the topbar; "•••" carries it on a phone.
  await page
    .locator("[data-dashboard-topbar]")
    .getByRole("button", { name: "More actions" })
    .last()
    .click();
  await page.getByRole("menuitem", { name: "Details" }).click();
  // It lands on the Info tab, the one the topbar marker opened.
  await expect(
    page.getByRole("dialog").getByRole("term").filter({ hasText: "Created by" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  // Long text: no line runs underneath the fullscreen button in its corner.
  await page.goto(`/dashboard/local/base/${slug}/${record.id}`);
  const notes = page.locator('[data-record-field-slug="notes"] .group\\/field');
  await expect(notes).toBeVisible();
  const overlaps = await notes.evaluate((field) => {
    const button = field.querySelector("button")?.getBoundingClientRect();
    const text = field.querySelector(".whitespace-pre-wrap");
    if (!button || !text) return null;
    const range = document.createRange();
    range.selectNodeContents(text);
    return [...range.getClientRects()].some(
      (line) =>
        line.right > button.left &&
        line.left < button.right &&
        line.bottom > button.top &&
        line.top < button.bottom,
    );
  });
  expect(overlaps).toBe(false);
});
