import { type APIRequestContext, cmsPostFields, expect, json, test, unique } from "./_fixtures";

interface BaseVO {
  id: string;
  slug: string;
}

interface NodeVO {
  id: string;
  children?: NodeVO[];
}

const snapshotRequest = (url: string) => /changeRequests(?:%2F|\/|\.)inboxSnapshot/i.test(url);
const legacyInboxRequest = (url: string) =>
  /changeRequests(?:%2F|\/|\.)(?:counts|listPage|list)(?:\?|%3F|$)/i.test(url);

const logicalRpcUrls = (url: string, postData: string | null): string[] => {
  if (!url.includes("/api/rpc")) return [];
  if (!url.includes("/__batch__") || !postData) return [url];
  try {
    const batch = JSON.parse(postData) as Array<{ url?: unknown }>;
    return batch.flatMap((entry) => (typeof entry.url === "string" ? [entry.url] : []));
  } catch {
    // Keep an unparsable batch visible to the assertions instead of silently
    // treating it as zero RPCs.
    return [url];
  }
};

const getBlogBase = async (request: APIRequestContext) => {
  const bases = await json<BaseVO[]>(await request.get("/api/v1/bases"));
  const base = bases.find((candidate) => candidate.slug === "blog");
  if (!base) throw new Error("Blog base not found - seed the E2E database first");
  return base;
};

const flattenNodes = (nodes: NodeVO[]): NodeVO[] =>
  nodes.flatMap((node) => [node, ...flattenNodes(node.children ?? [])]);

test("Inbox refreshes one snapshot per user-visible reconciliation", async ({ page, request }) => {
  test.setTimeout(120_000);
  const calls: string[] = [];
  page.on("request", (browserRequest) => {
    calls.push(...logicalRpcUrls(browserRequest.url(), browserRequest.postData()));
  });

  await page.goto("/dashboard/local/inbox");
  await expect(page.getByTestId("inbox-view-tabs")).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => calls.filter(snapshotRequest).length).toBe(1);
  expect(calls.filter(legacyInboxRequest)).toHaveLength(0);

  // A write publishes `created` plus `pending_review`; the live batching window
  // must turn that pair into one active snapshot refetch.
  calls.length = 0;
  const blog = await getBlogBase(request);
  const title = unique("Inbox request count");
  await json(
    await request.post(`/api/v1/bases/${blog.id}/change-requests`, {
      data: {
        fields: cmsPostFields({ title, body: "Request-count integration fixture." }),
        message: "Create request-count integration fixture",
        submittedBy: "e2e-agent",
        autoMerge: false,
      },
    }),
  );
  await expect.poll(() => calls.filter(snapshotRequest).length, { timeout: 15_000 }).toBe(1);
  await page.waitForTimeout(700);
  expect(calls.filter(snapshotRequest)).toHaveLength(1);

  // Metadata changes update nodes/activity only and must not touch any CR read.
  calls.length = 0;
  const nodes = flattenNodes(await json<NodeVO[]>(await request.get("/api/v1/nodes")));
  const node = nodes.find((candidate) => candidate.id);
  if (!node) throw new Error("No node available for metadata update fixture");
  await json(
    await request.patch(`/api/v1/nodes/${node.id}/metadata`, {
      data: { metadata: { e2eRequestCountAt: new Date().toISOString() } },
    }),
  );
  await page.waitForTimeout(1_000);
  expect(calls.filter((url) => snapshotRequest(url) || legacyInboxRequest(url))).toHaveLength(0);

  // Browsers fire focus and visibility signals together. The workspace gate
  // reconciles once, so the active Inbox query must issue exactly one request.
  calls.length = 0;
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => calls.filter(snapshotRequest).length, { timeout: 15_000 }).toBe(1);
  await page.waitForTimeout(500);
  expect(calls.filter(snapshotRequest)).toHaveLength(1);

  // The local host sits outside SPAWrapper, so its counts observer has to follow
  // Wouter's client navigation explicitly. Home may own the standalone counts
  // query; navigating back to Inbox must disable it before the snapshot mounts.
  await page.getByRole("link", { exact: true, name: "Home" }).click();
  await expect(page).toHaveURL(/\/dashboard\/local\/home$/);
  await page.waitForTimeout(1_000);
  calls.length = 0;
  await page.getByRole("link", { exact: true, name: "Inbox" }).click();
  await expect(page.getByTestId("inbox-view-tabs")).toBeVisible();
  await expect.poll(() => calls.filter(snapshotRequest).length).toBe(1);
  expect(calls.filter(legacyInboxRequest)).toHaveLength(0);
});
