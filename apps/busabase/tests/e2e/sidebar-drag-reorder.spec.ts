import { expect, type Page, test } from "./_fixtures";

const RENDER_TIMEOUT = 45_000;
test.setTimeout(120_000);

/**
 * Regression cover for sidebar drag-and-drop, written against the bug that made
 * it worthless in practice: the tree used to be handed to dnd-kit's
 * `SortableContext` + `verticalListSortingStrategy`, which translates every row
 * mid-drag to preview a FLAT-list reorder. Those shifted rects then fed the
 * drop-position maths, so a parent folder header kept winning the collision over
 * the sibling row the pointer was on — and a "before"/"after" drop on a folder
 * header means "become a sibling OF THE FOLDER". Net effect: reordering two
 * children inside a folder silently moved the node OUT to the workspace root.
 *
 * The assertion that actually catches it is therefore not "the order changed"
 * but "the node is still inside the same folder". An in-folder reorder that
 * teleports the row to the top of the sidebar would otherwise pass a naive
 * "did anything move?" check.
 *
 * These tests MUTATE the shared seed tree (there is no per-test workspace here),
 * so each one creates its own folder + children over the REST API first and only
 * ever drags rows it created.
 */

interface CreatedNode {
  id: string;
  slug: string;
  name: string;
}

const uniqueSuffix = () => `${Date.now()}-${Math.floor(Math.random() * 100_000)}`;

/**
 * Create a node through the public REST API (write-setup out of the browser).
 *
 * Node creation goes through the node-tree ChangeRequest endpoint, not a plain
 * `POST /nodes` — every structural change is a reviewable operation here, and
 * `autoMerge` is what makes it land immediately. The response is the
 * ChangeRequest: its `node` field is null for a merged create, and the real id
 * arrives in `mergeSummary.mergedNodeIds`.
 */
const createNode = async (
  request: Parameters<Parameters<typeof test>[2]>[0]["request"],
  node: { nodeType: string; name: string; slug: string; parentNodeId?: string },
): Promise<CreatedNode> => {
  const response = await request.post("/api/v1/nodes/change-requests", {
    data: {
      message: `Create ${node.name}`,
      autoMerge: true,
      operations: [{ kind: "create", ...node }],
    },
  });
  expect(response.ok(), `create ${node.name} → ${response.status()}`).toBe(true);
  const payload = (await response.json()) as {
    status: string;
    mergeSummary?: { mergedNodeIds?: string[] };
  };
  expect(payload.status, `create ${node.name} did not merge`).toBe("merged");
  const id = payload.mergeSummary?.mergedNodeIds?.[0];
  expect(id, `create ${node.name} returned no node id`).toBeTruthy();
  return { id: id as string, slug: node.slug, name: node.name };
};

/** Ordered child ids of a folder, straight from the API. */
const childIdsOf = async (
  request: Parameters<Parameters<typeof test>[2]>[0]["request"],
  nodeId: string,
): Promise<string[]> => {
  const response = await request.get(`/api/v1/nodes/${nodeId}`);
  expect(response.ok(), `read ${nodeId} → ${response.status()}`).toBe(true);
  // Children hang off the ENVELOPE, not `node.children` (which stays empty on
  // this endpoint) — and they come back in `position` order.
  const payload = (await response.json()) as { children: { id: string }[] };
  return payload.children.map((child) => child.id);
};

/** The node's current parent, straight from the API — the source of truth the UI can't fake. */
const parentIdOf = async (
  request: Parameters<Parameters<typeof test>[2]>[0]["request"],
  nodeId: string,
): Promise<string | null> => {
  const response = await request.get(`/api/v1/nodes/${nodeId}`);
  expect(response.ok(), `read ${nodeId} → ${response.status()}`).toBe(true);
  // `GET /nodes/{id}` answers with an envelope (`{ node, children, type }`),
  // not the bare node.
  const payload = (await response.json()) as { node: { parentId: string | null } };
  return payload.node.parentId;
};

/**
 * Drag `source` onto a band of `target`, driving real pointer events through the
 * row's grip handle (the row body is deliberately not draggable — dnd-kit's
 * pointer capture on a row wrapping an `<a>` fires a spurious navigation click
 * right after the drop).
 *
 * `band` picks where inside the target row to release: `"top"`/`"bottom"` are the
 * reorder bands, `"middle"` is a folder's reparent band.
 */
const dragRowOnto = async (
  page: Page,
  source: ReturnType<Page["locator"]>,
  target: ReturnType<Page["locator"]>,
  band: "top" | "middle" | "bottom",
) => {
  await source.hover();
  const handle = source.locator('[title="Drag to reorder"]').first();
  await expect(handle).toBeAttached();
  const handleBox = await handle.boundingBox();
  const targetBox = await target.boundingBox();
  expect(handleBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  if (!handleBox || !targetBox) return;
  const releaseY =
    band === "top"
      ? targetBox.y + 2
      : band === "middle"
        ? targetBox.y + targetBox.height / 2
        : targetBox.y + targetBox.height - 2;
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  // Clear the PointerSensor's 5px activation distance before travelling, so the
  // drag is genuinely active for the whole move.
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2 - 8, {
    steps: 4,
  });
  await page.mouse.move(targetBox.x + targetBox.width / 2, releaseY, { steps: 16 });
  await page.mouse.up();
};

const workspaceRow = (page: Page, name: string) =>
  page
    .locator('[data-sidebar="group"]')
    .filter({ hasText: /^Workspace/ })
    .locator("li")
    .filter({ has: page.getByRole("link", { name, exact: true }) })
    .last();

const expandFolder = async (page: Page, folderName: string) => {
  const row = workspaceRow(page, folderName);
  await expect(row).toBeVisible({ timeout: RENDER_TIMEOUT });
  await row.locator('button[title="Toggle"]').first().click();
};

test("reordering children inside a folder keeps them inside that folder", async ({
  page,
  request,
}) => {
  const suffix = uniqueSuffix();
  const folder = await createNode(request, {
    nodeType: "folder",
    name: `Drag Folder ${suffix}`,
    slug: `drag-folder-${suffix}`,
  });
  // FOUR children, and the drag runs from the last to the first. The failure was
  // distance-dependent — the further the row travels, the further the old
  // flat-list strategy shifted every rect, and the more reliably the parent
  // folder header stole the collision. A one-row hop still landed correctly by
  // luck, so a two-child fixture would not have caught the bug at all
  // (verified: it passes on the pre-fix code).
  const children: CreatedNode[] = [];
  for (const index of [1, 2, 3, 4]) {
    children.push(
      await createNode(request, {
        nodeType: "doc",
        name: `Drag Child ${index} ${suffix}`,
        slug: `drag-child-${index}-${suffix}`,
        parentNodeId: folder.id,
      }),
    );
  }
  const first = children[0];
  const last = children[children.length - 1];

  await page.goto("/dashboard/local/home");
  await expandFolder(page, folder.name);

  const firstRow = workspaceRow(page, first.name);
  const lastRow = workspaceRow(page, last.name);
  await expect(firstRow).toBeVisible({ timeout: RENDER_TIMEOUT });
  await expect(lastRow).toBeVisible();

  await dragRowOnto(page, lastRow, firstRow, "top");

  // TWO assertions, and both are load-bearing:
  //  - the reorder actually happened (the dragged row is now first). Without
  //    this a drag that silently does nothing would pass the check below.
  //  - it is STILL parented to the folder, not promoted to the workspace root.
  //    This is the original bug.
  await expect
    .poll(async () => (await childIdsOf(request, folder.id))[0], { timeout: RENDER_TIMEOUT })
    .toBe(last.id);
  expect(await parentIdOf(request, last.id)).toBe(folder.id);
});

test("dropping onto the middle of a folder row reparents into that folder", async ({
  page,
  request,
}) => {
  const suffix = uniqueSuffix();
  const folder = await createNode(request, {
    nodeType: "folder",
    name: `Drop Target ${suffix}`,
    slug: `drop-target-${suffix}`,
  });
  const loose = await createNode(request, {
    nodeType: "doc",
    name: `Drop Loose ${suffix}`,
    slug: `drop-loose-${suffix}`,
  });

  await page.goto("/dashboard/local/home");
  const folderRow = workspaceRow(page, folder.name);
  const looseRow = workspaceRow(page, loose.name);
  await expect(folderRow).toBeVisible({ timeout: RENDER_TIMEOUT });
  await expect(looseRow).toBeVisible();

  await dragRowOnto(page, looseRow, folderRow, "middle");

  await expect
    .poll(async () => parentIdOf(request, loose.id), { timeout: RENDER_TIMEOUT })
    .toBe(folder.id);
  expect(await childIdsOf(request, folder.id)).toContain(loose.id);
});

test("a folder cannot be dropped inside its own descendant", async ({ page, request }) => {
  const suffix = uniqueSuffix();
  const parent = await createNode(request, {
    nodeType: "folder",
    name: `Cycle Parent ${suffix}`,
    slug: `cycle-parent-${suffix}`,
  });
  const child = await createNode(request, {
    nodeType: "folder",
    name: `Cycle Child ${suffix}`,
    slug: `cycle-child-${suffix}`,
    parentNodeId: parent.id,
  });
  const parentBefore = await parentIdOf(request, parent.id);

  await page.goto("/dashboard/local/home");
  await expandFolder(page, parent.name);

  const parentRow = workspaceRow(page, parent.name);
  const childRow = workspaceRow(page, child.name);
  await expect(childRow).toBeVisible({ timeout: RENDER_TIMEOUT });

  await dragRowOnto(page, parentRow, childRow, "middle");

  // Rejected drops must be inert, not "applied then rolled back" — give the
  // request a window to land before asserting nothing changed.
  await page.waitForTimeout(2_000);
  expect(await parentIdOf(request, parent.id)).toBe(parentBefore);
  expect(await parentIdOf(request, child.id)).toBe(parent.id);
});

test("a favorited node does not register a second drag row", async ({ page, request }) => {
  const suffix = uniqueSuffix();
  const folder = await createNode(request, {
    nodeType: "folder",
    name: `Fav Folder ${suffix}`,
    slug: `fav-folder-${suffix}`,
  });

  await page.goto("/dashboard/local/home");
  const folderRow = workspaceRow(page, folder.name);
  await expect(folderRow).toBeVisible({ timeout: RENDER_TIMEOUT });

  await folderRow.hover();
  await folderRow.locator('button[title="More"]').first().click();
  await page.getByRole("menuitem", { name: /Add to Favorites/ }).click();

  const favoritesGroup = page
    .locator('[data-sidebar="group"]')
    .filter({ hasText: /^Favorites/ })
    .first();
  await expect(favoritesGroup.getByRole("link", { name: folder.name, exact: true })).toBeVisible({
    timeout: RENDER_TIMEOUT,
  });

  // Favorites mirrors ids the Workspace tree already owns. Registering them a
  // second time gave one dnd-kit id two DOM rows, which lit the drop indicator
  // on both at once and left the drop target ambiguous.
  await expect(favoritesGroup.locator('[title="Drag to reorder"]')).toHaveCount(0);
});
