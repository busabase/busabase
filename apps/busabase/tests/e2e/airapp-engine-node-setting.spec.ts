import { expect, json, test, unique } from "./_fixtures";

/**
 * The engine override is a property of the NODE, not of the browser looking at
 * it.
 *
 * It used to live in `localStorage`, which made "which engine this AirApp runs
 * on" per-person: two people opening the same node got different answers, and
 * the choice did not travel with the node the way every other node setting
 * does. These assertions are only meaningful against a real server — a second
 * browser context is the whole point.
 */

test.setTimeout(240_000);
const RUN_READY_TIMEOUT = 180_000;

const slugify = (v: string) =>
  v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const PKG = JSON.stringify(
  {
    name: "engine-node-setting",
    private: true,
    type: "module",
    scripts: { dev: "node server.js", start: "node server.js" },
  },
  null,
  2,
);

const SERVER_JS = `import http from "node:http";
const port = Number(process.env.PORT || 3000);
const runtime = process.env.BUSABASE_AIRAPP_RUNTIME ?? "standalone";
http
  .createServer((_q, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(\`<body><h1>runtime: \${runtime}</h1></body>\`);
  })
  .listen(port, () => console.log(\`listening on port \${port}\`));
`;

test("the engine override lives on the node, and survives a different browser", async ({
  page,
  request,
  browser,
}) => {
  const name = unique("e2e engine node setting");
  const slug = slugify(name);
  const created = await json<{ node: { id: string } }>(
    await request.post("/api/v1/file-trees", {
      data: {
        type: "airapp",
        autoMerge: true,
        slug,
        name,
        files: [
          { path: "package.json", content: PKG },
          { path: "server.js", content: SERVER_JS },
          // Pins an engine this deployment does not have. If the node override
          // were not being honoured, the run would fail to find an engine
          // rather than quietly succeeding on the override.
          { path: "airapp.json", content: JSON.stringify({ preferredEngine: "remote" }, null, 2) },
        ],
      },
    }),
  );
  const nodeId = created.node.id;

  // Nothing saved yet: the node reports no override, so the app decides.
  const before = await json<{ node: { settings?: { airappEngine?: string | null } } }>(
    await request.get(`/api/v1/nodes/${nodeId}?type=airapp`),
  );
  expect(before.node.settings?.airappEngine ?? null).toBeNull();

  // Save an override through the node's own endpoint — not localStorage.
  const patched = await json<{ settings?: { airappEngine?: string | null } }>(
    await request.patch(`/api/v1/nodes/${nodeId}/settings`, {
      data: { settings: { airappEngine: "browser" } },
    }),
  );
  expect(patched.settings?.airappEngine).toBe("browser");

  // A FRESH browser context — no shared localStorage — gets the same answer,
  // which is the property the old storage could not provide.
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.goto(`/dashboard/local/airapp/${slug}`);
  await expect(
    otherPage
      .frameLocator('[data-dashboard-active-view] iframe[title="AirApp preview"]:visible')
      .getByText("runtime: browser"),
  ).toBeVisible({ timeout: RUN_READY_TIMEOUT });
  await otherPage.screenshot({ path: "/tmp/ns-shots/01-override-travels-with-node.png" });
  await other.close();

  // Clearing it returns the node to following its airapp.json.
  const cleared = await json<{ settings?: { airappEngine?: string | null } }>(
    await request.patch(`/api/v1/nodes/${nodeId}/settings`, {
      data: { settings: { airappEngine: null } },
    }),
  );
  expect(cleared.settings?.airappEngine ?? null).toBeNull();

  // And an unknown key is refused rather than stored — the difference between
  // this and the free-form metadata bag.
  const rejected = await request.patch(`/api/v1/nodes/${nodeId}/settings`, {
    data: { settings: { somethingElse: "x" } },
  });
  expect(rejected.status()).toBeGreaterThanOrEqual(400);

  await page.close();
});
