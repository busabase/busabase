// OSS (self-hosted) twin of the Busabase Cloud live-sync reconnect browser story.
// Assertions are identical; only auth/session setup differs (OSS has none).
import { expect, test } from "@playwright/test";
import { splitBatches } from "./helpers/split-batches";

// OSS / self-hosted: single local space, no auth session. Requires an isolated PGlite dir.
const spaceId = process.env.LIVE_SYNC_E2E_SPACE_ID ?? "local";
test.skip(
  process.env.LIVE_SYNC_E2E_ISOLATED_OSS !== "1",
  "Requires an isolated local OSS server (LIVE_SYNC_E2E_ISOLATED_OSS=1)",
);
test.setTimeout(240_000);

interface LiveFaultControl {
  connections: number;
  disconnect: () => void;
}

test("a reader recovers missed changes without cancelling a slow read or fetching hidden pages", async ({
  page,
}, testInfo) => {
  const rpc = async (procedure: string, input: unknown) => {
    const response = await page.request.post(`/api/rpc/${procedure}`, {
      data: { json: input },
    });
    expect(response.ok(), `${procedure}: ${response.status()} ${await response.text()}`).toBe(true);
    return (await response.json()).json;
  };
  await splitBatches(page);
  await page.addInitScript(() => {
    const fetchReal = window.fetch.bind(window);
    const control: LiveFaultControl = { connections: 0, disconnect: () => {} };
    Object.assign(window, { __liveSyncFault: control });
    window.fetch = async (input, init) => {
      const request = new Request(input, init);
      if (!new URL(request.url).pathname.endsWith("/live/subscribe")) {
        return fetchReal(request);
      }
      control.connections++;
      const abort = new AbortController();
      const upstream = fetchReal(request, {
        signal: AbortSignal.any([request.signal, abort.signal]),
      });
      let closed = false;
      // Proxy real SSE bytes unchanged. Closing just this transport injects an
      // event gap while every read/write still reaches the real local server.
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            control.disconnect = () => {
              if (closed) return;
              closed = true;
              controller.close();
              abort.abort();
            };
            void (async () => {
              try {
                const response = await upstream;
                if (closed) return;
                if (!response.ok || !response.body) throw new Error(`SSE ${response.status}`);
                const reader = response.body.getReader();
                while (!closed) {
                  const { done, value } = await reader.read();
                  if (closed) return;
                  if (done) {
                    closed = true;
                    controller.close();
                    return;
                  }
                  controller.enqueue(value);
                }
              } catch (error) {
                if (!closed) {
                  closed = true;
                  controller.error(error);
                }
              }
            })();
          },
          cancel() {
            closed = true;
            abort.abort();
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    };
  });

  const shot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`);
    await page.screenshot({ path, fullPage: true });
    await testInfo.attach(name, { path, contentType: "image/png" });
  };
  const connections = () =>
    page.evaluate(
      () =>
        (window as unknown as { __liveSyncFault: LiveFaultControl }).__liveSyncFault.connections,
    );
  const disconnect = () =>
    page.evaluate(() =>
      (window as unknown as { __liveSyncFault: LiveFaultControl }).__liveSyncFault.disconnect(),
    );
  const run = Date.now();
  const base = await rpc("bases/create", {
    autoMerge: true,
    name: `Reconnect review ${run}`,
    slug: `reconnect-review-${run}`,
    fields: [{ slug: "title", name: "Title", type: "text", required: true }],
  });
  let releaseOld = () => {};
  let listRequests = 0;
  let holdNext = false;
  let heldSnapshot = false;
  let heldCancelled = false;
  let heldRequest: import("@playwright/test").Request | undefined;
  page.on("requestfailed", (request) => {
    if (request === heldRequest) heldCancelled = true;
  });
  try {
    const record = await rpc("bases/createChangeRequest", {
      baseId: base.id,
      autoMerge: true,
      fields: { title: "Before the connection gap" },
    });
    await page.route("**/api/rpc/records/listPage", async (route) => {
      if (route.request().postDataJSON()?.json?.baseId !== base.id) {
        await route.continue();
        return;
      }
      listRequests++;
      if (!holdNext) {
        await route.continue();
        return;
      }
      holdNext = false;
      heldRequest = route.request();
      const response = await route.fetch();
      expect(await response.text()).toContain("Before the connection gap");
      const released = new Promise<void>((resolve) => {
        releaseOld = resolve;
      });
      heldSnapshot = true;
      await released;
      await route.fulfill({ response });
    });
    await page.goto(`/dashboard/${spaceId}/home`, { waitUntil: "commit" });
    const baseLink = page.locator(`a[href*="/base/${base.slug}"]`).first();
    await expect(baseLink).toBeVisible({ timeout: 120_000 });
    await baseLink.click();
    const grid = page.getByRole("grid");
    await expect(grid).toContainText("Before the connection gap", { timeout: 60_000 });
    await expect.poll(connections).toBeGreaterThan(0);
    const baselineConnections = await connections();
    const baselineRequests = listRequests;
    await shot("01-reader-opens-current-records");

    holdNext = true;
    await disconnect();
    await expect.poll(() => heldSnapshot, { timeout: 30_000 }).toBe(true);
    // The second gap must be outside the existing five-second reconnect gate.
    await page.waitForTimeout(5_100);
    await disconnect();
    await rpc("records/changeRequest", {
      operation: "update",
      recordId: record.id,
      autoMerge: true,
      fields: { title: "Recovered after the slow response" },
    });
    await expect.poll(connections, { timeout: 30_000 }).toBe(baselineConnections + 2);
    expect(listRequests).toBe(baselineRequests + 1);
    expect(heldCancelled).toBe(false);
    await shot("02-old-read-still-in-flight-after-reconnect");
    releaseOld();
    await expect(grid).toContainText("Recovered after the slow response", { timeout: 30_000 });
    expect(listRequests).toBe(baselineRequests + 2);
    expect(heldCancelled).toBe(false);
    await shot("03-trailing-read-shows-canonical-value");

    await page.locator('a[href$="/home"]').first().click();
    await expect(grid).toHaveCount(0);
    await page.waitForTimeout(5_100);
    const beforeHiddenGap = listRequests;
    await disconnect();
    await rpc("records/changeRequest", {
      operation: "update",
      recordId: record.id,
      autoMerge: true,
      fields: { title: "Fresh when the reader returns" },
    });
    await expect.poll(connections, { timeout: 30_000 }).toBe(baselineConnections + 3);
    // Wait for the active Home reconciliation, not just the subscription call.
    await page.waitForTimeout(500);
    expect(listRequests).toBe(beforeHiddenGap);
    await shot("04-home-does-not-fetch-hidden-records");
    await baseLink.click();
    await expect(grid).toContainText("Fresh when the reader returns", { timeout: 30_000 });
    expect(listRequests).toBe(beforeHiddenGap + 1);
    await shot("05-returning-reader-sees-latest-records");
  } finally {
    releaseOld();
    await page.unrouteAll({ behavior: "wait" });
    await rpc("nodes/createChangeRequest", {
      autoMerge: true,
      message: "Archive isolated live-sync verification fixture",
      operations: [{ kind: "delete", nodeId: base.nodeId }],
    });
  }
});
