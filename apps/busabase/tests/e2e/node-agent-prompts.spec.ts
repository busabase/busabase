import type { BaseVO, RecordVO } from "busabase-contract/types";
import { expect, json, type Page, test, unique } from "./_fixtures";

/**
 * A node's custom prompts are fetched when the dialog opens — they are no
 * longer carried on the node itself.
 *
 * The point of the split is what a LISTING costs: the field is capped at 50
 * prompts x 8 KiB of body per locale, and the sidebar reads every node in the
 * tree. So this asserts both halves against a real server: the listing does not
 * carry them, and the dialog still shows them.
 */

test.setTimeout(120_000);

const slugify = (v: string) =>
  v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const LONG_PROMPT_LABEL =
  "Review sources, conflicts, caveats, dependencies, and next steps before replying";

const PROMPTS = [
  {
    key: "e2e-weekly-summary",
    intent: "read-only",
    label: "Weekly severity summary",
    body: "Summarize tickets opened in {target} in the last 7 days, grouped by severity.",
  },
  {
    key: "e2e-monthly-digest",
    intent: "read-only",
    label: "Monthly digest",
    body: "Summarize tickets opened in {target} in the last 30 days.",
  },
  {
    key: "e2e-long-title",
    intent: "change",
    label: LONG_PROMPT_LABEL,
    body: "Review {target} without letting this long scenario title cover its toolbar actions.",
  },
];

const workspaceRow = (page: Page, name: string) =>
  page
    .locator('[data-sidebar="group"]')
    .filter({ hasText: /^Workspace/ })
    .locator("li")
    .filter({ has: page.getByRole("link", { name, exact: true }) })
    .last();

test("sidebar menus prioritize Agent prompts without displacing Open", async ({ page }) => {
  await page.goto("/dashboard/local/home?demo=1", { waitUntil: "commit" });
  await expect(page.locator("[data-dashboard-topbar]")).toBeVisible({ timeout: 45_000 });

  const folderRow = workspaceRow(page, "CMS");
  await expect(folderRow).toBeVisible();
  await folderRow.hover();
  await folderRow.locator('button[title="More"]').first().click();

  const folderMenu = page.getByRole("menu");
  await expect(folderMenu).toBeVisible();
  expect(
    (await folderMenu.getByRole("menuitem").allTextContents()).map((text) => text.trim()),
  ).toEqual([
    "Open",
    "Agent prompts",
    "Settings",
    "Rename",
    "Add to Favorites",
    "Move to…",
    "Share",
    "Delete",
  ]);
  await expect(folderMenu.getByRole("separator")).toHaveCount(2);
  await page.screenshot({
    path: "test-results/sidebar-folder-agent-prompts-priority.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");

  const docsRow = workspaceRow(page, "Docs");
  await expect(docsRow).toBeVisible();
  await docsRow.locator('button[title="Toggle"]').first().click();

  const documentRow = workspaceRow(page, "Agent Operating Guide");
  await expect(documentRow).toBeVisible();
  await documentRow.hover();
  await documentRow.locator('button[title="More"]').first().click();

  const documentMenu = page.getByRole("menu");
  await expect(documentMenu).toBeVisible();
  expect(
    (await documentMenu.getByRole("menuitem").allTextContents()).map((text) => text.trim()),
  ).toEqual([
    "Agent prompts",
    "Settings",
    "Rename",
    "Add to Favorites",
    "Move to…",
    "Share",
    "Delete",
  ]);
  await expect(documentMenu.getByRole("separator")).toHaveCount(2);
  await page.screenshot({
    path: "test-results/sidebar-document-agent-prompts-priority.png",
    fullPage: true,
  });

  await documentMenu.getByRole("menuitem", { name: "Agent prompts", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Agent prompts/ })).toBeVisible();
});

test("record detail exposes the Agent dropdown without losing the prompts handoff", async ({
  page,
  request,
}, testInfo) => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const base = await json<BaseVO>(
    await request.post("/api/v1/bases", {
      data: {
        autoMerge: true,
        fields: [{ name: "Company", required: true, slug: "company", type: "text" }],
        name: `PUL-240 Companies ${suffix}`,
        slug: `pul-240-companies-${suffix}`,
      },
    }),
  );
  const company = `Acme PUL-240 ${suffix}`;
  const record = await json<RecordVO>(
    await request.post(`/api/v1/bases/${base.id}/change-requests`, {
      data: {
        autoMerge: true,
        fields: { company },
        message: "Create the PUL-240 record-detail fixture",
        submittedBy: "playwright",
      },
    }),
  );

  await page.goto(`/dashboard/local/base/${base.slug}/${record.id}`);
  await expect(page.getByRole("heading", { level: 1, name: company })).toBeVisible({
    timeout: 45_000,
  });

  const primary = page.getByTestId("node-agent-prompts-button");
  const dropdown = page.getByTestId("node-agent-actions-trigger");
  await expect(primary).toBeVisible();
  await expect(dropdown).toBeVisible();
  await dropdown.click();

  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem").first()).toBeVisible();
  const menuScreenshot = testInfo.outputPath("01-record-agent-dropdown.png");
  await page.screenshot({ path: menuScreenshot });
  await testInfo.attach("record Agent dropdown", {
    path: menuScreenshot,
    contentType: "image/png",
  });

  await page.keyboard.press("Escape");
  await primary.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Ask Agent", exact: true })).toBeVisible();
  const dialogScreenshot = testInfo.outputPath("02-record-prompts-handoff.png");
  await page.screenshot({ path: dialogScreenshot });
  await testInfo.attach("record prompts handoff", {
    path: dialogScreenshot,
    contentType: "image/png",
  });
});

test("custom prompts reach the dialog without riding along on the node listing", async ({
  page,
  request,
}) => {
  const name = unique("e2e agent prompts");
  const slug = slugify(name);
  const created = await json<{ node: { id: string } }>(
    await request.post("/api/v1/docs", {
      data: { autoMerge: true, slug, name, body: "# Tickets\n\nA doc to hang prompts on.\n" },
    }),
  );
  const nodeId = created.node.id;

  const written = await request.put(`/api/v1/nodes/${nodeId}/agent-prompts`, {
    data: { agentPrompts: PROMPTS },
  });
  expect(written.ok()).toBe(true);

  // Half one: a listing does NOT carry them — the reason the column exists.
  const listed = await request.get("/api/v1/nodes");
  expect(listed.ok()).toBe(true);
  const listedBody = await listed.text();
  expect(listedBody).not.toContain("e2e-weekly-summary");
  expect(listedBody).not.toContain("Weekly severity summary");

  // Half two: asking for them directly still returns them.
  const fetched = await json<{ agentPrompts: Array<{ key: string }> | null }>(
    await request.get(`/api/v1/nodes/${nodeId}/agent-prompts`),
  );
  expect(fetched.agentPrompts?.map((prompt) => prompt.key)).toEqual([
    "e2e-weekly-summary",
    "e2e-monthly-digest",
    "e2e-long-title",
  ]);

  // Half three: the dialog renders what it fetched, in a real browser.
  await page.goto(`/dashboard/local/doc/${slug}`, { waitUntil: "commit" });
  await page.getByTestId("node-agent-prompts-button").click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: "Weekly severity summary", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: "test-results/agent-prompts-dialog.png", fullPage: true });

  // Custom-scenario management lives in one persistent detail-header menu;
  // the old per-row overflow menu is gone.
  await expect(
    dialog.getByRole("button", { name: "Actions for Weekly severity summary" }),
  ).toHaveCount(0);

  // The preview header combines the selected scenario title with the actions.
  // A realistic max-length title must ellipsize instead of shrinking or
  // covering the always-available toolbar controls.
  await page.setViewportSize({ width: 760, height: 800 });
  await dialog.getByRole("button", { name: LONG_PROMPT_LABEL, exact: true }).click();
  const activeTitle = dialog.getByTestId("agent-prompts-active-title");
  const toolbarActions = dialog.getByTestId("agent-prompts-toolbar-actions");
  await expect(activeTitle).toHaveText(LONG_PROMPT_LABEL);
  await expect(activeTitle).toHaveAttribute("title", LONG_PROMPT_LABEL);
  await expect
    .poll(() => activeTitle.evaluate((element) => element.scrollWidth > element.clientWidth))
    .toBe(true);
  const [titleBox, actionsBox] = await Promise.all([
    activeTitle.boundingBox(),
    toolbarActions.boundingBox(),
  ]);
  expect(titleBox).not.toBeNull();
  expect(actionsBox).not.toBeNull();
  if (!titleBox || !actionsBox) throw new Error("Prompt title or toolbar actions have no bounds");
  expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(actionsBox.x);
  await expect(dialog.getByRole("button", { name: "More actions", exact: true })).toBeVisible();
  await page.screenshot({
    path: "test-results/agent-prompts-long-title-toolbar.png",
    fullPage: true,
  });

  await page.setViewportSize({ width: 1280, height: 800 });
  await dialog.getByRole("button", { name: "Weekly severity summary", exact: true }).click();
  await expect(activeTitle).toHaveText("Weekly severity summary");
  await dialog.getByRole("button", { name: "More actions", exact: true }).click();
  for (const label of ["Copy prompt", "Edit scenario", "Delete scenario"]) {
    await expect(page.getByRole("menuitem", { name: label, exact: true })).toBeVisible();
  }
  await page.screenshot({ path: "test-results/agent-prompts-toolbar-menu.png", fullPage: true });

  await page.getByRole("menuitem", { name: "Edit scenario", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Edit scenario", exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/agent-prompts-toolbar-edit.png", fullPage: true });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await dialog.getByRole("button", { name: "More actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete scenario", exact: true }).click();
  await expect(page.getByText("Delete this custom scenario?", { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/agent-prompts-toolbar-delete.png", fullPage: true });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await dialog
    .getByRole("button", { name: "Answer my question from this doc", exact: true })
    .click();
  await dialog.getByRole("button", { name: "More actions", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Copy prompt", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Edit scenario", exact: true })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Delete scenario", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // ArrowDown/ArrowUp move both focus and the previewed prompt across the
  // custom-scenario list — the keyboard path a mouse-less user relies on.
  const firstPrompt = page.getByRole("button", {
    name: "Weekly severity summary",
    exact: true,
  });
  const secondPrompt = page.getByRole("button", { name: "Monthly digest", exact: true });
  await firstPrompt.click();
  await page.keyboard.press("ArrowDown");
  await expect(secondPrompt).toBeFocused();
  await expect(secondPrompt).toHaveAttribute("aria-current", "true");
  await page.screenshot({
    path: "test-results/pul-231-agent-prompts-arrow-down.png",
    fullPage: true,
  });
  await page.keyboard.press("ArrowUp");
  await expect(firstPrompt).toBeFocused();
  await expect(firstPrompt).toHaveAttribute("aria-current", "true");
});

// PUL-230: the real toolbar entry must remain usable with a long prompt,
// including copying and narrow or short viewports.
test("roomy prompt dialog keeps Ask Agent and Copy inside the detail footer", async ({
  page,
  request,
}, testInfo) => {
  const name = unique("PUL-230 prompt workflow");
  const slug = slugify(name);
  const created = await json<{ node: { id: string } }>(
    await request.post("/api/v1/docs", {
      data: { autoMerge: true, slug, name, body: "# Prompt workflow acceptance\n" },
    }),
  );
  const body = Array.from({ length: 50 }, (_, index) => `${index + 1}. Inspect {target}.`).join(
    "\n",
  );
  const written = await request.put(`/api/v1/nodes/${created.node.id}/agent-prompts`, {
    data: {
      agentPrompts: [{ key: "long-review", intent: "read-only", label: "Long review", body }],
    },
  });
  expect(written.ok()).toBe(true);
  await page.goto(`/dashboard/local/doc/${slug}`, { waitUntil: "commit" });
  await page.getByTestId("node-agent-prompts-button").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Long review", exact: true }).click();
  const preview = dialog.locator("textarea[readonly]");
  const copy = dialog.getByRole("button", { name: "Copy", exact: true });
  const askAgent = dialog.getByRole("button", { name: "Ask Agent", exact: true });
  await expect(dialog.getByText(/^Copying or sending also appends/)).toHaveCount(0);
  const capture = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`);
    await page.screenshot({ path });
    await testInfo.attach(name, { path, contentType: "image/png" });
  };
  const [dialogBox, copyBox, previewBox, askAgentBox] = await Promise.all([
    dialog.boundingBox(),
    copy.boundingBox(),
    preview.boundingBox(),
    askAgent.boundingBox(),
  ]);
  expect(dialogBox).not.toBeNull();
  expect(copyBox).not.toBeNull();
  expect(previewBox).not.toBeNull();
  expect(askAgentBox).not.toBeNull();
  if (!dialogBox || !copyBox || !previewBox || !askAgentBox) {
    throw new Error("Prompt dialog actions or preview have no bounds");
  }
  expect(dialogBox.width).toBeGreaterThanOrEqual(1000);
  expect(dialogBox.width).toBeLessThanOrEqual(1020);
  expect(dialogBox.height).toBeGreaterThanOrEqual(600);
  expect(dialogBox.height).toBeLessThanOrEqual(640);
  expect(copyBox.y).toBeGreaterThanOrEqual(previewBox.y + previewBox.height);
  expect((await copy.textContent())?.trim()).toBe("Copy");
  await expect(dialog.getByText(/also appends a short connection check/)).toHaveCount(0);
  expect(askAgentBox.y).toBeGreaterThanOrEqual(previewBox.y + previewBox.height);
  expect(copyBox.x).toBeGreaterThanOrEqual(askAgentBox.x + askAgentBox.width);
  expect(dialogBox.x + dialogBox.width - (copyBox.x + copyBox.width)).toBeLessThan(32);
  await capture("01-long-prompt-toolbar");

  await dialog.getByRole("button", { name: "Ask Agent options", exact: true }).click();
  await expect(
    page.getByRole("menuitem", { name: "No agent is connected yet.", exact: true }),
  ).toBeVisible();
  await capture("02-ask-agent-options");
  await page.keyboard.press("Escape");

  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await copy.click();
  await expect(dialog.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("50. Inspect");
  await capture("03-copied-prompt");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(async () => {
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    if (!bounds) throw new Error("Prompt dialog has no bounds");
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
  }).toPass();
  await expect(copy).toBeVisible();
  await capture("04-narrow-prompt");

  await page.setViewportSize({ width: 1280, height: 480 });
  await expect(async () => {
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    if (!bounds) throw new Error("Prompt dialog has no bounds");
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(1280);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(480);
    expect(bounds.height).toBeLessThanOrEqual(448);
  }).toPass();
  await expect(copy).toBeVisible();
  await expect(askAgent).toBeVisible();
  await capture("05-short-prompt");

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
