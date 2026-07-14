/**
 * 02-bases: POST /bases (idempotent), GET /bases, POST /bases/{id}/fields
 * Uses DEMO_BASES as the canonical field definitions (same source as the DB seed).
 */

import { api, assert, BASE, makeRunner, type NodeTreeVO } from "./_client";
import { DEMO_BASES, toApiBase } from "./_data";
import { findFolderBySlug, folderSlugForSeedNodeId, moveNodeToFolder, needsMove } from "./_nodes";

interface BaseVO {
  id: string;
  slug: string;
  name: string;
  fields: Array<{ id: string; slug: string; name: string; type: string }>;
}

export async function run() {
  const { step, summary } = makeRunner("02-bases");
  console.log(`\n🗄️  Bases  →  ${BASE}\n`);

  let allBases: BaseVO[] = [];
  const createdBases: Map<string, BaseVO> = new Map();
  const nodes = await api<NodeTreeVO[]>("GET", "/nodes");

  // Create each base from DEMO_BASES via POST /bases (idempotent by slug)
  for (const def of DEMO_BASES) {
    await step(`POST /bases — create/idempotent "${def.name}"`, async () => {
      const folderSlug = folderSlugForSeedNodeId(def.folderNodeId);
      assert(!!folderSlug, `no demo folder mapping for seed node "${def.folderNodeId}"`);
      const folder = findFolderBySlug(nodes, folderSlug);
      assert(!!folder, `folder slug "${folderSlug}" not found`);
      const base = await api<BaseVO>("POST", "/bases", toApiBase(def, folder.node.id));
      assert(base.slug === def.slug, `slug mismatch: ${base.slug} ≠ ${def.slug}`);
      assert(base.fields.length > 0, "base has no fields");
      if (needsMove(nodes, def.slug, folderSlug)) {
        await moveNodeToFolder(def.slug, folderSlug, nodes);
      }
      createdBases.set(def.slug, base);
    });
  }

  await step("GET /bases — all DEMO_BASES slugs present", async () => {
    allBases = await api<BaseVO[]>("GET", "/bases");
    const slugs = new Set(allBases.map((b) => b.slug));
    for (const def of DEMO_BASES) {
      assert(slugs.has(def.slug), `base slug "${def.slug}" missing from GET /bases`);
    }
  });

  await step("GET /bases — each base has at least one field", async () => {
    for (const base of allBases) {
      assert(base.fields.length > 0, `base "${base.slug}" has no fields`);
    }
  });

  // Add a new field to the blog base to test POST /bases/{id}/fields
  await step("POST /bases/{id}/fields — add demo-notes field to blog (idempotent)", async () => {
    const blogBase = allBases.find((b) => b.slug === "blog") ?? createdBases.get("blog");
    if (!blogBase) return; // skip if blog not seeded
    if (blogBase.fields.some((f) => f.slug === "demo-notes")) return; // added by a prior run
    const updated = await api<BaseVO>("POST", `/bases/${blogBase.id}/fields`, {
      slug: "demo-notes",
      name: "Demo Notes",
      type: "text",
      required: false,
      options: {},
    });
    assert(
      updated.fields.some((f) => f.slug === "demo-notes"),
      "demo-notes field not found after createField",
    );
  });

  // Add a select field to companies base
  await step(
    "POST /bases/{id}/fields — add priority select to companies (idempotent)",
    async () => {
      const companiesBase =
        allBases.find((b) => b.slug === "companies") ?? createdBases.get("companies");
      if (!companiesBase) return;
      if (companiesBase.fields.some((f) => f.slug === "demo-priority")) return; // prior run
      const updated = await api<BaseVO>("POST", `/bases/${companiesBase.id}/fields`, {
        slug: "demo-priority",
        name: "Demo Priority",
        type: "select",
        required: false,
        options: {
          choices: [
            { id: "high", name: "High", color: "rose" },
            { id: "medium", name: "Medium", color: "amber" },
            { id: "low", name: "Low", color: "slate" },
          ],
        },
      });
      assert(
        updated.fields.some((f) => f.slug === "demo-priority"),
        "demo-priority field not found after createField",
      );
    },
  );

  return summary();
}

if (process.argv[1]?.endsWith("02-bases.ts")) {
  run().then(({ fail }) => {
    if (fail > 0) process.exit(1);
  });
}
