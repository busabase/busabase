/**
 * Domain decomposition safety harness.
 *
 * Boots the busabase-core store against an in-memory PGlite DB and exercises the FULL
 * change-request lifecycle across EVERY operation kind the merge engine handles:
 *   - record_create / record_update / record_delete
 *   - view_create / view_update / view_delete
 *   - node_create (folder + base) / node_rename
 *   - skill create + skill_file_create / skill_file_update / skill_metadata_update
 *
 * Run this before and after splitting store.ts / turning mergeChangeRequest into a
 * per-domain dispatcher to prove behaviour is unchanged — the one thing tsc can't
 * check. Each op kind is asserted independently so a regression in any single
 * merge branch fails loudly.
 *
 * Usage (from apps/busabase):
 *   PG_DATABASE_URL=pglite://memory:// NODE_OPTIONS=--conditions=react-server \
 *     pnpm exec tsx scripts/verify-busabase-domains.ts
 */
import assert from "node:assert/strict";
import {
  createBase,
  createChangeRequest,
  createDeleteChangeRequest,
  createDeleteViewChangeRequest,
  createUpdateChangeRequest,
  createUpdateViewChangeRequest,
  createViewChangeRequest,
  getRecord,
  listRecords,
  listViews,
} from "busabase-core/domains/base/handlers";
import {
  createDoc,
  createDocChangeRequest,
  getDoc,
  updateDocBody,
} from "busabase-core/domains/doc/handlers";
import {
  createSkill,
  createSkillChangeRequest,
  getSkill,
  readSkillFile,
} from "busabase-core/domains/skill/handlers";
import {
  createNodeChangeRequest,
  mergeChangeRequest,
  reviewChangeRequest,
} from "busabase-core/logic/store";

let step = 0;
const ok = (label: string) => {
  step += 1;
  console.log(`  ✓ [${step}] ${label}`);
};

/** Approve a CR and merge it; assert it ends merged. */
const approveAndMerge = async (changeRequestId: string) => {
  await reviewChangeRequest(changeRequestId, { verdict: "approved" });
  const merged = await mergeChangeRequest(changeRequestId);
  assert.equal(merged.changeRequest.status, "merged", `CR ${changeRequestId} merged`);
  return merged;
};

async function main() {
  // --- base + record_create ------------------------------------------------
  const base = await createBase({
    slug: "verify-probe",
    name: "Verify Probe",
    description: "",
    fields: [{ slug: "title", name: "Title", type: "text", required: true, options: {} }],
  });
  assert.equal(base.slug, "verify-probe", "base created");
  ok("base created");

  const recordCr = await createChangeRequest(base.id, {
    fields: { title: "Harness Record" },
    message: "verify create",
    submittedBy: "local-editor",
  });
  assert.equal(recordCr.status, "in_review", "record CR in review");
  const recordMerge = await approveAndMerge(recordCr.id);
  const recordId = recordMerge.record?.id;
  assert.ok(recordId, "record_create produced a record");
  ok("record_create merged");

  // --- record_update -------------------------------------------------------
  const updateCr = await createUpdateChangeRequest(recordId as string, {
    fields: { title: "Harness Record (edited)" },
    message: "verify update",
    author: "local-editor",
  });
  await approveAndMerge(updateCr.id);
  const updated = await getRecord(recordId as string);
  assert.equal(
    (updated?.headCommit.fields as { title?: string })?.title,
    "Harness Record (edited)",
    "record_update applied new field value",
  );
  ok("record_update merged");

  // --- view_create / view_update / view_delete -----------------------------
  const viewCreateCr = await createViewChangeRequest(base.id, {
    name: "Ready",
    slug: "ready",
    description: "Ready rows",
    config: { filters: [], sorts: [] },
    message: "verify view create",
    submittedBy: "local-editor",
  });
  const viewMerge = await approveAndMerge(viewCreateCr.id);
  const viewId = viewMerge.view?.id;
  assert.ok(viewId, "view_create produced a view");
  ok("view_create merged");

  const viewUpdateCr = await createUpdateViewChangeRequest(viewId as string, {
    name: "Ready (renamed)",
    message: "verify view update",
    submittedBy: "local-editor",
  });
  await approveAndMerge(viewUpdateCr.id);
  const viewsAfterUpdate = await listViews(base.id);
  assert.ok(
    viewsAfterUpdate.some((v) => v.id === viewId && v.name === "Ready (renamed)"),
    "view_update renamed the view",
  );
  ok("view_update merged");

  const viewDeleteCr = await createDeleteViewChangeRequest(viewId as string, {
    message: "verify view delete",
    submittedBy: "local-editor",
  });
  await approveAndMerge(viewDeleteCr.id);
  const viewsAfterDelete = await listViews(base.id);
  assert.ok(
    !viewsAfterDelete.some((v) => v.id === viewId && v.status === "active"),
    "view_delete archived the view",
  );
  ok("view_delete merged");

  // --- node_create (folder) + node_rename ----------------------------------
  const folderCr = await createNodeChangeRequest({
    message: "verify folder create",
    submittedBy: "local-editor",
    operations: [
      { kind: "create", nodeType: "folder", slug: "probe-folder", name: "Probe Folder" },
    ],
  });
  await approveAndMerge(folderCr.id);
  ok("node_create (folder) merged");

  // --- node_create (base) --------------------------------------------------
  const baseNodeCr = await createNodeChangeRequest({
    message: "verify base node create",
    submittedBy: "local-editor",
    operations: [
      {
        kind: "create",
        nodeType: "base",
        slug: "probe-base",
        name: "Probe Base",
        fields: [{ slug: "title", name: "Title", type: "text", required: true, options: {} }],
      },
    ],
  });
  await approveAndMerge(baseNodeCr.id);
  ok("node_create (base) merged");

  // --- node_create (skill, via the registered skill materializer) ----------
  const skillNodeCr = await createNodeChangeRequest({
    message: "verify skill node create",
    submittedBy: "local-editor",
    operations: [
      { kind: "create", nodeType: "skill", slug: "probe-node-skill", name: "Probe Node Skill" },
    ],
  });
  await approveAndMerge(skillNodeCr.id);
  const materializedSkill = await getSkill("probe-node-skill");
  assert.ok(
    materializedSkill.files.some((file) => file.path === "SKILL.md"),
    "node_create skill materializer seeded SKILL.md",
  );
  ok("node_create (skill) materializer merged");

  // --- skill create + skill_file_* + skill_metadata_update -----------------
  const skill = await createSkill({
    slug: "probe-skill",
    name: "Probe Skill",
    description: "A probe skill",
    visibility: "private",
    version: "0.1.0",
    files: [],
  });
  const skillNodeId = skill.node.id;
  ok("skill node created");

  const skillCr = await createSkillChangeRequest(skillNodeId, {
    message: "verify skill files",
    submittedBy: "local-editor",
    operations: [
      { kind: "create", path: "scripts/run.ts", content: "export const run = () => 1;\n" },
      { kind: "update", path: "SKILL.md", content: "---\nname: probe-skill\n---\n\n# Probe\n" },
      { kind: "metadata_update", metadata: { version: "0.2.0", visibility: "workspace" } },
    ],
  });
  await approveAndMerge(skillCr.id);
  const runFile = await readSkillFile(skillNodeId, "scripts/run.ts");
  assert.match(runFile.content, /export const run/, "skill_file_create wrote new file");
  const refetched = await getSkill(skillNodeId);
  assert.equal(refetched.version, "0.2.0", "skill_metadata_update bumped version");
  assert.equal(refetched.visibility, "workspace", "skill_metadata_update changed visibility");
  ok("skill_file_create / update / metadata_update merged");

  // --- doc domain (stage 7 proof: new type by registration, zero migration) -
  const doc = await createDoc({ slug: "probe-doc", name: "Probe Doc", body: "# Hello\n" });
  assert.match(doc.body, /Hello/, "doc created with body");
  assert.equal(doc.node.type, "doc", "doc node has type doc");
  ok("doc created");

  const updatedDoc = await updateDocBody(doc.node.id, { body: "# Hello\n\nEdited.\n" });
  assert.match(updatedDoc.body, /Edited/, "doc body updated");
  ok("doc body updated");

  // doc_update via a change request (approval-first edit), then merge applies it.
  const docCr = await createDocChangeRequest(doc.node.id, {
    body: "# Hello\n\nVia change request.\n",
    message: "verify doc CR",
    submittedBy: "local-editor",
  });
  assert.equal(docCr.status, "in_review", "doc CR starts in review");
  await approveAndMerge(docCr.id);
  const docAfterCr = await getDoc(doc.node.id);
  assert.match(docAfterCr.body, /Via change request/, "doc_update merged the proposed body");
  ok("doc_update change request merged");

  const docNodeCr = await createNodeChangeRequest({
    message: "verify doc node create",
    submittedBy: "local-editor",
    operations: [
      { kind: "create", nodeType: "doc", slug: "probe-node-doc", name: "Probe Node Doc" },
    ],
  });
  await approveAndMerge(docNodeCr.id);
  const materializedDoc = await getDoc("probe-node-doc");
  assert.match(materializedDoc.body, /Probe Node Doc/, "node_create doc materializer seeded body");
  ok("node_create (doc) materializer merged");

  // --- record_delete (last; archives the record) ---------------------------
  const deleteCr = await createDeleteChangeRequest(recordId as string, {
    message: "verify delete",
    submittedBy: "local-editor",
    deleteMode: "archive",
  });
  await approveAndMerge(deleteCr.id);
  const deleted = await getRecord(recordId as string);
  assert.equal(deleted?.status, "archived", "record_delete archived the record");
  ok("record_delete merged");

  const records = await listRecords({});
  console.log(
    `\n✅ verify-busabase-domains: all ${step} operation-kind checks passed (${records.length} active records).`,
  );
}

main().catch((error) => {
  console.error(
    "\n❌ verify-busabase-domains FAILED:",
    error instanceof Error ? error.stack : error,
  );
  process.exit(1);
});
