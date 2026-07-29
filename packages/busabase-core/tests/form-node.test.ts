import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import { DEMO_BASES, DEMO_FOLDERS } from "../src/demo/dataset";
import {
  createForm,
  getFormByNodeId,
  submitForm,
  updateForm,
} from "../src/domains/form/logic/form-ops";
import { seedScenario } from "../src/logic/seed";
import { busabaseRouter } from "../src/router";

/**
 * Form-as-Node: the submission spine and its access gates.
 *
 * Submitting must produce an approval-first record-create ChangeRequest on the
 * target Base (never a direct write), and the share settings must be enforced
 * SERVER-side (APITable's equivalent only checked the limit in the browser).
 */
const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

describe("Form-as-Node — submission + access gates", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;
  let blogBaseId = "";
  let formNodeId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-form-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-form-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
    await seedScenario({ folders: DEMO_FOLDERS, bases: DEMO_BASES });

    const bases = await client.bases.list({});
    blogBaseId = bases.find((b) => b.slug === "blog")?.id ?? "";

    // A form node to bind the form row to.
    await client.nodes.createChangeRequest({
      autoMerge: true,
      operations: [{ kind: "create", nodeType: "form", slug: "t-form", name: "T Form" }],
    });
    const nodes = await client.nodes.list({});
    const flat: Array<{ id: string; slug: string; type: string; children?: unknown[] }> = [];
    const walk = (list: unknown[]) => {
      for (const raw of list) {
        const n = raw as { id: string; slug: string; type: string; children?: unknown[] };
        flat.push(n);
        if (n.children?.length) {
          walk(n.children);
        }
      }
    };
    walk(nodes as unknown[]);
    formNodeId = flat.find((n) => n.slug === "t-form" && n.type === "form")?.id ?? "";
  }, 120_000);

  afterAll(async () => {
    process.chdir(originalCwd);
    await rm(dataDir, { force: true, recursive: true });
    await rm(storageDir, { force: true, recursive: true });
  });

  it("turns a submission into a record-create ChangeRequest (not a direct write)", async () => {
    expect(formNodeId).not.toBe("");
    await createForm({
      nodeId: formNodeId,
      targetBaseId: blogBaseId,
      name: "T Form",
      bindings: [
        { inputName: "subject", fieldSlug: "title", required: true },
        { inputName: "msg", fieldSlug: "body", required: true },
      ],
    });

    const { records: before } = await client.records.list({});
    const result = await submitForm(formNodeId, {
      values: { subject: "Hello", msg: "Body text" },
    });
    expect(result.status).toBe("pending_review");

    // No record yet — it's pending review.
    const { records: after } = await client.records.list({});
    expect(after.length).toBe(before.length);

    // Merging the CR materializes the record with the submitted values.
    await client.changeRequests.review({
      changeRequestIds: [result.changeRequestId],
      verdict: "approved",
    });
    await client.changeRequests.merge({ changeRequestIds: [result.changeRequestId] });
    const { records: merged } = await client.records.list({});
    expect(merged.length).toBe(before.length + 1);
    expect(
      merged.some((r) => (r.headCommit.fields as Record<string, unknown>).title === "Hello"),
    ).toBe(true);
  });

  it("rejects a required field that the page did not fill", async () => {
    await expect(submitForm(formNodeId, { values: { subject: "No body" } })).rejects.toThrow(
      /Missing required fields|Body is required/,
    );
  });

  it("rejects anonymous submission to a private form", async () => {
    await expect(
      submitForm(formNodeId, { values: { subject: "a", msg: "b" } }, { isAnonymous: true }),
    ).rejects.toThrow(/not public/i);
  });

  it("rejects anonymous submission when the public form requires sign-in", async () => {
    await updateForm(formNodeId, {
      share: { isPublic: true, anonymousSubmit: false },
    });
    await expect(
      submitForm(formNodeId, { values: { subject: "a", msg: "b" } }, { isAnonymous: true }),
    ).rejects.toThrow(/sign-in/i);
  });

  it("enforces submitLimit server-side", async () => {
    // Allow anonymous, and cap at the submissions already recorded.
    await updateForm(formNodeId, {
      share: { isPublic: true, anonymousSubmit: true, submitLimit: 1 },
    });
    // One submission was already accepted by the first test, so the cap is hit.
    await expect(
      submitForm(formNodeId, { values: { subject: "over", msg: "limit" } }, { isAnonymous: true }),
    ).rejects.toThrow(/submission limit/i);
  });

  it("hides form configuration when its target Base is not visible", async () => {
    const target = await client.bases.get({ baseId: blogBaseId });
    if (!target) throw new Error("expected target Base");
    await client.nodes.updateVisibility({ nodeId: target.nodeId, visibility: "private" });

    const hidden = await runWithBusabaseContext(
      {
        spaceId: LOCAL_SPACE_ID,
        actorId: "form-reader",
        isSpaceManager: false,
        permissionLevel: "read",
      },
      () => getFormByNodeId(formNodeId),
    );
    expect(hidden).toBeNull();
  });
});
