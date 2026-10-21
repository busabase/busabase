import type { BaseVO, ViewVO } from "busabase-contract/types";
import { type APIRequestContext, expect, json, test, unique } from "./_fixtures";

const RENDER_TIMEOUT = 45_000;

const createBase = async (request: APIRequestContext, slug: string) =>
  json<BaseVO>(
    await request.post("/api/v1/bases", {
      data: {
        autoMerge: true,
        fields: [
          { name: "Title", required: true, slug: "title", type: "text" },
          {
            name: "Status",
            slug: "status",
            type: "select",
            options: {
              choices: [
                { id: "todo", name: "Todo" },
                { id: "done", name: "Done" },
              ],
            },
          },
        ],
        name: unique("View order"),
        slug,
      },
    }),
  );

test("dragging a view tab changes which view the Base opens on, for everyone", async ({
  page,
  request,
}) => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const slug = `view-order-${suffix}`;
  const base = await createBase(request, slug);
  await json<ViewVO>(
    await request.post("/api/v1/views/change-requests", {
      data: {
        operation: "create",
        baseId: base.id,
        autoMerge: true,
        config: { filters: [], sorts: [], stackByFieldSlug: "status" },
        name: "Board",
        slug: "board",
        type: "kanban",
      },
    }),
  );

  // A new Base comes with "Grid view" first, so that is where it opens.
  await page.goto(`/dashboard/local/base/${slug}`);
  await expect(page).toHaveURL(new RegExp(`/dashboard/local/base/${slug}/grid-view$`), {
    timeout: RENDER_TIMEOUT,
  });
  const tabs = page.getByTestId("base-view-tabs");
  const gridTab = tabs.getByRole("link", { exact: true, name: "Grid view" });
  const boardTab = tabs.getByRole("link", { exact: true, name: "Board" });
  await expect(gridTab).toHaveAttribute("aria-current", "page");
  await expect(tabs.getByRole("link", { exact: true, name: "All" })).toHaveCount(0);

  // A plain click still just opens the view.
  await boardTab.click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/local/base/${slug}/board$`));
  await gridTab.click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/local/base/${slug}/grid-view$`));

  // Drag "Board" in front of "Grid view" (past the 8px activation distance).
  const boardBox = await boardTab.boundingBox();
  const gridBox = await gridTab.boundingBox();
  if (!boardBox || !gridBox) throw new Error("Both view tabs must be visible before dragging");
  await page.mouse.move(boardBox.x + boardBox.width / 2, boardBox.y + boardBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(boardBox.x + boardBox.width / 2 - 12, boardBox.y + boardBox.height / 2, {
    steps: 4,
  });
  await page.mouse.move(gridBox.x + gridBox.width / 4, gridBox.y + gridBox.height / 2, {
    steps: 12,
  });
  await page.mouse.up();

  // The drop does not navigate — it only reorders, optimistically and on the server.
  await expect(page).toHaveURL(new RegExp(`/dashboard/local/base/${slug}/grid-view$`));
  await expect
    .poll(async () =>
      tabs.locator("a").evaluateAll((links) => links.map((link) => link.textContent?.trim())),
    )
    .toEqual(["Board", "Grid view"]);
  await expect
    .poll(async () => {
      const views = await json<ViewVO[]>(await request.get(`/api/v1/bases/${base.id}/views`));
      return views.map((view) => [view.slug, view.position]);
    })
    .toEqual([
      ["board", 0],
      ["grid-view", 1],
    ]);

  // The leftmost view is now the one the Base opens on.
  await page.goto(`/dashboard/local/base/${slug}`);
  await expect(page).toHaveURL(new RegExp(`/dashboard/local/base/${slug}/board$`), {
    timeout: RENDER_TIMEOUT,
  });
});

test("the last view of a Base cannot be deleted", async ({ page, request }) => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const slug = `last-view-${suffix}`;
  const base = await createBase(request, slug);
  const [gridView] = await json<ViewVO[]>(await request.get(`/api/v1/bases/${base.id}/views`));
  if (!gridView) throw new Error("A new Base must come with its Grid view");

  await page.goto(`/dashboard/local/base/${slug}`);
  await expect(page).toHaveURL(new RegExp(`/dashboard/local/base/${slug}/grid-view$`), {
    timeout: RENDER_TIMEOUT,
  });
  await page.getByTestId("active-view-actions").click();
  await expect(page.getByTestId("delete-view-menu-item")).toBeDisabled();
  await expect(
    page.getByText("A Base must keep at least one view. Create another view before deleting"),
  ).toBeVisible();

  // The server enforces the same rule for API callers.
  const response = await request.post("/api/v1/views/change-requests", {
    data: { operation: "delete", viewId: gridView.id },
  });
  expect(response.status()).toBe(400);
  expect(await response.text()).toContain("A Base must keep at least one view");
});
