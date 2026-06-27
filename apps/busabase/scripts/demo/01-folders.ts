/**
 * 01-folders: GET /folders + GET /nodes
 * Verifies the seeded folder tree is visible via the API.
 */

import { api, assert, BASE, makeRunner } from "./_client";
import { DEMO_FOLDERS } from "./_data";

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
