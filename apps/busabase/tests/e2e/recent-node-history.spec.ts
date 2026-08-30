import { expect, test } from "./_fixtures";

const RENDER_TIMEOUT = 45_000;
test.setTimeout(90_000);

test("sidebar node visits appear in Search Recent in most-recent order", async ({ page }) => {
  await page.goto("/dashboard/local/base/blog?demo=1");

  const pages = page.getByRole("link", { name: "Pages", exact: true });
  const posts = page.getByRole("link", { name: "Posts", exact: true });
  await expect(pages).toBeVisible({ timeout: RENDER_TIMEOUT });

  await pages.click();
  await expect(page).toHaveURL(/\/dashboard\/local\/base\/pages\?demo=1$/);
  await posts.click();
  await expect(page).toHaveURL(/\/dashboard\/local\/base\/blog\?demo=1$/);

  await page.getByRole("button", { name: "Search", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  const postsResult = dialog.getByRole("button").filter({ hasText: "Posts" });
  const pagesResult = dialog.getByRole("button").filter({ hasText: "Pages" });
  await expect(postsResult).toBeVisible();
  await expect(pagesResult).toBeVisible();

  const postsBox = await postsResult.boundingBox();
  const pagesBox = await pagesResult.boundingBox();
  expect(postsBox).not.toBeNull();
  expect(pagesBox).not.toBeNull();
  expect(postsBox?.y).toBeLessThan(pagesBox?.y ?? 0);
});

test("a cold direct URL records a deep node omitted from the sidebar prefetch", async ({
  page,
  request,
}) => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const rootSlug = `recent-direct-a-${suffix}`;
  const docSlug = `recent-direct-doc-${suffix}`;
  const docName = `Recent Direct Doc ${suffix}`;
  const createResponse = await request.post("/api/v1/nodes/change-requests", {
    data: {
      autoMerge: true,
      message: "Create a deep node for Recent direct-link verification",
      operations: [
        { kind: "create", ref: "a", nodeType: "folder", slug: rootSlug, name: "Recent A" },
        {
          kind: "create",
          ref: "b",
          parentNodeRef: "a",
          nodeType: "folder",
          slug: `recent-direct-b-${suffix}`,
          name: "Recent B",
        },
        {
          kind: "create",
          ref: "c",
          parentNodeRef: "b",
          nodeType: "folder",
          slug: `recent-direct-c-${suffix}`,
          name: "Recent C",
        },
        {
          kind: "create",
          parentNodeRef: "c",
          nodeType: "doc",
          slug: docSlug,
          name: docName,
        },
      ],
    },
  });
  expect(createResponse.ok()).toBe(true);
  const created = (await createResponse.json()) as {
    operations: Array<{ nodeId: string | null }>;
    status: string;
  };
  expect(created.status).toBe("merged");
  const rootNodeId = created.operations[0]?.nodeId;
  expect(rootNodeId).toBeTruthy();

  try {
    await page.goto(`/dashboard/local/doc/${docSlug}`);
    await expect(page.getByRole("heading", { name: docName })).toBeVisible({
      timeout: RENDER_TIMEOUT,
    });
    // The sidebar now expands to a cold-loaded deep node's ancestor chain and
    // lazily fetches each folder's children as it unrolls, so this doc's own
    // parent folder ends up expanded too and renders the doc as a sidebar
    // link. That is intentional: a cold direct URL used to leave the sidebar
    // fully collapsed with nothing highlighted. The doc's initial PREFETCH
    // still never reached this deep, which is the setup this test actually
    // needs -- the search hit below still has to come from Recent visits,
    // not from an ordinary always-rendered link.
    await expect(page.getByRole("link", { name: docName, exact: true })).toHaveCount(1);

    await page.getByRole("button", { name: "Search", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button").filter({ hasText: docName })).toBeVisible();
  } finally {
    if (rootNodeId) {
      const cleanupResponse = await request.post("/api/v1/nodes/change-requests", {
        data: {
          autoMerge: true,
          message: "Clean up Recent direct-link verification nodes",
          operations: [{ kind: "delete", nodeId: rootNodeId }],
        },
      });
      expect(cleanupResponse.ok()).toBe(true);
    }
  }
});
