/**
 * 14-airapps: create all 7 example AirApp nodes (see `busabase-core/domains/
 * airapp/demo-content` for the full catalog and the Nodepod/Vite/Babel/SWC/
 * HyperFrames investigation behind each one) via the real REST API — the OpenAPI create
 * → approve/merge path, the same one an agent goes through, not the Run
 * panel itself (clicking Run is a browser-only action, not exercised here).
 * Use `webapp-testing` against a live dev server to click Run and see an
 * AirApp actually execute.
 *
 * Places every created node under the "AirApps" sidebar folder (same folder
 * `pnpm db:seed:all` creates via `FILE_TREE_FOLDER_CONFIG` in
 * `busabase-core/logic/seed.ts`), mirroring how `06-skills.ts`/`11-drives.ts`
 * attach their demo nodes to the "Agent Skills"/"Drives" folders instead of
 * leaving them loose at root.
 */

import { ALL_AIRAPP_DEMOS } from "busabase-core/domains/airapp/demo-content";
import { api, assert, BASE, makeRunner, type NodeTreeVO } from "./_client";
import { findFolderBySlug, moveNodeToFolder, needsMove } from "./_nodes";

interface NodeVO {
  id: string;
  slug: string;
  name: string;
  type: string;
}

interface AirAppVO {
  node: NodeVO;
  entryFile: string;
  visibility: string;
  version: string;
  files: Array<{ path: string; name: string }>;
}

interface FileContentVO {
  nodeId: string;
  path: string;
  content: string;
  contentHash: string;
}

export async function run() {
  const { step, summary } = makeRunner("14-airapps");
  console.log(`\n📱  AirApps  →  ${BASE}\n`);

  let parentNodeId: string | undefined;
  let nodes: NodeTreeVO[] = [];
  await step("GET /nodes — locate AirApps folder", async () => {
    nodes = await api<NodeTreeVO[]>("GET", "/nodes");
    parentNodeId = findFolderBySlug(nodes, "airapps")?.node.id;
    assert(!!parentNodeId, "AirApps folder not found; run 01-folders first");
  });

  const created: AirAppVO[] = [];

  for (const def of ALL_AIRAPP_DEMOS) {
    await step(`POST /airapps — create "${def.name}" (idempotent)`, async () => {
      let airapp: AirAppVO;
      try {
        airapp = await api<AirAppVO>("POST", "/airapps", {
          slug: def.slug,
          name: def.name,
          description: def.description,
          files: def.files,
          ...(parentNodeId ? { parentNodeId } : {}),
          autoMerge: true,
          // These demos each hand over a complete, self-contained project
          // (Hono, Vite, SQLite, ...) — replace the default Hono-template
          // seed files entirely rather than merging with them by path, or
          // e.g. the Vite demos would end up with stray server.js/style.css/
          // client.js left over from the default template mixed into an
          // unrelated Vite project.
          mergeMode: "replace",
        });
      } catch {
        const list = await api<AirAppVO[]>("GET", "/airapps");
        const found = list.find((m) => m.node.slug === def.slug);
        assert(!!found, `AirApp "${def.slug}" missing after create failed`);
        airapp = found;
      }
      assert(airapp.node.slug === def.slug, `slug mismatch: ${airapp.node.slug}`);
      assert(airapp.node.type === "airapp", `expected type=airapp, got ${airapp.node.type}`);
      assert(
        airapp.files.length === def.files.length,
        `expected ${def.files.length} files, got ${airapp.files.length}`,
      );
      if (needsMove(nodes, def.slug, "airapps")) {
        await moveNodeToFolder(def.slug, "airapps", nodes);
      }
      created.push(airapp);
    });
  }

  await step("GET /airapps — all created slugs present", async () => {
    const list = await api<AirAppVO[]>("GET", "/airapps");
    const slugs = new Set(list.map((m) => m.node.slug));
    for (const def of ALL_AIRAPP_DEMOS) {
      assert(slugs.has(def.slug), `slug "${def.slug}" missing from GET /airapps`);
    }
  });

  if (created[0]) {
    await step("GET /airapps/{id}/files/package.json — read seeded content", async () => {
      const file = await api<FileContentVO>(
        "GET",
        `/airapps/${created[0].node.id}/files/package.json`,
      );
      assert(file.content.includes("hono-api-demo"), "unexpected package.json content");
      assert(file.contentHash.startsWith("sha256:"), "unexpected hash format");
    });
  }

  return summary();
}

if (process.argv[1]?.endsWith("14-airapps.ts")) {
  run().then(({ fail }) => {
    if (fail > 0) process.exit(1);
  });
}
