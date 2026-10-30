import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import { getDb } from "../src/db";
import { busabaseBases } from "../src/db/schema";
import * as lifecycle from "../src/logic/cr-lifecycle";
import { busabaseRouter } from "../src/router";

describe("atomic paired field creation", () => {
  const client = createRouterClient(busabaseRouter);
  let originalCwd = "";
  let dataDir = "";
  let storageDir = "";
  let sequence = 0;
  const createPairBases = async () => {
    sequence += 1;
    const make = (suffix: string) =>
      client.bases.create({
        slug: `paired-${sequence}-${suffix}`,
        name: suffix,
        fields: [{ slug: "name", name: "Name", type: "text" }],
        autoMerge: true,
      });
    return { a: await make("a"), b: await make("b") };
  };
  const create = (baseId: string, targetBaseId: string, extra = {}) =>
    client.bases.fieldChangeRequest({
      operation: "create",
      baseId,
      name: "Primary",
      slug: "primary",
      type: "relation",
      options: { targetBaseId, multiple: true },
      reverse: { name: "Sources" },
      ...extra,
    });
  const field = async (baseId: string, slug: string) =>
    (await client.bases.get({ baseId })).fields.find((f) => f.slug === slug);
  const payload = async (recordId: string) =>
    (await client.records.get({ recordId })).headCommit.payload;
  const record = async (baseId: string, fields: Record<string, unknown>) => {
    const result = await client.bases.createChangeRequest({ baseId, fields, autoMerge: true });
    if (!result.materialized) throw new Error("Expected a materialized record");
    return result.id;
  };
  const approve = async (id: string) => {
    await client.changeRequests.review({ changeRequestIds: [id], verdict: "approved" });
    return client.changeRequests.merge({ changeRequestIds: [id] });
  };
  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(path.resolve(__dirname, "../../../apps/busabase"));
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-paired-fields-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-paired-field-assets-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
  });
  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  it("creates both sides in one auditable request and keeps a second one-way field independent", async () => {
    const { a, b } = await createPairBases();
    const result = await create(a.id, b.id, { requestId: randomUUID() });
    expect(result.status).toBe("merged");
    expect(result.operations).toHaveLength(2);
    const forward = await field(a.id, "primary");
    const reverse = (await client.bases.get({ baseId: b.id })).fields.find(
      (f) => f.options.reverseOfFieldId === forward?.id,
    );
    if (!reverse) throw new Error("Expected a reverse field");
    expect(forward?.options.inverseFieldId).toBe(reverse.id);
    await client.bases.fieldChangeRequest({
      operation: "create",
      baseId: a.id,
      name: "Secondary",
      slug: "secondary",
      type: "relation",
      options: { targetBaseId: b.id },
      requestId: randomUUID(),
    });
    expect((await client.bases.get({ baseId: b.id })).fields).toHaveLength(2);
    const target = await record(b.id, { name: "B1" });
    const source = await record(a.id, { name: "A1", secondary: [target] });
    expect((await payload(target))[reverse.slug]).toEqual([]);
    await client.records.changeRequest({
      operation: "update",
      recordId: target,
      fields: { [reverse.slug]: [source] },
      autoMerge: true,
    });
    await client.records.changeRequest({
      operation: "update",
      recordId: target,
      fields: { [reverse.slug]: [] },
      autoMerge: true,
    });
    expect(await payload(source)).toMatchObject({ primary: [], secondary: [target] });
  });

  it("persists a two-operation intent and materializes neither side until approval", async () => {
    const { a, b } = await createPairBases();
    const pending = await create(a.id, b.id, { autoMerge: false });
    expect(pending.status).toBe("in_review");
    expect(pending.operations).toHaveLength(2);
    expect(await field(a.id, "primary")).toBeUndefined();
    expect((await client.bases.get({ baseId: b.id })).fields).toHaveLength(1);
    expect((await approve(pending.id)).results[0]?.ok).toBe(true);
    expect(await field(a.id, "primary")).toBeDefined();
    expect((await client.bases.get({ baseId: b.id })).fields).toHaveLength(2);
  });

  it("creates a self-relation pair with distinct field identities and collision-free slugs", async () => {
    const { a } = await createPairBases();
    const forwardSlug = a.slug.replace(/-/g, "_");
    const result = await create(a.id, a.id, { slug: forwardSlug, requestId: randomUUID() });
    expect(result.status).toBe("merged");
    expect(result.operations).toHaveLength(2);
    expect(result.operations.every((operation) => operation.baseId === a.id)).toBe(true);
    const fields = (await client.bases.get({ baseId: a.id })).fields;
    const forward = fields.find((item) => item.slug === forwardSlug);
    const reverse = fields.find((item) => item.slug === `${forwardSlug}_2`);
    if (!forward || !reverse) throw new Error("Expected both self-relation fields");
    expect(fields).toHaveLength(3);
    expect(forward.id).not.toBe(reverse.id);
    expect(forward.options).toMatchObject({ targetBaseId: a.id, inverseFieldId: reverse.id });
    expect(reverse.options).toMatchObject({
      targetBaseId: a.id,
      reverseOfFieldId: forward.id,
      inverseFieldId: forward.id,
    });
    const source = await record(a.id, { name: "Source" });
    const target = await record(a.id, { name: "Target" });
    await client.records.changeRequest({
      operation: "update",
      recordId: source,
      fields: { [forward.slug]: [target] },
      autoMerge: true,
    });
    expect((await payload(target))[reverse.slug]).toEqual([source]);
    expect((await payload(source))[forward.slug]).toEqual([target]);
  });

  it("a rejected proposal leaves both schemas unchanged", async () => {
    const { a, b } = await createPairBases();
    const pending = await create(a.id, b.id, { autoMerge: false });
    await client.changeRequests.review({ changeRequestIds: [pending.id], verdict: "rejected" });
    expect(await field(a.id, "primary")).toBeUndefined();
    expect((await client.bases.get({ baseId: b.id })).fields).toHaveLength(1);
  });

  it("rolls back the forward side when the reverse slug became occupied during review", async () => {
    const { a, b } = await createPairBases();
    const pending = await create(a.id, b.id, { autoMerge: false });
    const reverseSlug = pending.operations[1]?.headCommit.payload.slug as string;
    await client.bases.createField({
      baseId: b.id,
      slug: reverseSlug,
      name: "Occupied",
      type: "text",
    });
    expect((await approve(pending.id)).results[0]?.ok).toBe(false);
    expect(await field(a.id, "primary")).toBeUndefined();
    expect((await field(b.id, reverseSlug))?.type).toBe("text");
  });

  it("retries a completed request without duplicate fields or another change request", async () => {
    const { a, b } = await createPairBases();
    const requestId = randomUUID();
    const first = await create(a.id, b.id, { requestId });
    const second = await create(a.id, b.id, { requestId });
    expect(second.id).toBe(first.id);
    expect(second.status).toBe("merged");
    await expect(create(a.id, b.id, { requestId, name: "Different" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect((await client.bases.get({ baseId: b.id })).fields).toHaveLength(2);
  });

  it("deduplicates concurrent submissions of the same creation", async () => {
    const { a, b } = await createPairBases();
    const requestId = randomUUID();
    const results = await Promise.all([
      create(a.id, b.id, { requestId }),
      create(a.id, b.id, { requestId }),
    ]);
    expect(results[0].id).toBe(results[1].id);
    expect(results.every((r) => r.status === "merged")).toBe(true);
    expect((await client.bases.get({ baseId: a.id })).fields).toHaveLength(2);
    expect((await client.bases.get({ baseId: b.id })).fields).toHaveLength(2);
  });

  it("resumes an immediate retry after interruption between proposal and finalization", async () => {
    const { a, b } = await createPairBases();
    const requestId = randomUUID();
    const interrupted = vi
      .spyOn(lifecycle, "finalizeChangeRequest")
      .mockRejectedValueOnce(new Error("interrupted after proposal"));
    try {
      await expect(create(a.id, b.id, { requestId })).rejects.toThrow("interrupted after proposal");
    } finally {
      interrupted.mockRestore();
    }
    expect(await field(a.id, "primary")).toBeUndefined();
    const recovered = await create(a.id, b.id, { requestId });
    expect(recovered.status).toBe("merged");
    expect((await client.bases.get({ baseId: a.id })).fields).toHaveLength(2);
    expect((await client.bases.get({ baseId: b.id })).fields).toHaveLength(2);
  });

  it("does not create a forward field when the caller can only read the target Base", async () => {
    const { a, b } = await createPairBases();
    await client.nodes.updateVisibility({ nodeId: b.nodeId, visibility: "private" });
    await client.nodes.principals.add({
      nodeId: b.nodeId,
      principalType: "user",
      principalId: "paired-bob",
      role: "read",
    });
    await runWithBusabaseContext(
      {
        spaceId: LOCAL_SPACE_ID,
        actorId: "paired-bob",
        isSpaceManager: false,
        permissionLevel: "write",
      },
      async () => {
        await expect(create(a.id, b.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
      },
    );
    expect(await field(a.id, "primary")).toBeUndefined();
    expect((await client.bases.get({ baseId: b.id })).fields).toHaveLength(1);
  });

  it("falls back to one pending proposal when the target only grants change-request access", async () => {
    const { a, b } = await createPairBases();
    await client.nodes.updateVisibility({ nodeId: b.nodeId, visibility: "private" });
    await client.nodes.principals.add({
      nodeId: b.nodeId,
      principalType: "user",
      principalId: "paired-proposer",
      role: "changeRequest",
    });
    const pending = await runWithBusabaseContext(
      {
        spaceId: LOCAL_SPACE_ID,
        actorId: "paired-proposer",
        isSpaceManager: false,
        permissionLevel: "write",
      },
      () => create(a.id, b.id, { autoMerge: true, requestId: randomUUID() }),
    );
    expect(pending.status).toBe("in_review");
    expect(pending.operations).toHaveLength(2);
    expect(await field(a.id, "primary")).toBeUndefined();
    expect((await client.bases.get({ baseId: b.id })).fields).toHaveLength(1);
    expect((await approve(pending.id)).results[0]?.ok).toBe(true);
    expect((await client.bases.get({ baseId: b.id })).fields).toHaveLength(2);
  });

  it("refuses the entire merge when the target was archived while the proposal waited", async () => {
    const { a, b } = await createPairBases();
    const pending = await create(a.id, b.id, { autoMerge: false });
    const db = await getDb();
    await db
      .update(busabaseBases)
      .set({ archivedAt: new Date() })
      .where(eq(busabaseBases.id, b.id));
    const result = await approve(pending.id);
    expect(result.results[0]?.ok).toBe(false);
    expect(await field(a.id, "primary")).toBeUndefined();
    await db.update(busabaseBases).set({ archivedAt: null }).where(eq(busabaseBases.id, b.id));
    expect((await client.bases.get({ baseId: b.id })).fields).toHaveLength(1);
  });

  it("does not silently report direct creation as successful when the pair needs human review", async () => {
    const { a, b } = await createPairBases();
    const db = await getDb();
    await db
      .update(busabaseBases)
      .set({ reviewPolicy: { kind: "single", requiredApprovals: 2 } })
      .where(eq(busabaseBases.id, b.id));
    await expect(
      client.bases.createField({
        baseId: a.id,
        slug: "primary",
        name: "Primary",
        type: "relation",
        options: { targetBaseId: b.id },
        reverse: { name: "Sources" },
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      data: { reason: "field_creation_requires_review", changeRequestId: expect.any(String) },
    });
    expect(await field(a.id, "primary")).toBeUndefined();
    expect((await client.bases.get({ baseId: b.id })).fields).toHaveLength(1);
  });

  it("uses the stricter target policy, keeps collecting distinct approvals, and creates both sides together", async () => {
    const { a, b } = await createPairBases();
    const db = await getDb();
    await db
      .update(busabaseBases)
      .set({ reviewPolicy: { kind: "single", requiredApprovals: 2 } })
      .where(eq(busabaseBases.id, b.id));
    const pending = await create(a.id, b.id);
    expect(pending.status).toBe("in_review");
    expect(pending.reviewPolicySnapshot.requiredApprovals).toBe(2);
    await client.changeRequests.review({ changeRequestIds: [pending.id], verdict: "approved" });
    expect(await field(a.id, "primary")).toBeUndefined();
    const first = await client.changeRequests.get({ changeRequestId: pending.id });
    expect(first.status).toBe("in_review");
    await runWithBusabaseContext(
      {
        spaceId: LOCAL_SPACE_ID,
        actorId: "second-reviewer",
        isSpaceManager: true,
        permissionLevel: "manage",
      },
      async () => {
        await client.changeRequests.review({ changeRequestIds: [pending.id], verdict: "approved" });
      },
    );
    const result = await client.changeRequests.merge({ changeRequestIds: [pending.id] });
    expect(result.results[0]?.ok).toBe(true);
    expect(await field(a.id, "primary")).toBeDefined();
    expect((await client.bases.get({ baseId: b.id })).fields).toHaveLength(2);
  });

  it("does not count an approval of earlier operation heads after a paired proposal is revised", async () => {
    const { a, b } = await createPairBases();
    const db = await getDb();
    await db
      .update(busabaseBases)
      .set({ reviewPolicy: { kind: "single", requiredApprovals: 2 } })
      .where(eq(busabaseBases.id, b.id));
    const pending = await create(a.id, b.id);
    await client.changeRequests.review({ changeRequestIds: [pending.id], verdict: "approved" });
    const forwardOperation = pending.operations.find((operation) => operation.baseId === a.id);
    if (!forwardOperation) throw new Error("Expected a forward field operation");
    const revised = await client.operations.revise({
      operationId: forwardOperation.id,
      fields: { ...forwardOperation.headCommit.payload, name: "Revised primary" },
    });
    expect(
      revised.operations.find((operation) => operation.id === forwardOperation.id)?.headCommit.id,
    ).not.toBe(forwardOperation.headCommit.id);
    await runWithBusabaseContext(
      {
        spaceId: LOCAL_SPACE_ID,
        actorId: "current-head-reviewer",
        isSpaceManager: true,
        permissionLevel: "manage",
      },
      () => client.changeRequests.review({ changeRequestIds: [pending.id], verdict: "approved" }),
    );
    expect((await client.changeRequests.get({ changeRequestId: pending.id })).status).toBe(
      "in_review",
    );
    expect(
      (await client.changeRequests.merge({ changeRequestIds: [pending.id] })).results[0]?.ok,
    ).toBe(false);
    expect(await field(a.id, "primary")).toBeUndefined();
    expect((await client.bases.get({ baseId: b.id })).fields).toHaveLength(1);
    expect((await approve(pending.id)).results[0]?.ok).toBe(true);
    expect((await field(a.id, "primary"))?.name).toBe("Revised primary");
    expect((await client.bases.get({ baseId: b.id })).fields).toHaveLength(2);
  });
});
