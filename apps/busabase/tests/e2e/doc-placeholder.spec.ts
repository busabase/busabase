import { type APIRequestContext, expect, json, test, unique } from "./_fixtures";

// Crepe's Placeholder feature was disabled at birth (#5707) because it threw
// "Cannot read properties of undefined (reading 'localsInner')" the moment a doc
// briefly went empty, and that crash killed the markdownUpdated listener for the
// rest of the session — everything typed afterwards was silently dropped on save.
// The real cause was two copies of prosemirror-view in the workspace (deduped in
// #6619), so the feature is back on.
//
// This spec is the original repro, kept as a regression: empty the doc, keep
// typing, save, reload, and read the body back from the API. Silent content loss
// is the failure mode that matters here — an assertion on the DOM alone would
// have passed even while the bug was live.

interface DocNodeVO {
  node: { id: string; slug: string; name: string };
  body: string;
}

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const createDoc = async (request: APIRequestContext, namePrefix: string, body: string) => {
  const name = unique(namePrefix);
  const slug = slugify(name);
  await json<DocNodeVO>(
    await request.post("/api/v1/docs", { data: { autoMerge: true, slug, name, body } }),
  );
  return slug;
};

const getBody = async (request: APIRequestContext, slug: string) =>
  (await json<DocNodeVO & { type: "doc" }>(await request.get(`/api/v1/nodes/${slug}?type=doc`)))
    .body;

test("emptying a doc mid-edit does not swallow what is typed next", async ({ page, request }) => {
  const slug = await createDoc(request, "E2E doc placeholder", "Original content.\n");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto(`/dashboard/local/doc/${slug}`);
  await page.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByRole("button", { name: "Save Now" })).toBeVisible();

  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Delete");

  // The empty state is exactly where it used to throw — and it is also the only
  // moment the placeholder is visible, so this asserts the feature and the fix
  // at the same time. Crepe renders it as a node decoration on the empty
  // paragraph; the visible hint is CSS `content: attr(data-placeholder)`.
  await expect(editor.locator("p.crepe-placeholder")).toHaveAttribute(
    "data-placeholder",
    /press '\/' for commands/,
  );
  expect(errors, "the empty document must not throw").toEqual([]);

  await page.keyboard.type("Typed after the doc went empty.", { delay: 15 });
  await expect(editor).toContainText("Typed after the doc went empty.");

  await page.waitForTimeout(300); // markdownUpdated -> React draft is async
  await page.getByRole("button", { name: "Save Now" }).click();
  await expect(page.getByRole("button", { name: "Edit" })).toBeVisible({ timeout: 30_000 });

  // The definitive check: what actually persisted, not what the DOM shows.
  expect(await getBody(request, slug)).toContain("Typed after the doc went empty.");
  expect(await getBody(request, slug)).not.toContain("Original content.");
  expect(errors).toEqual([]);

  await page.reload();
  await expect(page.locator(".ProseMirror")).toContainText("Typed after the doc went empty.");
});

test("the placeholder shows on an empty doc and disappears once you type", async ({
  page,
  request,
}) => {
  const slug = await createDoc(request, "E2E doc placeholder empty", "");

  await page.goto(`/dashboard/local/doc/${slug}`);
  await page.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByRole("button", { name: "Save Now" })).toBeVisible();

  const placeholder = page.locator(".ProseMirror p.crepe-placeholder");
  // The hint comes from busabase-core's own i18n, not Crepe's "Please enter..."
  // default — so this also covers the featureConfigs wiring.
  await expect(placeholder).toHaveAttribute(
    "data-placeholder",
    "Start writing, or press '/' for commands…",
  );

  await page.locator(".ProseMirror").click();
  await page.keyboard.type("Not empty any more.", { delay: 15 });
  await expect(placeholder).toHaveCount(0);
});

test("the placeholder and an inline video player coexist", async ({ page, request }) => {
  // The crash was never really about Placeholder: it fired when a *second*
  // plugin contributed decorations. The video players (#6609/#6619) are that
  // second source in production, so this is the combination that has to hold.
  const slug = await createDoc(
    request,
    "E2E doc placeholder with video",
    "> 🎥 **[Full demo](/e2e-media/demo.mp4)**\n\nSome text to delete.\n",
  );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(`/dashboard/local/doc/${slug}`);
  await page.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByRole("button", { name: "Save Now" })).toBeVisible();

  const editor = page.locator(".ProseMirror");
  await expect(editor.locator("video.milkdown-video-block")).toHaveCount(1);

  // Empty just the trailing paragraph — Control+a would take the whole document
  // including the link that produces the player, and the point here is to have
  // the placeholder decoration and the player decoration live at the same time.
  // Triple-click selects that paragraph's text (End/Shift+Home did not reach
  // the editor reliably under automation).
  await editor.locator("p").last().click({ clickCount: 3 });
  await page.keyboard.press("Delete");
  await expect(editor.locator("p.crepe-placeholder")).toHaveCount(1);
  await expect(editor.locator("video.milkdown-video-block")).toHaveCount(1);

  await page.keyboard.type("Typed while a player was on screen.", { delay: 15 });
  await expect(editor.locator("video.milkdown-video-block")).toHaveCount(1);
  expect(errors).toEqual([]);

  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Save Now" }).click();
  await expect(page.getByRole("button", { name: "Edit" })).toBeVisible({ timeout: 30_000 });
  const saved = await getBody(request, slug);
  expect(saved).toContain("Typed while a player was on screen.");
  // The video link itself must survive the round-trip untouched.
  expect(saved).toContain("[Full demo](/e2e-media/demo.mp4)");
});
