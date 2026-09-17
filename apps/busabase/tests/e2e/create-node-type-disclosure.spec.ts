import { expect, type Page, test } from "./_fixtures";

const openNewItemDialog = async (page: Page) => {
  await page.goto("/dashboard/local/home");

  const dialog = page.getByRole("dialog", { name: "New" });
  await expect
    .poll(
      async () => {
        if (await dialog.isVisible()) return true;

        const workspace = page
          .locator('[data-sidebar="group"]:visible')
          .filter({ hasText: /^Workspace/ })
          .first();
        // The group's own action, not a row's. Every tree row grew its own
        // `title="New"` button, so addressing this by accessible name matches
        // four elements and `isVisible()` throws a strict-mode violation.
        const newButton = workspace.locator('[data-sidebar="group-action"][title="New"]');
        if (await newButton.isVisible()) {
          await newButton.click();
        } else {
          const sidebarTrigger = page.getByRole("button", { name: "Toggle sidebar" }).first();
          if (await sidebarTrigger.isVisible()) await sidebarTrigger.click();
        }
        return dialog.isVisible();
      },
      { message: "New item dialog should open after dashboard hydration" },
    )
    .toBe(true);

  return dialog;
};

// Keep the dialog below its viewport height cap so its bounding box reflects
// the picker content shrinking, rather than both states measuring at the cap.
test.use({ viewport: { width: 1280, height: 1200 } });

test("an uncommon New item type stays selected while the picker collapses", async ({ page }) => {
  const dialog = await openNewItemDialog(page);

  const nameInput = dialog.getByRole("textbox").first();
  await nameInput.fill("Whiteboard planning draft");
  await dialog.getByRole("button", { name: "More types (7)" }).click();

  const whiteboard = dialog.getByRole("button", { name: /Whiteboard/ });
  await whiteboard.click();
  await expect(whiteboard).toHaveAttribute("aria-pressed", "true");
  const expandedBox = await dialog.boundingBox();
  expect(expandedBox).not.toBeNull();

  await dialog.getByRole("button", { name: "Fewer types" }).click();

  await expect(whiteboard).toBeVisible();
  await expect(whiteboard).toHaveAttribute("aria-pressed", "true");
  await expect(nameInput).toHaveValue("Whiteboard planning draft");
  await expect(dialog.getByRole("button", { name: /Workflow/ })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: /HTML/ })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "More types (6)" })).toBeVisible();
  const collapsedBox = await dialog.boundingBox();
  expect(collapsedBox).not.toBeNull();
  expect(collapsedBox?.height).toBeLessThan(expandedBox?.height ?? 0);

  await dialog.getByRole("button", { name: "More types (6)" }).click();

  await expect(dialog.getByRole("button", { name: /Workflow/ })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /HTML/ })).toBeVisible();
  await expect(whiteboard).toHaveAttribute("aria-pressed", "true");
  await expect(nameInput).toHaveValue("Whiteboard planning draft");
});

test.describe("mobile", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("keeps the New item workflow contained and reachable", async ({ page }) => {
    const dialog = await openNewItemDialog(page);
    const tabsScroller = dialog.locator("[data-create-node-tabs-scroll]");
    const templateTab = dialog.getByRole("tab", { name: "From a template" });
    const manualTab = dialog.getByRole("tab", { name: "Create it myself" });

    const dialogMetrics = await dialog.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(dialogMetrics.scrollWidth).toBeLessThanOrEqual(dialogMetrics.clientWidth);

    const tabsMetrics = await tabsScroller.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(tabsMetrics.scrollWidth).toBeGreaterThan(tabsMetrics.clientWidth);
    await templateTab.click();
    await expect(templateTab).toHaveAttribute("aria-selected", "true");
    await manualTab.click();
    await expect(manualTab).toHaveAttribute("aria-selected", "true");

    const nameInput = dialog.getByRole("textbox").first();
    await nameInput.fill("Mobile whiteboard draft");
    await dialog.getByRole("button", { name: "More types (7)" }).click();
    const whiteboard = dialog.getByRole("button", { name: /Whiteboard/ });
    await whiteboard.click();
    await dialog.getByRole("button", { name: "Fewer types" }).click();

    await expect(whiteboard).toHaveAttribute("aria-pressed", "true");
    await expect(nameInput).toHaveValue("Mobile whiteboard draft");
    await expect(dialog.getByRole("button", { name: "More types (6)" })).toBeVisible();

    const dialogBox = await dialog.boundingBox();
    const whiteboardBox = await whiteboard.boundingBox();
    const descriptionBox = await dialog.locator("[data-create-node-description]").boundingBox();
    expect(dialogBox).not.toBeNull();
    expect(whiteboardBox).not.toBeNull();
    expect(descriptionBox).not.toBeNull();
    expect(dialogBox?.x).toBeGreaterThanOrEqual(0);
    expect((dialogBox?.x ?? 0) + (dialogBox?.width ?? 0)).toBeLessThanOrEqual(390);
    expect(whiteboardBox?.x).toBeGreaterThanOrEqual(dialogBox?.x ?? 0);
    expect((whiteboardBox?.x ?? 0) + (whiteboardBox?.width ?? 0)).toBeLessThanOrEqual(
      (dialogBox?.x ?? 0) + (dialogBox?.width ?? 0),
    );
    expect(descriptionBox?.x).toBeGreaterThanOrEqual(dialogBox?.x ?? 0);
    expect((descriptionBox?.x ?? 0) + (descriptionBox?.width ?? 0)).toBeLessThanOrEqual(
      (dialogBox?.x ?? 0) + (dialogBox?.width ?? 0),
    );
    const tileMetrics = await whiteboard.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(tileMetrics.scrollWidth).toBeLessThanOrEqual(tileMetrics.clientWidth);

    const footer = dialog.locator("[data-create-node-footer]");
    const cancelButton = footer.getByRole("button", { name: "Cancel" });
    const createButton = footer.getByRole("button", { name: "Create Now" });
    const moreSubmitButton = footer.getByRole("button", { name: "More submit options" });
    const [footerBox, cancelBox, createBox, moreSubmitBox] = await Promise.all([
      footer.boundingBox(),
      cancelButton.boundingBox(),
      createButton.boundingBox(),
      moreSubmitButton.boundingBox(),
    ]);
    expect(footerBox).not.toBeNull();
    expect(cancelBox).not.toBeNull();
    expect(createBox).not.toBeNull();
    expect(moreSubmitBox).not.toBeNull();
    expect(cancelBox?.x).toBeGreaterThanOrEqual(footerBox?.x ?? 0);
    expect((createBox?.x ?? 0) + (createBox?.width ?? 0)).toBeLessThanOrEqual(
      (footerBox?.x ?? 0) + (footerBox?.width ?? 0),
    );
    expect(Math.abs((cancelBox?.y ?? 0) - (createBox?.y ?? 0))).toBeLessThan(8);
    expect(Math.abs((moreSubmitBox?.y ?? 0) - (createBox?.y ?? 0))).toBeLessThan(1);
  });
});
