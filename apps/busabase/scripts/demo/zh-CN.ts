/**
 * demo:zh-CN — Insert complete Chinese demo scenarios via OpenAPI.
 *
 * Run on a fresh database (no db:seed needed). Creates Chinese folders,
 * bases, records, and views end-to-end through the CR → approve → merge workflow.
 *
 * Seeding order:
 *   1. Folders  — POST /nodes/change-requests (kind: create) → approve → merge
 *   2. Bases    — POST /bases
 *   3. Records  — POST /bases/{id}/change-requests → approve → merge
 *   4. Views    — POST /bases/{id}/views/change-requests → approve → merge
 *
 * Relation and AI-generated fields are skipped because they require post-hoc ID
 * resolution that the record_insert CR workflow doesn't support inline.
 *
 * Usage:
 *   BUSABASE_URL=http://localhost:15419 pnpm demo:zh-CN
 */

import { zhCnScenario } from "busabase-core/demo/scenarios/zh-cn";
import { api, approveMerge, BASE, makeRunner } from "./_client";

// Field types that can't be set via POST /change-requests (record_insert)
const SKIP_FIELD_TYPES = new Set(["relation", "ai_summary", "ai_tags", "created_time"]);

// scenario nodeId → API-assigned node ID (populated after folder creation)
const folderNodeMap = new Map<string, string>();

// scenario base.id → API-assigned base ID (populated after base creation)
const baseIdMap = new Map<string, string>();

// (scenario baseId, fieldSlug) → field type — for filtering record values
const fieldTypeMap = new Map<string, string>();

export async function run() {
  const { step, summary } = makeRunner("demo:zh-CN");
  console.log(`\n🇨🇳  Chinese Scenario Seed  →  ${BASE}\n`);

  // ── Root node ID ──────────────────────────────────────────────────────────

  let rootNodeId = "";
  await step("GET /nodes — root node ID", async () => {
    const nodes = await api<Array<{ id: string; slug: string; type: string }>>("GET", "/nodes");
    rootNodeId = nodes.find((n) => n.slug === "root")?.id ?? "";
  });

  // ── Folders ───────────────────────────────────────────────────────────────

  for (const folder of zhCnScenario.folders ?? []) {
    await step(`POST /nodes/change-requests — folder "${folder.name}"`, async () => {
      // Idempotent: skip if already present
      const existing = await api<Array<{ node: { id: string; slug: string } }>>("GET", "/folders");
      const found = existing.find((f) => f.node.slug === folder.slug);
      if (found) {
        folderNodeMap.set(folder.nodeId, found.node.id);
        return;
      }

      const cr = await api<{ id: string; status: string }>("POST", "/nodes/change-requests", {
        message: `seed: 创建文件夹 ${folder.name}`,
        submittedBy: "seed-zh-cn",
        operations: [
          {
            kind: "create",
            nodeType: "folder",
            slug: folder.slug,
            name: folder.name,
            description: folder.description ?? "",
            ...(rootNodeId ? { parentNodeId: rootNodeId } : {}),
          },
        ],
      });
      await approveMerge(cr.id);

      // Re-fetch to get the API-assigned node ID
      const updated = await api<Array<{ node: { id: string; slug: string } }>>("GET", "/folders");
      const created = updated.find((f) => f.node.slug === folder.slug);
      if (created) folderNodeMap.set(folder.nodeId, created.node.id);
    });
  }

  // ── Build field-type map (for filtering record values later) ──────────────

  for (const base of zhCnScenario.bases ?? []) {
    for (const field of base.fields) {
      fieldTypeMap.set(`${base.id}:${field.slug}`, field.type);
    }
  }

  // ── Bases ─────────────────────────────────────────────────────────────────

  // Pre-fetch existing bases for idempotent creation (same pattern as folders).
  const existingBases = await api<Array<{ id: string; slug: string }>>("GET", "/bases");
  const existingBaseBySlug = new Map(existingBases.map((b) => [b.slug, b.id]));

  for (const base of zhCnScenario.bases ?? []) {
    await step(`POST /bases — base "${base.name}"`, async () => {
      const existingId = existingBaseBySlug.get(base.slug);
      if (existingId) {
        baseIdMap.set(base.id, existingId);
        return;
      }

      const parentNodeId = folderNodeMap.get(base.folderNodeId);
      const fields = base.fields
        .filter((f) => !SKIP_FIELD_TYPES.has(f.type))
        .map((f) => ({
          slug: f.slug,
          name: f.name,
          type: f.type,
          required: f.required,
          options: ("options" in f ? f.options : {}) ?? {},
        }));

      // Fallback: every base needs ≥1 field
      if (fields.length === 0) {
        fields.push({ slug: "name", name: "名称", type: "text", required: true, options: {} });
      }

      const created = await api<{ id: string; slug: string }>("POST", "/bases", {
        slug: base.slug,
        name: base.name,
        description: base.description ?? "",
        ...(parentNodeId ? { parentNodeId } : {}),
        fields,
      });
      baseIdMap.set(base.id, created.id);
    });
  }

  // ── Records ───────────────────────────────────────────────────────────────

  for (const record of zhCnScenario.records ?? []) {
    const apiBaseId = baseIdMap.get(record.baseId);
    if (!apiBaseId) continue;

    await step(
      `POST /bases/${record.baseId}/change-requests — record (${record.author})`,
      async () => {
        // Strip fields that aren't API-safe (relations, AI, etc.)
        const safeFields = Object.fromEntries(
          Object.entries(record.fields).filter(([slug]) => {
            const type = fieldTypeMap.get(`${record.baseId}:${slug}`);
            return type !== undefined && !SKIP_FIELD_TYPES.has(type);
          }),
        );

        const cr = await api<{ id: string }>("POST", `/bases/${apiBaseId}/change-requests`, {
          fields: safeFields,
          message: record.message,
          submittedBy: record.author,
        });
        await approveMerge(cr.id);
      },
    );
  }

  // ── Relation fields (second pass — needs all baseIdMap entries resolved) ──────

  // Pre-fetch existing fields per base so we can skip already-added relations.
  const existingFieldSlugs = new Map<string, Set<string>>();
  for (const [scenarioId, apiBaseId] of baseIdMap.entries()) {
    const base =
      existingBases.find((b) => b.id === apiBaseId) ??
      (await api<{ id: string; slug: string; fields: Array<{ slug: string }> }>(
        "GET",
        `/bases/${apiBaseId}`,
      ).catch(() => null));
    if (base && "fields" in base) {
      existingFieldSlugs.set(
        scenarioId,
        new Set((base as { fields: Array<{ slug: string }> }).fields.map((f) => f.slug)),
      );
    }
  }

  for (const base of zhCnScenario.bases ?? []) {
    const apiBaseId = baseIdMap.get(base.id);
    if (!apiBaseId) continue;

    const relationFields = base.fields.filter((f) => f.type === "relation");
    for (const field of relationFields) {
      const targetScenarioId = (field.options as { targetBaseId?: string }).targetBaseId;
      if (!targetScenarioId) continue;
      const targetApiBaseId = baseIdMap.get(targetScenarioId);
      if (!targetApiBaseId) continue;
      // Skip if field already exists on this base
      if (existingFieldSlugs.get(base.id)?.has(field.slug)) continue;

      await step(`POST /bases/${base.id}/fields — relation "${field.name}"`, async () => {
        await api("POST", `/bases/${apiBaseId}/fields`, {
          slug: field.slug,
          name: field.name,
          type: "relation",
          required: field.required ?? false,
          options: { targetBaseId: targetApiBaseId },
        });
      });
    }
  }

  // ── Views ─────────────────────────────────────────────────────────────────

  // Pre-fetch existing views per base to avoid slug conflicts
  const existingViewSlugs = new Map<string, Set<string>>();
  for (const apiBaseId of new Set(baseIdMap.values())) {
    const existing = await api<Array<{ slug: string }>>("GET", `/bases/${apiBaseId}/views`).catch(
      () => [] as Array<{ slug: string }>,
    );
    existingViewSlugs.set(apiBaseId, new Set(existing.map((v) => v.slug)));
  }

  for (const view of zhCnScenario.views ?? []) {
    const apiBaseId = baseIdMap.get(view.baseId);
    if (!apiBaseId) continue;

    // Skip if view with this slug already exists on the base
    if (existingViewSlugs.get(apiBaseId)?.has(view.slug)) continue;

    await step(`POST views CR — view "${view.name}"`, async () => {
      const cr = await api<{ id: string }>("POST", `/bases/${apiBaseId}/views/change-requests`, {
        slug: view.slug,
        name: view.name,
        description: view.description ?? "",
        config: view.config,
        message: `seed: 创建视图 ${view.name}`,
        submittedBy: "seed-zh-cn",
      });
      await approveMerge(cr.id);
    });
  }

  return summary();
}

if (process.argv[1]?.endsWith("zh-CN.ts")) {
  run().then(({ fail }) => {
    if (fail > 0) process.exit(1);
  });
}
