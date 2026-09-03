import { expect, json, test, unique } from "./_fixtures";

/**
 * Who wins when the app's `airapp.json` and the person looking at the node
 * disagree about the engine.
 *
 * Only observable in a browser: the precedence is applied client-side, just
 * before the runner is constructed, from two sources that live in different
 * places — a file in the node's own tree, and the override saved on the node
 * itself (`settings.airappEngine`) from the node settings dialog.
 */

test.setTimeout(240_000);
const RUN_READY_TIMEOUT = 180_000;

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const PKG = JSON.stringify(
  {
    name: "engine-pref",
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
  .createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(\`<body><h1>runtime: \${runtime}</h1></body>\`);
  })
  .listen(port, () => console.log(\`listening on port \${port}\`));
`;

const createPinnedApp = async (request: import("@playwright/test").APIRequestContext) => {
  const name = unique("e2e engine pinned remote");
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
          // An engine this deployment does not have. Chosen deliberately: if the
          // manifest were still winning, the run would fail to find an engine
          // instead of quietly succeeding on the user's choice.
          { path: "airapp.json", content: JSON.stringify({ preferredEngine: "remote" }, null, 2) },
        ],
      },
    }),
  );
  return { slug, nodeId: created.node.id };
};

test("an airapp.json engine pin no longer overrides the person, or erases their choice", async ({
  page,
  request,
}) => {
  const { slug, nodeId } = await createPinnedApp(request);

  // Save an explicit choice for this node, the way the node settings dialog
  // does: the override lives ON THE NODE, not in this browser, so it travels
  // with the node instead of being a property of whoever happens to be looking
  // at it. Written through the API because this test is about precedence at run
  // time, not about the dialog's own draft/save behaviour.
  await request.patch(`/api/v1/nodes/${nodeId}/settings`, {
    data: { settings: { airappEngine: "browser" } },
  });

  await page.goto(`/dashboard/local/airapp/${slug}`);

  // It runs — on the engine the person picked, not the one the file pinned.
  const frame = page.frameLocator(
    '[data-dashboard-active-view] iframe[title="AirApp preview"]:visible',
  );
  await expect(frame.getByText("runtime: browser")).toBeVisible({ timeout: RUN_READY_TIMEOUT });

  // And the choice survived the run. It used to be overwritten with whatever
  // actually ran, so a person who set "In browser" came back to find their
  // setting silently changed.
  const detail = await json<{ node: { settings?: { airappEngine?: string | null } } }>(
    await request.get(`/api/v1/nodes/${nodeId}`),
  );
  expect(detail.node.settings?.airappEngine).toBe("browser");
});
