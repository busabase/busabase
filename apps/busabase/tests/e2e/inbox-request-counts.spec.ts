import {
  type APIRequestContext,
  cmsPostFields,
  expect,
  json,
  reviewOne,
  test,
  unique,
} from "./_fixtures";

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
  /changeRequests(?:%2F|\/|\.)(?:counts|reviewCount|listPage|list)(?:\?|%3F|$)/i.test(url);

const reviewCountRequest = (url: string) =>
  /changeRequests(?:%2F|\/|\.)reviewCount(?:\?|%3F|$)/i.test(url);
const fullCountsRequest = (url: string) =>
  /changeRequests(?:%2F|\/|\.)counts(?:\?|%3F|$)/i.test(url);

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

test("Home uses the review-only count and keeps the Inbox badge current", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(180_000);
  const calls: string[] = [];
  page.on("request", (browserRequest) => {
    calls.push(...logicalRpcUrls(browserRequest.url(), browserRequest.postData()));
  });

  await page.goto("/");
  await expect(page).toHaveURL(/\/dashboard\/local\/home$/);
  const baseline = await json<{ review: number }>(
    await request.get("/api/v1/change-requests/counts"),
  );
  await expect.poll(() => calls.filter(reviewCountRequest).length).toBeGreaterThan(0);
  if (baseline.review > 0) {
    await expect(page.getByText(`${baseline.review} pending`, { exact: true })).toBeVisible();
  } else {
    await expect(page.getByRole("heading", { name: "Waiting for your review" })).toHaveCount(0);
  }
  expect(calls.filter(fullCountsRequest)).toHaveLength(0);
  await page.screenshot({ path: testInfo.outputPath("01-home-review-only.png"), fullPage: true });

  const blog = await getBlogBase(request);
  const proposal = await json<{ id: string }>(
    await request.post(`/api/v1/bases/${blog.id}/change-requests`, {
      data: {
        fields: cmsPostFields({ title: unique("Review badge"), body: "Review badge fixture." }),
        submittedBy: "e2e-agent",
        autoMerge: false,
      },
    }),
  );
  try {
    await expect(page.getByText(`${baseline.review + 1} pending`, { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("02-home-new-review.png"), fullPage: true });

    calls.length = 0;
    await page.getByRole("link", { name: /Review all/ }).click();
    await expect(page.getByTestId("inbox-view-tabs")).toBeVisible();
    await expect(
      page.getByRole("link", { name: `For review ${baseline.review + 1}`, exact: true }),
    ).toBeVisible();
    const badge = page
      .getByRole("link", { name: "Inbox", exact: true })
      .locator("..")
      .locator('[data-sidebar="menu-badge"]');
    await expect(badge).toHaveText(String(baseline.review + 1));
    expect(calls.filter(reviewCountRequest)).toHaveLength(0);
    expect(calls.filter(fullCountsRequest)).toHaveLength(0);
    await page.screenshot({
      path: testInfo.outputPath("03-inbox-shared-count.png"),
      fullPage: true,
    });

    await page.getByRole("link", { name: "Home", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/local\/home/);
    await reviewOne(request, proposal.id, "approved");
    if (baseline.review > 0) {
      await expect(page.getByText(`${baseline.review} pending`, { exact: true })).toBeVisible();
      await expect(badge).toHaveText(String(baseline.review));
    } else {
      await expect(page.getByRole("heading", { name: "Waiting for your review" })).toHaveCount(0);
      await expect(badge).toHaveCount(0);
    }
    expect(calls.filter(fullCountsRequest)).toHaveLength(0);
    await page.screenshot({
      path: testInfo.outputPath("04-home-review-resolved.png"),
      fullPage: true,
    });
  } finally {
    await request.post(`/api/v1/change-requests/${proposal.id}/close`, { data: {} });
  }
});

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
