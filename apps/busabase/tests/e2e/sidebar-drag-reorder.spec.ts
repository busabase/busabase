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
 * Shape of a drag gesture, in terms an automated pointer can actually control:
 * how many stops it makes en route (`waypoints`), how many sub-samples each
 * hop between stops gets (`subSteps`), and how much real wall-clock time it
 * spends paused after a stop (`pauseMs` after every stop, `settleMs` as EXTRA
 * time after only the last one, before release).
 *
 * These four knobs cover the realistic space of "how a pointer travels" —
 * a single coarse jump, a normal continuous move, and a hesitant multi-stop
 * drag with real pauses — without claiming to isolate the pre-fix bug's exact
 * mechanism. It turned out NOT to reduce to "fewer samples = worse" or "more
 * wall-clock time = safer": see `DRAG_SPEEDS`'s comment for what was actually
 * observed when every shape below was run against the pre-fix code.
 */
interface DragSpeed {
  /** How many intermediate stops the pointer makes between source and target. */
  waypoints: number;
  /** Playwright `steps` used for the move INTO each waypoint. */
  subSteps: number;
  /** Real-time pause after every waypoint, including the last. */
  pauseMs?: number;
  /** EXTRA real-time pause after only the last waypoint, before `mouse.up()`. */
  settleMs?: number;
}

/**
 * Drag `source` onto a band of `target`, driving real pointer events through the
 * row's grip handle (the row body is deliberately not draggable — dnd-kit's
 * pointer capture on a row wrapping an `<a>` fires a spurious navigation click
 * right after the drop).
 *
 * `band` picks where inside the target row to release: `"top"`/`"bottom"` are the
 * reorder bands, `"middle"` is a folder's reparent band. `speed` defaults to a
 * single normal-paced travel move (see `DEFAULT_DRAG_SPEED`); pass one of
 * `DRAG_SPEEDS` to drive the same gesture with a different waypoint/sample shape.
 */
const DEFAULT_DRAG_SPEED: DragSpeed = { waypoints: 1, subSteps: 16 };

const dragRowOnto = async (
  page: Page,
  source: ReturnType<Page["locator"]>,
  target: ReturnType<Page["locator"]>,
  band: "top" | "middle" | "bottom",
  speed: DragSpeed = DEFAULT_DRAG_SPEED,
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
  // drag is genuinely active for the whole move — always at the default pace,
  // regardless of `speed`: this is setup, not the gesture under test.
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2 - 8, {
    steps: 4,
  });
  const startX = handleBox.x + handleBox.width / 2;
  const startY = handleBox.y + handleBox.height / 2 - 8;
  const targetX = targetBox.x + targetBox.width / 2;
  for (let i = 1; i <= speed.waypoints; i++) {
    const t = i / speed.waypoints;
    await page.mouse.move(startX + (targetX - startX) * t, startY + (releaseY - startY) * t, {
      steps: speed.subSteps,
    });
    if (speed.pauseMs) await page.waitForTimeout(speed.pauseMs);
  }
  if (speed.settleMs) await page.waitForTimeout(speed.settleMs);
  await page.mouse.up();
};

/**
 * The pre-fix bug's dependence on gesture shape, as actually measured against
 * this harness — not assumed. See `tree-drop.ts`'s header comment for the
 * mechanism (rows physically translating mid-drag via a CSS transition the old
 * `SortableContext` code raced against).
 *
 * It is NOT a clean "fast fails, slow succeeds" rule. Every entry below is
 * unhurried by ordinary standards (the fastest, "a single coarse jump", is
 * still the exact fast gesture that broke the pre-fix code in the first
 * investigation of this bug), and on the pre-fix code every one of them
 * failed at least once across repeated runs, including the two explicitly
 * built to be slow and deliberate (`"paused mid-drag…"`, 3/3 failed;
 * `"…pauses on the target before releasing"`, 1/1 failed) and a 14-waypoint,
 * well-paused, 600ms-settled shape modelled on an EARLIER ad hoc manual repro
 * that appeared to succeed reliably outside this harness — through THIS
 * harness it failed 4/4. Only `"a normal drag"` was observed to pass, and
 * inconsistently: it failed the first time this exact profile was run in this
 * investigation and passed the next. That inconsistency is itself the
 * finding: across a controlled, repeatable test harness, no gesture shape
 * tried here was a reliable way to avoid the bug. A user (or an unhurried
 * manual QA pass) has no lever to pull that reliably keeps them safe — which
 * is why it read as "works, until it doesn't" rather than as a predictable
 * "works if you go slow".
 *
 * The fix removes the CSS transition entirely (rows are `useDraggable` +
 * `useDroppable`, never translated) and resolves the drop from live,
 * untransformed rects on every pointer sample, so none of this should matter
 * anymore — every entry below now needs to pass, reliably, every run.
 */
const DRAG_SPEEDS: Record<string, DragSpeed> = {
  "a single coarse jump": { waypoints: 1, subSteps: 1 },
  "a fast flick": { waypoints: 1, subSteps: 3 },
  "a normal drag": { waypoints: 1, subSteps: 16 },
  "a paused-mid-drag gesture that releases the instant it arrives": {
    waypoints: 20,
    subSteps: 1,
    pauseMs: 40,
  },
  "a drag that pauses on the target before releasing": {
    waypoints: 1,
    subSteps: 16,
    settleMs: 500,
  },
  "a slow, many-waypoint drag with a long pause before release": {
    waypoints: 14,
    subSteps: 3,
    pauseMs: 70,
    settleMs: 600,
  },
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

/**
 * The pre-fix bug wasn't reliably reproducible — the SAME gesture landed
 * correctly when driven slowly and moved the node to the root when driven
 * fast (see `tree-drop.ts`'s header comment for the mechanism: the old
 * `SortableContext` translation hadn't "settled" when few pointer samples
 * landed). That is precisely why manual QA calling it "sometimes works" was
 * consistent with the bug being there the whole time — an unhurried manual
 * check sits at the slow end of this spectrum, which is the end that passed.
 *
 * The fix removes rows' CSS transform/transition entirely and resolves the
 * drop from live, untransformed rects on every pointer sample (`tree-drop.ts`
 * + `NavMain.tsx`'s `collisionDetection`), so there is no longer a
 * theoretical reason speed should matter. This block is what turns that
 * "shouldn't" into a tested "doesn't", across the sample-density spectrum
 * from a single coarse jump (fewer samples than the fast gesture that broke
 * the pre-fix code) through a slow, paused drag.
 */
test.describe("reordering inside a folder at every drag speed", () => {
  for (const [speedLabel, speed] of Object.entries(DRAG_SPEEDS)) {
    test(`lands correctly at ${speedLabel}`, async ({ page, request }) => {
      const suffix = uniqueSuffix();
      const folder = await createNode(request, {
        nodeType: "folder",
        name: `Speed Folder ${suffix}`,
        slug: `speed-folder-${suffix}`,
      });
      const children: CreatedNode[] = [];
      for (const index of [1, 2, 3, 4]) {
        children.push(
          await createNode(request, {
            nodeType: "doc",
            name: `Speed Child ${index} ${suffix}`,
            slug: `speed-child-${index}-${suffix}`,
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

      await dragRowOnto(page, lastRow, firstRow, "top", speed);

      // Same dual assertion as the baseline test above: the reorder must have
      // actually happened, AND the node must still be inside the folder — not
      // promoted to the root, which is what the pre-fix code did at the fast
      // end of this spectrum.
      await expect
        .poll(async () => (await childIdsOf(request, folder.id))[0], { timeout: RENDER_TIMEOUT })
        .toBe(last.id);
      expect(await parentIdOf(request, last.id)).toBe(folder.id);
    });
  }
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
