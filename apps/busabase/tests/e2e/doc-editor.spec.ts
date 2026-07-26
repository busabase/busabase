import { type APIRequestContext, expect, json, type Page, test, unique } from "./_fixtures";

// Every test below does a real Save (createChangeRequest -> review -> merge, 3
// sequential writes) against the shared single-connection PGLite dev DB. Run outside
// CI (where workers default to CPU count, not 1) that's enough concurrent write
// pressure to make a save hang well past this suite's own generous timeouts — forcing
// serial execution here avoids that without slowing down CI, which already runs
// workers=1 for the whole project (see playwright.config.ts).
test.describe.configure({ mode: "serial" });

// Coverage for the Milkdown-based Doc editor (see packages/busabase-core/src/domains/doc/
// components/doc-editor*.tsx, added 2026-07-23) — markdown-shortcut block conversion,
// the slash menu, the text-selection toolbar (bold/italic/link), image-as-Asset
// upload + deletion, and the title/body alignment fix that came out of manually
// reviewing this editor (see changelog/20260723-busabase-doc-detail-width.md).
//
// Docs are created via the REST API (autoMerge: true) rather than through the UI's
// "New" flow — same reasoning as review-experience.spec.ts / airapp.spec.ts: the UI
// only needs to drive the actual editor behavior under test, not doc creation.
//
// `DocDetailView` remounts the whole Milkdown instance on the Edit click (it's keyed
// on `isEditing`, see node-detail-views.tsx) — clicking straight into `.ProseMirror`
// right after clicking "Edit" can land on the outgoing read-only instance mid-unmount
// and silently lose the first few keystrokes. `enterEditMode` waits for "Save Now"
// (edit-mode-only chrome) before touching the editor, which avoids that.
const enterEditMode = async (page: Page) => {
  await page.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByRole("button", { name: "Save Now" })).toBeVisible();
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Delete");
  return editor;
};

// The `markdownUpdated` listener that feeds the React `draft` state is async relative
// to ProseMirror's own (synchronous) DOM update — the DOM assertions above this call
// can pass before `draft` has caught up. A short pause before "Save Now" gives it a
// beat, mirroring how a real user pauses before clicking Save rather than saving on
// the very same tick as their last keystroke.
const saveAndExitEditMode = async (page: Page) => {
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Save Now" }).click();
  await expect(page.getByRole("button", { name: "Edit" })).toBeVisible({ timeout: 30_000 });
};

interface DocNodeVO {
  node: { id: string; slug: string; name: string };
  body: string;
}

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const createDoc = async (request: APIRequestContext, namePrefix: string, body = "") => {
  const name = unique(namePrefix);
  const slug = slugify(name);
  const created = await json<DocNodeVO>(
    await request.post("/api/v1/docs", {
      data: { autoMerge: true, slug, name, body },
    }),
  );
  return { name, slug, nodeId: created.node.id };
};

const getDocBody = async (request: APIRequestContext, slug: string) =>
  (await json<DocNodeVO>(await request.get(`/api/v1/docs/${slug}`))).body;

test("headings H1-H6 and inline marks (bold/italic/strikethrough)", async ({ page, request }) => {
  const { slug } = await createDoc(request, "E2E doc headings");
  await page.goto(`/dashboard/local/doc/${slug}`);
  const editor = await enterEditMode(page);

  for (let level = 1; level <= 6; level++) {
    await page.keyboard.type(`${"#".repeat(level)} Heading ${level}`);
    await page.keyboard.press("Enter");
  }
  for (let level = 1; level <= 6; level++) {
    await expect(editor.locator(`h${level}`)).toHaveText(`Heading ${level}`);
  }

  await page.keyboard.type("Some **bold text**, *italic text*, and ~~strike~~ inline.");
  await expect(editor.locator("strong")).toHaveText("bold text");
  await expect(editor.locator("em")).toHaveText("italic text");
  await expect(editor.locator("s, del")).toHaveText("strike");

  await saveAndExitEditMode(page);
  const body = await getDocBody(request, slug);
  expect(body).toContain("# Heading 1");
  expect(body).toContain("###### Heading 6");
  expect(body).toContain("**bold text**");
});

test("bullet, ordered, and task lists — checkbox toggle persists", async ({ page, request }) => {
  const { slug } = await createDoc(request, "E2E doc lists");
  await page.goto(`/dashboard/local/doc/${slug}`);
  const editor = await enterEditMode(page);

  // Markdown shortcuts race if fired without letting each transaction settle (a
  // leading "1. " right after exiting a bullet list can merge into the previous
  // item's text instead of starting a new ordered list — this reproduced
  // intermittently even with a 150ms pause, so waiting for the exited-list's
  // trailing empty paragraph to actually become a direct child of `.ProseMirror`
  // is the reliable signal, not a fixed timeout).
  const typeLine = async (text: string) => {
    await page.keyboard.type(text);
    await page.waitForTimeout(200);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(200);
  };
  const exitList = async () => {
    await page.keyboard.press("Enter"); // empty item exits the list
    await expect(editor.locator("> p").last()).toBeVisible();
    await page.waitForTimeout(200);
  };

  await typeLine("- bullet a");
  await typeLine("bullet b");
  await exitList();

  await typeLine("1. ordered a");
  await typeLine("ordered b");
  await exitList();

  await typeLine("- [ ] task a");
  await typeLine("task b");
  await page.keyboard.press("Enter");

  await expect(editor.locator("ol")).toHaveCount(1);
  await expect(editor.locator("ol")).toContainText("ordered a");
  await expect(editor.locator("ol")).toContainText("ordered b");
  // Bullet and task lists both use a "-" marker; Milkdown merges adjacent
  // same-marker lists into one `<ul>` with no separator between them, so
  // assert on the items rather than a specific `<ul>` count.
  await expect(editor.locator("li", { hasText: "bullet a" })).toBeVisible();
  await expect(editor.locator("li", { hasText: "bullet b" })).toBeVisible();

  const firstTaskCheckbox = editor
    .locator(".milkdown-list-item-block")
    .filter({ hasText: "task a" })
    .locator(".label-wrapper");
  await expect(firstTaskCheckbox.locator(".milkdown-icon.label")).toHaveClass(/unchecked/);
  await firstTaskCheckbox.click();
  await expect(firstTaskCheckbox.locator(".milkdown-icon.label")).toHaveClass(/checked/);

  await saveAndExitEditMode(page);
  const body = await getDocBody(request, slug);
  expect(body).toContain("[x] task a");
  expect(body).toContain("[ ] task b");
});

test("blockquote, code block, and divider", async ({ page, request }) => {
  const { slug } = await createDoc(request, "E2E doc blocks");
  await page.goto(`/dashboard/local/doc/${slug}`);
  const editor = await enterEditMode(page);

  await page.keyboard.type("> A quoted line.");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(editor.locator("blockquote")).toHaveText("A quoted line.");

  await page.keyboard.type("```js");
  await page.keyboard.press("Enter");
  await page.keyboard.type("const answer = 42;");
  // Code blocks are a separate CodeMirror instance — Escape moves focus back
  // to the surrounding ProseMirror doc instead of typing an escape character.
  await page.keyboard.press("Escape");
  await expect(editor.locator(".milkdown-code-block .cm-editor")).toContainText(
    "const answer = 42;",
  );
  await expect(editor.locator(".milkdown-code-block .copy-button")).toBeVisible();

  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("---");
  await page.keyboard.press("Enter");
  await expect(editor.locator("hr")).toHaveCount(1);

  await saveAndExitEditMode(page);
  const body = await getDocBody(request, slug);
  expect(body).toContain("> A quoted line.");
  expect(body).toContain("const answer = 42;");
  expect(body).toContain("***");
});

test("slash menu lists block types and filters as you type", async ({ page, request }) => {
  const { slug } = await createDoc(request, "E2E doc slash menu");
  await page.goto(`/dashboard/local/doc/${slug}`);
  await enterEditMode(page);

  await page.keyboard.type("/");
  const menu = page.locator(".milkdown-slash-menu");
  await expect(menu).toBeVisible();
  for (const label of ["Heading 1", "Bullet List", "Code Block", "Table", "Image", "Divider"]) {
    await expect(menu.getByText(label, { exact: true })).toBeVisible();
  }

  await page.keyboard.type("table");
  await expect(menu.getByText("Table", { exact: true })).toBeVisible();
  await expect(menu.getByText("Heading 1", { exact: true })).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
});

test("selection toolbar formats text; link toolbar adds, previews, and removes a link", async ({
  page,
  request,
}) => {
  const { slug } = await createDoc(request, "E2E doc toolbar");
  await page.goto(`/dashboard/local/doc/${slug}`);
  const editor = await enterEditMode(page);
  await page.keyboard.type("Select this whole sentence.");

  const paragraph = editor.locator("p").first();
  const box = await paragraph.boundingBox();
  if (!box) throw new Error("paragraph should have a bounding box");
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();

  const toolbar = page.locator(".milkdown-toolbar");
  await expect(toolbar).toBeVisible();
  const toolbarItems = toolbar.locator(".toolbar-item");
  await expect(toolbarItems).toHaveCount(6); // bold, italic, strike, code, math, link

  await toolbarItems.nth(0).click(); // Bold
  await expect(editor.locator("strong")).toHaveText("Select this whole sentence.");

  // Re-select (bold toggling above collapses the selection) and add a link.
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(toolbar).toBeVisible();
  await toolbarItems.last().click(); // Link

  const linkInput = page.locator(".milkdown-link-edit input.input-area");
  await expect(linkInput).toBeVisible();
  await linkInput.fill("https://example.com");
  await page.keyboard.press("Enter");

  const link = editor.locator("a");
  await expect(link).toHaveAttribute("href", "https://example.com");

  await link.hover();
  const preview = page.locator(".milkdown-link-preview");
  await expect(preview).toHaveAttribute("data-show", "true");
  await preview.locator(".link-remove-button").click();
  await expect(editor.locator("a")).toHaveCount(0);

  await saveAndExitEditMode(page);
  const body = await getDocBody(request, slug);
  expect(body).toContain("**Select this whole sentence.**");
  expect(body).not.toContain("example.com");
});

test("image block uploads a file as a real Asset, and deleting it removes both", async ({
  page,
  request,
}) => {
  const { slug } = await createDoc(request, "E2E doc image");
  await page.goto(`/dashboard/local/doc/${slug}`);
  const editor = await enterEditMode(page);
  await page.keyboard.type("/");
  await page.locator(".milkdown-slash-menu").getByText("Image", { exact: true }).click();

  // 1x1 transparent PNG, inlined so the test has no external file dependency.
  const pngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  await editor.locator("input[type=file]").setInputFiles({
    name: "e2e-test-pixel.png",
    mimeType: "image/png",
    buffer: Buffer.from(pngBase64, "base64"),
  });

  const image = editor.locator("img[data-type='image-block']");
  await expect(image).toBeVisible();
  const src = await image.getAttribute("src");
  expect(src).toMatch(/^\/api\/dev\/attachment\//);

  await saveAndExitEditMode(page);
  const savedBody = await getDocBody(request, slug);
  // Crepe's markdown serializer stores the image's aspect ratio in the alt-text
  // slot (e.g. `![1.00](url)`), so assert on the src rather than an exact
  // `![](url)` shape.
  expect(savedBody).toContain(src);
  expect(savedBody).toMatch(/!\[[^\]]*\]\(.*\)/);

  await page.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByRole("button", { name: "Save Now" })).toBeVisible();
  await editor.locator(".image-wrapper").click();
  await page.keyboard.press("Backspace");
  await expect(editor.locator("img[data-type='image-block']")).toHaveCount(0);

  await saveAndExitEditMode(page);
  const bodyAfterDelete = await getDocBody(request, slug);
  expect(bodyAfterDelete).not.toContain(src ?? "\0unreachable");
});

test("doc title and body share the same left edge, and the block handle isn't clipped", async ({
  page,
  request,
}) => {
  const { slug } = await createDoc(request, "E2E doc alignment", "Alignment regression check.");
  await page.goto(`/dashboard/local/doc/${slug}`);

  const title = page.getByRole("heading", { level: 1 });
  const paragraph = page.locator(".ProseMirror p").first();
  await expect(paragraph).toBeVisible();
  const titleBox = await title.boundingBox();
  const paragraphBox = await paragraph.boundingBox();
  if (!titleBox || !paragraphBox) throw new Error("title and paragraph should be measurable");
  // Regression test for the 2026-07-23 fix: Crepe's shipped theme bakes in its
  // own horizontal padding on `.ProseMirror`, which — stacked on top of
  // DocDetailView's own page padding — pushed the doc body to the right of the
  // title above it (see changelog/20260723-busabase-doc-detail-width.md).
  expect(paragraphBox.x).toBeCloseTo(titleBox.x, 0);

  const editor = await enterEditMode(page);
  await page.keyboard.type("Alignment regression check.");
  const editorParagraph = editor.locator("p").first();
  const pBox = await editorParagraph.boundingBox();
  if (!pBox) throw new Error("editor paragraph should be measurable");
  await page.mouse.move(pBox.x + 10, pBox.y + pBox.height / 2);
  await page.mouse.move(pBox.x + 20, pBox.y + pBox.height / 2 + 2);

  const handle = page.locator(".milkdown-block-handle");
  await expect(handle).toHaveAttribute("data-show", "true");
  const handleBox = await handle.boundingBox();
  const wrapperBox = await page.locator('[data-dashboard-scroll="doc-detail"]').boundingBox();
  if (!handleBox || !wrapperBox) throw new Error("handle and wrapper should be measurable");
  // The handle renders to the left of the hovered block via a negative offset;
  // it must stay inside the scrollable wrapper's own box or it gets clipped by
  // that wrapper's `overflow-auto` (the earlier version of the width fix broke
  // this by zeroing out Crepe's padding without reserving room for the handle).
  expect(handleBox.x).toBeGreaterThanOrEqual(wrapperBox.x);
});
