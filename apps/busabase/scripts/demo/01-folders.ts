/**
 * 01-folders: GET /folders + GET /nodes
 * Verifies the seeded folder tree is visible via the API.
 */

import { api, approveMerge, assert, BASE, makeRunner } from "./_client";
import { DEMO_FOLDERS } from "./_data";
import { STANDARD_DEMO_FOLDERS } from "./_nodes";

interface NodeVO {
  id: string;
  slug: string;
  name: string;
  type: string;
  children?: NodeVO[];
}

interface FolderVO {
  node: NodeVO;
  children: NodeVO[];
}

export async function run() {
  const { step, summary } = makeRunner("01-folders");
  console.log(`\n📁  Folders  →  ${BASE}\n`);

  let nodes: NodeVO[] = [];
  let folders: FolderVO[] = [];

  await step("GET /nodes returns a node list", async () => {
    nodes = await api<NodeVO[]>("GET", "/nodes");
    assert(Array.isArray(nodes), "expected array");
    assert(nodes.length > 0, `expected nodes, got ${nodes.length}`);
  });

  await step("GET /nodes — root node present", async () => {
    const root = nodes.find((n) => n.type === "folder" && n.slug === "root");
    assert(!!root, "root folder not found in /nodes");
  });

  await step("GET /folders returns folder list", async () => {
    folders = await api<FolderVO[]>("GET", "/folders");
    assert(Array.isArray(folders), "expected array");
    assert(folders.length > 0, `expected folders, got ${folders.length}`);
  });

  // Self-seed: ensure each demo category folder exists. Older demo instances were
  // seeded before these folders were added to the dataset (`db:seed:all` is additive
  // but may not have been re-run since), so create any missing folder over the API.
  await step("ensure demo category folders exist (idempotent self-seed)", async () => {
    const root = nodes.find((n) => n.type === "folder" && n.slug === "root");
    if (!root) return;
    let created = 0;
    for (const def of STANDARD_DEMO_FOLDERS) {
      if (folders.some((f) => f.node.slug === def.slug)) continue;
      const cr = await api<{ id: string }>("POST", "/nodes/change-requests", {
        message: `demo: ensure folder ${def.slug}`,
        submittedBy: "demo-script",
        operations: [
          {
            kind: "create",
            nodeType: "folder",
            slug: def.slug,
            name: def.name,
            description: def.description,
            parentNodeId: root.id,
          },
        ],
      });
      await approveMerge(cr.id);
      created++;
    }
    // Refresh so the assertions below see any newly-created folders.
    folders = await api<FolderVO[]>("GET", "/folders");
    process.stdout.write(`     info: created ${created} missing folder(s)\n`);
  });

  // Verify each DEMO_FOLDER slug appears (seeded by store.ts — same data source)
  for (const def of DEMO_FOLDERS) {
    await step(`GET /folders — seeded folder "${def.name}" present`, async () => {
      const found = folders.find((f) => f.node.slug === def.slug);
      assert(!!found, `folder slug "${def.slug}" not found`);
    });
  }

  await step("GET /folders/{nodeId} — Content folder has children", async () => {
    const contentFolder = folders.find((f) => f.node.slug === "content");
    if (!contentFolder) return; // skip if not seeded yet
    const detail = await api<FolderVO>("GET", `/folders/${contentFolder.node.id}`);
    assert(detail.node.slug === "content", "slug mismatch");
    assert(Array.isArray(detail.children), "children must be array");
  });

  return summary();
}

if (process.argv[1]?.endsWith("01-folders.ts")) {
  run().then(({ fail }) => {
    if (fail > 0) process.exit(1);
  });
}
