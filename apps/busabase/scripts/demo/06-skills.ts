/**
 * 06-skills: Full skill lifecycle — create, list, read file, CR update, approve, merge, verify.
 * Migrated from scripts/demo-skills.ts; uses DEMO_SKILLS from _data.ts.
 */

import { api, approveMerge, assert, BASE, makeRunner, type NodeTreeVO } from "./_client";
import { DEMO_SKILLS } from "./_data";
import { findFolderBySlug, moveNodeToFolder, needsMove } from "./_nodes";

interface NodeVO {
  id: string;
  slug: string;
  name: string;
  type: string;
}

interface SkillVO {
  node: NodeVO;
  files: Array<{ path: string; type: string }>;
  version: string;
  visibility: string;
}

interface FileContentVO {
  nodeId: string;
  path: string;
  content: string;
  contentHash: string;
}

interface ChangeRequestVO {
  id: string;
  status: string;
}

export async function run() {
  const { step, summary } = makeRunner("06-skills");
  console.log(`\n🎯  Skills  →  ${BASE}\n`);

  // ── Find Skills folder ────────────────────────────────────────────────────

  let parentNodeId: string | undefined;
  let nodes: NodeTreeVO[] = [];
  await step("GET /nodes — locate Skills folder", async () => {
    nodes = await api<NodeTreeVO[]>("GET", "/nodes");
    parentNodeId = findFolderBySlug(nodes, "skills")?.node.id;
    assert(!!parentNodeId, "Agent Skills folder not found; run 01-folders first");
  });

  // ── Create skills (idempotent by slug) ───────────────────────────────────

  const created: SkillVO[] = [];

  for (const def of DEMO_SKILLS) {
    await step(`POST /skills — create "${def.name}"`, async () => {
      const skill = await api<SkillVO>("POST", "/skills", {
        ...def,
        ...(parentNodeId ? { parentNodeId } : {}),
        // Smoke-testing the API surface, not the review-first policy — opt out
        // the same way a seed script does.
        autoMerge: true,
      });
      assert(skill.node.slug === def.slug, `slug mismatch: ${skill.node.slug}`);
      assert(skill.files.length >= 1, "expected at least 1 file");
      if (needsMove(nodes, def.slug, "skills")) {
        await moveNodeToFolder(def.slug, "skills", nodes);
      }
      created.push(skill);
    });
  }

  // ── GET /skills ───────────────────────────────────────────────────────────

  await step("GET /skills — all created slugs present", async () => {
    const list = await api<SkillVO[]>("GET", "/skills");
    const slugs = new Set(list.map((s) => s.node.slug));
    for (const def of DEMO_SKILLS) {
      assert(slugs.has(def.slug), `slug "${def.slug}" missing from GET /skills`);
    }
  });

  // ── GET /skills/{id} ─────────────────────────────────────────────────────

  if (created[0]) {
    await step("GET /skills/{id} — get skill detail", async () => {
      const skill = await api<SkillVO>("GET", `/skills/${created[0].node.id}`);
      assert(skill.node.id === created[0].node.id, "id mismatch");
      assert(skill.files.length >= 1, "expected files");
    });
  }

  // ── GET /skills/{id}/files ────────────────────────────────────────────────

  if (created[0]) {
    await step("GET /skills/{id}/files — list files", async () => {
      const files = await api<Array<{ path: string; type: string }>>(
        "GET",
        `/skills/${created[0].node.id}/files`,
      );
      assert(Array.isArray(files), "expected array");
      assert(
        files.some((f) => f.path === "SKILL.md"),
        "SKILL.md not found in files",
      );
    });
  }

  // ── Read SKILL.md from first skill ────────────────────────────────────────

  if (created[0]) {
    await step(
      `GET /skills/{id}/files/SKILL.md — read file from "${created[0].node.name}"`,
      async () => {
        const file = await api<FileContentVO>(
          "GET",
          `/skills/${created[0].node.id}/files/SKILL.md`,
        );
        assert(file.content.length > 0, "empty SKILL.md content");
        assert(
          file.content.includes(created[0].node.slug),
          `SKILL.md missing slug "${created[0].node.slug}"`,
        );
        assert(file.contentHash.startsWith("sha256:"), "unexpected hash format");
      },
    );
  }

  // ── CR: update README.md ──────────────────────────────────────────────────

  if (created[0]) {
    const target = created[0];
    let crId = "";

    const updatedContent = `# ${target.node.name}\n\nUpdated by 06-skills.ts via OpenAPI CR workflow.\n`;

    await step(
      `POST /skills/{id}/change-requests — update README.md on "${target.node.name}"`,
      async () => {
        const cr = await api<ChangeRequestVO>("POST", `/skills/${target.node.id}/change-requests`, {
          message: "demo: update README via CR",
          submittedBy: "demo-script",
          operations: [
            {
              kind: "create",
              path: "README.md",
              content: updatedContent,
            },
          ],
        });
        assert(cr.status === "in_review", `expected in_review, got ${cr.status}`);
        crId = cr.id;
      },
    );

    await step("approve + merge skill CR", async () => {
      const result = await approveMerge(crId);
      assert(
        result.changeRequest.status === "merged",
        `expected merged, got ${result.changeRequest.status}`,
      );
    });

    await step("GET /skills/{id}/files/README.md — verify updated content", async () => {
      const file = await api<FileContentVO>("GET", `/skills/${target.node.id}/files/README.md`);
      assert(
        file.content.includes("06-skills.ts"),
        `expected updated README, got: ${file.content.slice(0, 80)}`,
      );
    });

    // ── metadata_update CR ───────────────────────────────────────────────────

    let metaCrId = "";

    await step("POST /skills/{id}/change-requests — metadata_update (version bump)", async () => {
      const cr = await api<ChangeRequestVO>("POST", `/skills/${target.node.id}/change-requests`, {
        message: "demo: bump version to 4.1.0",
        submittedBy: "demo-script",
        operations: [{ kind: "metadata_update", metadata: { version: "4.1.0" } }],
      });
      assert(cr.status === "in_review", `expected in_review, got ${cr.status}`);
      metaCrId = cr.id;
    });

    await step("approve+merge metadata CR", async () => {
      const result = await approveMerge(metaCrId);
      assert(result.changeRequest.status === "merged", "expected merged");
    });

    await step("GET /skills/{id} — version updated to 4.1.0", async () => {
      const skill = await api<SkillVO>("GET", `/skills/${target.node.id}`);
      assert(skill.version === "4.1.0", `expected 4.1.0, got ${skill.version}`);
    });
  }

  // ── Multi-skill: create + read ─────────────────────────────────────────────

  if (created[1]) {
    await step(`GET /skills/${created[1].node.slug} — lookup second skill by id`, async () => {
      const skill = await api<SkillVO>("GET", `/skills/${created[1].node.id}`);
      assert(skill.node.slug === created[1].node.slug, "slug mismatch");
    });
  }

  return summary();
}

if (process.argv[1]?.endsWith("06-skills.ts")) {
  run().then(({ fail }) => {
    if (fail > 0) process.exit(1);
  });
}
