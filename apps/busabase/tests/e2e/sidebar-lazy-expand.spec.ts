import { expect, type Page, test } from "./_fixtures";

const RENDER_TIMEOUT = 45_000;
test.setTimeout(120_000);

/**
 * Regression cover for the sidebar's lazy per-folder expand.
 *
 * The tree is fetched depth-bounded (`nodes.list({ parentId: null, depth: 2 })`
 * = root + 2 levels); anything deeper only arrives when the sidebar asks for a
 * specific folder's children. It used to ask ONLY from the collapsible's
 * `onOpenChange`, i.e. only when the chevron was toggled — but a folder row
 * also opens with no toggle event at all, because it is open whenever it (or a
 * descendant) is the active route. So CLICKING a folder's name, which is what
 * everyone actually does, navigated into it, expanded its row, and then
 * rendered nothing underneath: the fetch was never kicked off. Its own detail
 * page listed the children the whole time, which is what made it read as "the
 * sidebar is lying" rather than "nothing loaded".
 *
 * Only folders past the prefetch depth could show it, and the seeded demo tree
 * was one level deep everywhere, so this needs its own deep chain. Five levels,
 * not three: expanding L2 eagerly carries two levels with it (L3 + L4), so L4
 * is the first folder that needs a SECOND lazy fetch — which is the only way to
 * cover merging a lazily-fetched subtree into an already-lazily-fetched one.
 */

interface CreatedNode {
  id: string;
  name: string;
  slug: string;
}

const uniqueSuffix = () => `${Date.now()}-${Math.floor(Math.random() * 100_000)}`;

/**
 * Create a node through the public REST API. Node creation is a reviewable
 * operation, so this posts a ChangeRequest with `autoMerge`; the new id comes
 * back in `mergeSummary.mergedNodeIds`, not in the (null) `node` field.
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
  return { id: id as string, name: node.name, slug: node.slug };
};

const workspaceRow = (page: Page, name: string) =>
  page
    .locator('[data-sidebar="group"]')
    .filter({ hasText: /^Workspace/ })
    .locator("li")
    .filter({ has: page.getByRole("link", { name, exact: true }) })
    .last();

/** Click a sidebar folder's NAME (navigate into it), not its chevron. */
const openFolderByName = async (page: Page, name: string) => {
  await workspaceRow(page, name).getByRole("link", { name, exact: true }).first().click();
};

test("navigating into a folder loads its children in the sidebar, at any depth", async ({
  page,
  request,
}) => {
  const suffix = uniqueSuffix();
  const chain: CreatedNode[] = [];
  let parentNodeId: string | undefined;
  for (const level of [1, 2, 3, 4]) {
    const node = await createNode(request, {
      nodeType: "folder",
      name: `Lazy L${level} ${suffix}`,
      slug: `lazy-l${level}-${suffix}`,
      parentNodeId,
    });
    chain.push(node);
    parentNodeId = node.id;
  }
  const [level1, level2, level3, level4] = chain;
  const leaf = await createNode(request, {
    nodeType: "doc",
    name: `Lazy Leaf ${suffix}`,
    slug: `lazy-leaf-${suffix}`,
    parentNodeId,
  });

  await page.goto("/dashboard/local/home");

  // The eager prefetch reaches L2 and stops. L1's children are already loaded,
  // so opening it is a pure UI toggle and proves nothing about lazy loading —
  // it is only how L2's row gets on screen.
  const level1Row = workspaceRow(page, level1.name);
  await expect(level1Row).toBeVisible({ timeout: RENDER_TIMEOUT });
  await level1Row.locator('button[title="Toggle"]').first().click();
  await expect(workspaceRow(page, level2.name)).toBeVisible({ timeout: RENDER_TIMEOUT });
  // Nothing below the prefetch boundary is in the tree yet.
  await expect(workspaceRow(page, level3.name)).toHaveCount(0);

  // The regression: navigate into L2 by its name. Its row opens because it is
  // now the active route — never because of a toggle event — and its children
  // still have to load.
  await openFolderByName(page, level2.name);
  await expect(workspaceRow(page, level3.name)).toBeVisible({ timeout: RENDER_TIMEOUT });

  // L4 rode along with that same fetch (two levels per expand), so opening L3
  // needs no fetch at all — but L4's own child was NOT part of it.
  await openFolderByName(page, level3.name);
  await expect(workspaceRow(page, level4.name)).toBeVisible({ timeout: RENDER_TIMEOUT });
  await expect(workspaceRow(page, leaf.name)).toHaveCount(0);

  // Second lazy fetch, merged into a subtree that itself arrived lazily.
  await openFolderByName(page, level4.name);
  await expect(workspaceRow(page, leaf.name)).toBeVisible({ timeout: RENDER_TIMEOUT });
});

/**
 * The other half of the same deadlock, and the one a URL bar hits directly.
 *
 * Clicking down the tree works because each folder you click becomes the
 * active route itself. LANDING on a deep url does not: a refresh, a bookmark,
 * a shared link or a "recently visited" jump renders the sidebar with only its
 * depth-bounded prefetch, so the active node's ancestors have never been
 * fetched — and an ancestor that has not been fetched cannot be recognised as
 * one. Nothing expands, so nothing loads, so nothing can ever expand, and the
 * sidebar sits fully collapsed while the page it is supposedly reflecting is
 * four levels down. `nodes.ancestors` is what breaks it.
 */
test("landing directly on a deep url expands the sidebar down to it", async ({ page, request }) => {
  const suffix = uniqueSuffix();
  const chain: CreatedNode[] = [];
  let parentNodeId: string | undefined;
  for (const level of [1, 2, 3, 4]) {
    const node = await createNode(request, {
      nodeType: "folder",
      name: `Deep L${level} ${suffix}`,
      slug: `deep-l${level}-${suffix}`,
      parentNodeId,
    });
    chain.push(node);
    parentNodeId = node.id;
  }
  const [level1, level2, level3, level4] = chain;
  // A doc at the bottom, so this covers the shape a shared link usually has —
  // a document deep inside a folder tree — and so the active assertion below
  // can read `data-active`, which only leaf rows carry (a folder row shows its
  // active state through a background class instead).
  const leaf = await createNode(request, {
    nodeType: "doc",
    name: `Deep Leaf ${suffix}`,
    slug: `deep-leaf-${suffix}`,
    parentNodeId,
  });

  // A COLD load straight at the leaf — no prior sidebar interaction, so
  // nothing below the prefetch boundary is in any cache.
  await page.goto(`/dashboard/local/doc/${leaf.slug}`);

  // Every ancestor opened, all four levels of them...
  const leafRow = workspaceRow(page, leaf.name);
  await expect(leafRow).toBeVisible({ timeout: RENDER_TIMEOUT });
  for (const ancestor of [level1, level2, level3, level4]) {
    await expect(workspaceRow(page, ancestor.name)).toBeVisible();
  }
  // ...and the row we actually navigated to is the highlighted one, not merely
  // present — "expanded but nothing selected" would still leave the user lost.
  await expect(leafRow.locator("[data-active='true']")).toBeVisible({
    timeout: RENDER_TIMEOUT,
  });
});

/**
 * Regression cover for the sidebar chevron on the folder you are currently
 * inside — a DIFFERENT bug from the two above, though it lives in the same
 * "the sidebar can't tell what to do with the active route" family.
 *
 * A folder on the active route is pinned open by `isActiveTree`, so Radix's
 * `onOpenChange(!open)` always sends `false` (`open` is always `true`) and
 * clicking the chevron did nothing — not slow, not broken-looking, just
 * completely inert. The fix is a manual override that beats the route-derived
 * default, but ONLY while you stay on the page you collapsed it from: an
 * override that survived navigation would re-hide the very folder you just
 * navigated into, recreating a milder version of the same deadlock.
 *
 * That expiry is the part with a real failure mode of its own — comparing the
 * override's saved location against the CURRENT location, instead of pruning
 * it the moment location changes, cannot tell "never left" from "left and
 * came back to the identical path" (2026 Launch -> Launch Assets -> Brand
 * Kit is exactly that path every time). The second half of this test is
 * exactly that round trip.
 */
test("the chevron on your current folder actually collapses it, and stops mattering once you leave", async ({
  page,
  request,
}) => {
  const suffix = uniqueSuffix();
  const chain: CreatedNode[] = [];
  let parentNodeId: string | undefined;
  for (const level of [1, 2, 3]) {
    const node = await createNode(request, {
      nodeType: "folder",
      name: `Chevron L${level} ${suffix}`,
      slug: `chevron-l${level}-${suffix}`,
      parentNodeId,
    });
    chain.push(node);
    parentNodeId = node.id;
  }
  const [level1, level2, level3] = chain;
  const leaf = await createNode(request, {
    nodeType: "doc",
    name: `Chevron Leaf ${suffix}`,
    slug: `chevron-leaf-${suffix}`,
    parentNodeId,
  });

  await page.goto(`/dashboard/local/folder/${level3.slug}`);
  const leafRow = workspaceRow(page, leaf.name);
  await expect(leafRow).toBeVisible({ timeout: RENDER_TIMEOUT });

  // The folder we are standing inside — collapsing it must actually hide its
  // own children, not silently do nothing.
  const level3Row = workspaceRow(page, level3.name);
  const toggle = level3Row.locator('button[title="Toggle"]').first();
  await expect(level3Row).toHaveAttribute("data-state", "open");
  await toggle.click();
  await expect(level3Row).toHaveAttribute("data-state", "closed");
  await expect(leafRow).toHaveCount(0);

  // Re-expanding, still on the same page, must work too.
  await toggle.click();
  await expect(level3Row).toHaveAttribute("data-state", "open");
  await expect(leafRow).toBeVisible({ timeout: RENDER_TIMEOUT });

  // Collapse it again, then leave the page entirely.
  await toggle.click();
  await expect(level3Row).toHaveAttribute("data-state", "closed");
  await page
    .locator('[data-sidebar="sidebar"], [data-slot="sidebar-container"]')
    .first()
    .getByRole("link", { name: "Home", exact: true })
    .first()
    .click();

  // Click all the way back down through the SAME path — landing on the exact
  // url the collapse was recorded against.
  await workspaceRow(page, level1.name)
    .getByRole("link", { name: level1.name, exact: true })
    .first()
    .click();
  await expect(workspaceRow(page, level2.name)).toBeVisible({ timeout: RENDER_TIMEOUT });
  await workspaceRow(page, level2.name)
    .getByRole("link", { name: level2.name, exact: true })
    .first()
    .click();
  await expect(workspaceRow(page, level3.name)).toBeVisible({ timeout: RENDER_TIMEOUT });
  await workspaceRow(page, level3.name)
    .getByRole("link", { name: level3.name, exact: true })
    .first()
    .click();

  // The stale collapse must not have followed us back: the folder — and the
  // leaf it hid — must be visible again.
  await expect(workspaceRow(page, level3.name)).toHaveAttribute("data-state", "open", {
    timeout: RENDER_TIMEOUT,
  });
  await expect(workspaceRow(page, leaf.name)).toBeVisible({ timeout: RENDER_TIMEOUT });
});

/**
 * Regression cover for a THIRD, separate bug in the same family: even once a
 * deep node's row correctly loads and highlights (the two fixes above), a
 * sidebar tall enough to need scrolling can still land that row somewhere the
 * user never sees — past the visible fold entirely, or sitting exactly behind
 * a fixed sidebar footer (a host-supplied element like "Agent Skills"),
 * which PAINTS OVER the row rather than clipping it out of the layout. Either
 * way it looks, to a user, exactly like the original bug: "I navigated here,
 * the sidebar shows nothing for it."
 *
 * Checks a LEAF node specifically (not a folder): a folder's own `<li>` wraps
 * its header AND its expanded children as one combined box, so testing
 * "what's at its center point" is meaningless once it has visible children —
 * a leaf's `<li>` is exactly its own row, so the center-point occlusion check
 * below is actually asking the right question.
 */
test("a deep node scrolls itself clear of a fixed sidebar footer, without disturbing an already-visible click", async ({
  page,
  request,
}) => {
  const suffix = uniqueSuffix();
  const chain: CreatedNode[] = [];
  let parentNodeId: string | undefined;
  // Deep enough that its own row lands in (or past) a real sidebar footer's
  // band on an ordinary viewport — shallower chains never reach it.
  for (const level of [1, 2, 3, 4] as const) {
    const node = await createNode(request, {
      nodeType: "folder",
      name: `Footer L${level} ${suffix}`,
      slug: `footer-l${level}-${suffix}`,
      parentNodeId,
    });
    chain.push(node);
    parentNodeId = node.id;
  }
  const leaf = await createNode(request, {
    nodeType: "doc",
    name: `Footer Leaf ${suffix}`,
    slug: `footer-leaf-${suffix}`,
    parentNodeId,
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/dashboard/local/doc/${leaf.slug}`);

  const leafRow = workspaceRow(page, leaf.name);
  await expect(leafRow).toBeVisible({ timeout: RENDER_TIMEOUT });

  await expect(async () => {
    const occluded = await leafRow.evaluate((li) => {
      const r = li.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      const inViewport = r.top >= 0 && r.bottom <= window.innerHeight;
      return !inViewport || !top || !li.contains(top);
    });
    expect(occluded).toBe(false);
  }).toPass({ timeout: RENDER_TIMEOUT });

  // An ordinary click on a row that is ALREADY fully visible must not yank
  // the sidebar's scroll position to re-center it underneath the user — that
  // would be its own, milder version of "the sidebar moves on its own".
  //
  // Re-clicks the leaf's OWN row (not a navigation to a different page) on
  // purpose, to isolate this from a real confound: navigating AWAY to a page
  // with nothing on this chain's active path collapses the whole expanded
  // chain (nothing keeps it open anymore), which shrinks the list — and a
  // shrunk list legitimately reflows `scrollTop` via ordinary browser
  // clamping (`scrollHeight - scrollTop` staying pinned to `clientHeight`
  // both before and after), independent of anything this fix does. Clicking
  // the same already-active row changes neither the route nor the tree
  // shape, so it isolates exactly the thing being tested.
  const scrollTopBefore = await page.evaluate(
    () => document.querySelector("[data-busabase-sidebar-nav]")?.scrollTop ?? null,
  );
  await leafRow.getByRole("link", { name: leaf.name, exact: true }).first().click();
  await page.waitForTimeout(500);
  const scrollTopAfter = await page.evaluate(
    () => document.querySelector("[data-busabase-sidebar-nav]")?.scrollTop ?? null,
  );
  expect(scrollTopAfter).toBe(scrollTopBefore);
});
