import { expect, type Page, test } from "./_fixtures";

const WORKSPACE_PATH = "/dashboard/local/home?lang=zh-CN";

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function overlaps(left: Box, right: Box): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

async function measure(page: Page) {
  return page.evaluate(() => {
    const status = document.querySelector("[data-rich-node-save-status]");
    const add = document.querySelector<HTMLElement>('button[aria-label="添加步骤"]');
    const remove = document.querySelector<HTMLElement>('button[aria-label="删除所选项"]');
    const box = (element: Element | null) => {
      if (!element) return null;
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") return null;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    const addText = add?.innerText ?? "";
    return {
      status: box(status),
      add: box(add),
      remove: box(remove),
      addText,
      addOverflow: add?.className.includes("overflow-hidden") ?? false,
    };
  });
}

test.describe("forum #23 workflow toolbar", () => {
  test("narrow and wide toolbars keep status off the step buttons", async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 420, height: 800 });
    const slug = `forum-toolbar-${Date.now()}`;
    const name = `Forum toolbar ${slug}`;
    const created = await request.post("/api/rpc/nodes/createChangeRequest", {
      data: {
        json: {
          autoMerge: true,
          operations: [{ kind: "create", nodeType: "workflow", slug, name }],
        },
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    await page.goto(WORKSPACE_PATH);
    const entry = page.getByRole("link", { name, exact: true });
    // A phone starts with its sidebar closed. Enter from the real workspace
    // sidebar at desktop width, then exercise the phone's production menu.
    await page.setViewportSize({ width: 1024, height: 800 });
    await expect(entry).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("toolbar-workspace.png"), fullPage: false });
    await entry.click();
    await page.setViewportSize({ width: 420, height: 800 });
    // Current shared dashboard puts editing actions in More on a phone.
    const add = page.getByRole("button", { name: "添加步骤", exact: true });
    await expect(page.getByRole("button", { name: "更多操作", exact: true })).toBeVisible();
    await expect(add).toBeHidden();
    await page.getByRole("button", { name: "更多操作", exact: true }).click();
    await page.getByRole("menuitem", { name: "添加步骤", exact: true }).click();
    const dirty = page.locator("[data-rich-node-save-status]");
    await expect(dirty).toHaveText("有未保存更改");
    await expect(dirty).toBeHidden();
    await page.getByRole("button", { name: "更多操作", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: "删除所选项", exact: true })).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath("toolbar-420.png"), fullPage: false });
    await page.keyboard.press("Escape");
    const narrowBefore = await measure(page);
    await page.setViewportSize({ width: 1024, height: 800 });
    await expect(dirty).toBeVisible();
    const wide = await measure(page);
    expect(wide.status).not.toBeNull();
    expect(wide.add).not.toBeNull();
    expect(wide.remove).not.toBeNull();
    expect(overlaps(wide.status as Box, wide.add as Box)).toBe(false);
    expect(overlaps(wide.status as Box, wide.remove as Box)).toBe(false);
    expect(overlaps(wide.add as Box, wide.remove as Box)).toBe(false);

    const covered = await page.evaluate(() => {
      const button = document.querySelector<HTMLElement>('button[aria-label="删除所选项"]');
      if (!button) return "missing";
      const rect = button.getBoundingClientRect();
      const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return button.contains(top)
        ? "button"
        : (top?.getAttribute("data-rich-node-save-status") ?? top?.tagName ?? "other");
    });
    expect(covered).toBe("button");

    await page.screenshot({
      path: testInfo.outputPath("toolbar-1024.png"),
      fullPage: false,
    });
    await page.getByRole("button", { name: "删除所选项", exact: true }).click();
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(dirty).toHaveText("已保存");
    await page.screenshot({ path: testInfo.outputPath("toolbar-saved.png"), fullPage: false });
    await page.reload();
    await expect(page.locator("[data-rich-node-save-status]")).toHaveText("已保存");
    console.log(JSON.stringify({ forum: 23, slug, narrowBefore, wide, covered, saveReload: true }));
  });
});
