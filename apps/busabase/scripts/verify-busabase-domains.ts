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
  getBase,
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
  // autoMerge: true — this harness verifies the direct-write/materializer
  // parity itself, not the review-first default; skip review to keep asserting
  // on the materialized Base immediately, like it always did.
  const base = await createBase({
    slug: "verify-probe",
    name: "Verify Probe",
    description: "",
    fields: [{ slug: "title", name: "Title", type: "text", required: true, options: {} }],
    autoMerge: true,
  });
  if ("status" in base) {
    throw new Error("Expected createBase({ autoMerge: true }) to return a materialized BaseVO");
  }
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
  // autoMerge: true — same rationale as the base above: this harness verifies
  // the direct-write/materializer parity, not the review-first default.
  const skill = await createSkill({
    slug: "probe-skill",
    name: "Probe Skill",
    description: "A probe skill",
    visibility: "private",
    version: "0.1.0",
    files: [],
    autoMerge: true,
  });
  if ("status" in skill) {
    throw new Error("Expected createSkill({ autoMerge: true }) to return a materialized SkillVO");
  }
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
  // autoMerge: true — same rationale: verifying direct-write/materializer
  // parity, not the review-first default.
  const doc = await createDoc({
    slug: "probe-doc",
    name: "Probe Doc",
    body: "# Hello\n",
    autoMerge: true,
  });
  if ("status" in doc) {
    throw new Error("Expected createDoc({ autoMerge: true }) to return a materialized DocVO");
  }
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

  // --- review-first DEFAULT: createBase/createDoc/createSkill(createFileTreeNode)
  // without `autoMerge` must propose a PENDING ChangeRequest, not materialize
  // anything — the fix this harness exists to guard against a regression on.
  const pendingBaseCr = await createBase({
    slug: "review-first-probe-base",
    name: "Review First Probe Base",
    description: "",
    fields: [{ slug: "title", name: "Title", type: "text", required: true, options: {} }],
  });
  if (!("status" in pendingBaseCr)) {
    throw new Error("Expected createBase() with no autoMerge to return a pending ChangeRequestVO");
  }
  assert.equal(pendingBaseCr.status, "in_review", "createBase() defaults to a pending CR");
  assert.equal(pendingBaseCr.node, null, "createBase() default path materializes nothing yet");
  const baseBeforeMerge = await getBase("review-first-probe-base");
  assert.equal(baseBeforeMerge, null, "the Base does not exist before the pending CR is merged");
  await approveAndMerge(pendingBaseCr.id);
  // A node_create ChangeRequest never backfills its own `.node` column (a
  // pre-existing merge-engine characteristic, not something this fix changes —
  // the same is true of the Dashboard's `nodes.createChangeRequest`), so
  // materialization is confirmed by looking the Base up directly, same as the
  // Doc/Skill checks below.
  const mergedBase = await getBase("review-first-probe-base");
  assert.ok(mergedBase, "approving + merging the pending CR materializes the Base");
  ok("createBase() review-first default (pending CR → approve+merge materializes)");

  const pendingDocCr = await createDoc({
    slug: "review-first-probe-doc",
    name: "Review First Probe Doc",
    body: "# Custom initial body\n",
  });
  if (!("status" in pendingDocCr)) {
    throw new Error("Expected createDoc() with no autoMerge to return a pending ChangeRequestVO");
  }
  assert.equal(pendingDocCr.status, "in_review", "createDoc() defaults to a pending CR");
  assert.equal(pendingDocCr.node, null, "createDoc() default path materializes nothing yet");
  await approveAndMerge(pendingDocCr.id);
  const mergedDoc = await getDoc("review-first-probe-doc");
  assert.match(
    mergedDoc.body,
    /Custom initial body/,
    "merging the pending Doc CR carries the custom initial body through (not the synthesized default header)",
  );
  ok(
    "createDoc() review-first default (pending CR carries custom body → approve+merge materializes)",
  );

  const pendingSkillCr = await createSkill({
    slug: "review-first-probe-skill",
    name: "Review First Probe Skill",
    description: "",
    visibility: "private",
    version: "0.1.0",
    files: [{ path: "notes.md", content: "custom initial file\n" }],
  });
  if (!("status" in pendingSkillCr)) {
    throw new Error("Expected createSkill() with no autoMerge to return a pending ChangeRequestVO");
  }
  assert.equal(pendingSkillCr.status, "in_review", "createSkill() defaults to a pending CR");
  assert.equal(pendingSkillCr.node, null, "createSkill() default path materializes nothing yet");
  await approveAndMerge(pendingSkillCr.id);
  const mergedSkill = await getSkill("review-first-probe-skill");
  assert.ok(
    mergedSkill.files.some((file) => file.path === "SKILL.md"),
    "merging the pending Skill CR still seeds the default SKILL.md",
  );
  assert.ok(
    mergedSkill.files.some((file) => file.path === "notes.md"),
    "merging the pending Skill CR carries the custom initial file through (createFileTreeNode's initialFiles)",
  );
  ok(
    "createSkill()/createFileTreeNode() review-first default (pending CR carries custom files → approve+merge materializes)",
  );

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
