/**
 * 08-nodes: Node tree operations — create folder, rename, move, delete via CR.
 * POST /nodes/change-requests → approve → merge for each operation kind.
 */

import { api, approveMerge, assert, BASE, makeRunner } from "./_client";

interface NodeVO {
  id: string;
  slug: string;
  name: string;
  type: string;
}

interface FolderVO {
  node: NodeVO;
  children: NodeVO[];
}

interface ChangeRequestVO {
  id: string;
  status: string;
}

export async function run() {
  const { step, summary } = makeRunner("08-nodes");
  console.log(`\n🌳  Nodes  →  ${BASE}\n`);

  let nodes: NodeVO[] = [];
  let rootNodeId = "";

  // ── GET /nodes ────────────────────────────────────────────────────────────

  await step("GET /nodes — returns flat node list", async () => {
    nodes = await api<NodeVO[]>("GET", "/nodes");
    assert(Array.isArray(nodes), "expected array");
    assert(nodes.length > 0, "expected nodes");
    const root = nodes.find((n) => n.slug === "root" || n.type === "folder");
    rootNodeId = root?.id ?? "";
  });

  await step("GET /nodes — has folders and bases", async () => {
    const folders = nodes.filter((n) => n.type === "folder");
    const bases = nodes.filter((n) => n.type === "base");
    assert(folders.length > 0, "expected at least one folder");
    assert(bases.length > 0, "expected at least one base");
  });

  // ── Create a demo folder ──────────────────────────────────────────────────

  let demoFolderNodeId = "";
  const demoFolderSlug = "demo-temp-folder";

  await step("POST /nodes/change-requests — create folder (kind: create)", async () => {
    const cr = await api<ChangeRequestVO>("POST", "/nodes/change-requests", {
      message: "demo: create temp folder",
      submittedBy: "demo-script",
      operations: [
        {
          kind: "create",
          nodeType: "folder",
          slug: demoFolderSlug,
          name: "Demo Temp Folder",
          description: "Temporary folder created by 08-nodes.ts demo script.",
          ...(rootNodeId ? { parentNodeId: rootNodeId } : {}),
        },
      ],
    });
    assert(cr.status === "in_review", `expected in_review, got ${cr.status}`);

    const result = await approveMerge(cr.id);
    assert(result.changeRequest.status === "merged", "expected merged");
  });

  await step("GET /folders — demo folder visible after create+merge", async () => {
    const folders = await api<FolderVO[]>("GET", "/folders");
    const f = folders.find((f) => f.node.slug === demoFolderSlug);
    assert(!!f, `folder "${demoFolderSlug}" not found after create`);
    demoFolderNodeId = f.node.id;
  });

  // ── Rename the folder ─────────────────────────────────────────────────────

  await step("POST /nodes/change-requests — rename folder (kind: rename)", async () => {
    if (!demoFolderNodeId) return;
    const cr = await api<ChangeRequestVO>("POST", "/nodes/change-requests", {
      message: "demo: rename folder",
      submittedBy: "demo-script",
      operations: [
        {
          kind: "rename",
          nodeId: demoFolderNodeId,
          slug: "demo-temp-folder-renamed",
          name: "Demo Temp (Renamed)",
          description: "Renamed by 08-nodes.ts.",
        },
      ],
    });
    assert(cr.status === "in_review", `expected in_review, got ${cr.status}`);

    const result = await approveMerge(cr.id);
    assert(result.changeRequest.status === "merged", "expected merged");
  });

  await step("GET /folders — renamed folder has updated slug", async () => {
    if (!demoFolderNodeId) return;
    const folders = await api<FolderVO[]>("GET", "/folders");
    const f = folders.find((f) => f.node.id === demoFolderNodeId);
    assert(!!f, "renamed folder not found by id");
    assert(
      f.node.slug === "demo-temp-folder-renamed",
      `expected renamed slug, got "${f.node.slug}"`,
    );
  });

  // ── Move the folder under Content ─────────────────────────────────────────

  await step("POST /nodes/change-requests — move folder (kind: move)", async () => {
    if (!demoFolderNodeId) return;
    const folders = await api<FolderVO[]>("GET", "/folders");
    const contentFolder = folders.find((f) => f.node.slug === "content");
    if (!contentFolder) {
      process.stdout.write("     ⚠️  Content folder not found — skipping move\n");
      return;
    }

    const cr = await api<ChangeRequestVO>("POST", "/nodes/change-requests", {
      message: "demo: move folder under Content",
      submittedBy: "demo-script",
      operations: [
        {
          kind: "move",
          nodeId: demoFolderNodeId,
          parentNodeId: contentFolder.node.id,
          position: 99,
        },
      ],
    });
    assert(cr.status === "in_review", `expected in_review, got ${cr.status}`);

    const result = await approveMerge(cr.id);
    assert(result.changeRequest.status === "merged", "expected merged");
  });

  // ── Delete the demo folder ────────────────────────────────────────────────

  await step("POST /nodes/change-requests — delete folder (kind: delete)", async () => {
    if (!demoFolderNodeId) return;
    const cr = await api<ChangeRequestVO>("POST", "/nodes/change-requests", {
      message: "demo: delete temp folder",
      submittedBy: "demo-script",
      operations: [{ kind: "delete", nodeId: demoFolderNodeId }],
    });
    assert(cr.status === "in_review", `expected in_review, got ${cr.status}`);

    const result = await approveMerge(cr.id);
    assert(result.changeRequest.status === "merged", "expected merged");
  });

  await step("GET /nodes — demo folder gone after delete+merge", async () => {
    if (!demoFolderNodeId) return;
    const all = await api<NodeVO[]>("GET", "/nodes");
    const found = all.find((n) => n.id === demoFolderNodeId);
    assert(!found, `demo folder still present after delete: ${demoFolderNodeId}`);
  });

  // ── Create a base node via /nodes/change-requests ─────────────────────────

  let demoBaseNodeId = "";

  await step(
    "POST /nodes/change-requests — create base node (kind: create, nodeType: base)",
    async () => {
      const cr = await api<ChangeRequestVO>("POST", "/nodes/change-requests", {
        message: "demo: create a base via node CR",
        submittedBy: "demo-script",
        operations: [
          {
            kind: "create",
            nodeType: "base",
            slug: "demo-node-base",
            name: "Demo Node Base",
            description: "Base created via /nodes/change-requests for testing.",
            fields: [
              { slug: "title", name: "Title", type: "text", required: true, options: {} },
              { slug: "notes", name: "Notes", type: "longtext", required: false, options: {} },
            ],
          },
        ],
      });
      assert(cr.status === "in_review", `expected in_review, got ${cr.status}`);

      const result = await approveMerge(cr.id);
      assert(result.changeRequest.status === "merged", "expected merged");
    },
  );

  await step("GET /nodes — demo base node present", async () => {
    const all = await api<NodeVO[]>("GET", "/nodes");
    const n = all.find((n) => n.slug === "demo-node-base");
    assert(!!n, "demo-node-base not found after node CR create");
    demoBaseNodeId = n?.id ?? "";
  });

  // Clean up: delete the demo base node
  await step("POST /nodes/change-requests — delete demo base node", async () => {
    if (!demoBaseNodeId) return;
    const cr = await api<ChangeRequestVO>("POST", "/nodes/change-requests", {
      message: "demo: delete demo-node-base",
      operations: [{ kind: "delete", nodeId: demoBaseNodeId }],
    });
    await approveMerge(cr.id);
  });

  return summary();
}

if (process.argv[1]?.endsWith("08-nodes.ts")) {
  run().then(({ fail }) => {
    if (fail > 0) process.exit(1);
  });
}
