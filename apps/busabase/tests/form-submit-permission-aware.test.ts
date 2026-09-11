import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * A form submission is permission-aware, and an ANONYMOUS one still is not.
 *
 * `submitForm` used to pin `autoMerge: false`, so every submission queued —
 * including one from the workspace owner, who then had to go and approve their
 * own row. That pin is gone: a submission now follows the same permission-aware
 * default as every other write.
 *
 * The anonymous half is the reason this file exists. Nothing in `submitForm`
 * decides who may merge; what makes a public form safe is one layer down, in
 * `getEffectiveNodeLevel`. Permission is resolved against the target BASE — which
 * a form deliberately never shares — so an anonymous request gets no level there
 * at all; and even a shared node caps a visitor at `read`. Both answers come from
 * the request CONTEXT before any actor id is read, so the property holds however
 * the form layer is written.
 *
 * That robustness is exactly why it needs a test. Verified by mutation: forcing
 * `autoMerge: true` from the form layer does NOT break it (the ACL still refuses),
 * and opening up the anonymous branch of `getEffectiveNodeLevel` DOES turn the
 * second case below red. So this test guards the layer that actually decides,
 * rather than restating what the form code happens to pass today.
 *
 * Both halves run against a real PGlite database and the real router, not mocks:
 * the claim under test is about permission resolution, which mocks cannot check.
 */
describe("form submission — permission-aware, but never for a visitor", () => {
  let dataDir = "";
  let storageDir = "";
  let formNodeId = "";
  let baseId = "";

  const routerClient = async () => {
    const { createRouterClient } = await import("@orpc/server");
    const { busabaseRouter } = await import("busabase-core/router");
    return createRouterClient(busabaseRouter);
  };

  const liveRecordCount = async (): Promise<number> => {
    const client = await routerClient();
    const { records } = await client.records.list({ baseId, limit: 100 });
    return records.length;
  };

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-form-perm-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-form-perm-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;

    const client = await routerClient();
    const folder = await client.nodes.createChangeRequest({
      message: "Add the form's folder",
      autoMerge: true,
      operations: [
        { kind: "create", nodeType: "folder", slug: "intake", name: "Intake", description: "" },
      ],
    });
    const parentNodeId = folder.operations[0]?.nodeId as string;

    const base = await client.bases.create({
      parentNodeId,
      slug: "signups",
      name: "Signups",
      fields: [{ slug: "email", name: "Email", type: "text", required: true }],
      autoMerge: true,
    });
    baseId = (base as { id: string }).id;

    const formNode = await client.nodes.createChangeRequest({
      message: "Add the form node",
      autoMerge: true,
      operations: [
        { kind: "create", nodeType: "form", slug: "signup-form", name: "Signup", description: "" },
      ],
    });
    formNodeId = formNode.operations[0]?.nodeId as string;

    await client.forms.create({
      nodeId: formNodeId,
      targetBaseId: baseId,
      name: "Signup",
      bindings: [{ inputName: "email", fieldSlug: "email", required: true }],
      share: { isPublic: true, anonymousSubmit: true },
    });

    // Make the node genuinely publicly submittable — `submitForm` refuses an
    // anonymous caller whose node is not shared with `submit` capability, and
    // that refusal would make the anonymous assertion below pass for the wrong
    // reason (FORBIDDEN, not "queued").
    const { setNodeShare } = await import("busabase-core/logic/node-share");
    await setNodeShare(formNodeId, { scope: "public", capability: "submit" });
  }, 120_000);

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  it("merges a submission from someone who can already write the Base", async () => {
    const before = await liveRecordCount();
    const client = await routerClient();

    const result = await client.forms.submit({
      nodeId: formNodeId,
      values: { email: "member@example.com" },
    });

    expect(result.status).toBe("merged");
    expect(result.recordId).toBeTruthy();
    expect(await liveRecordCount()).toBe(before + 1);
  });

  it("still queues an ANONYMOUS submission, however write-capable the space is", async () => {
    const before = await liveRecordCount();
    const { runWithAnonymousContext, LOCAL_SPACE_ID } = await import("busabase-core/context");
    const client = await routerClient();

    const result = await runWithAnonymousContext({ spaceId: LOCAL_SPACE_ID }, async () =>
      client.forms.submit({ nodeId: formNodeId, values: { email: "visitor@example.com" } }),
    );

    // The visitor gets a proposal, not a row — and crucially nothing went live.
    expect(result.status).toBe("pending_review");
    expect(result.recordId).toBeUndefined();
    expect(await liveRecordCount()).toBe(before);
  });
});
