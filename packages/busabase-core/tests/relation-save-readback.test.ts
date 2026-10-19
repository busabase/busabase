import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

describe("relation change request save and readback", () => {
  const client = createRouterClient(busabaseRouter);
  let originalCwd = "";
  let dataDir = "";
  let storageDir = "";
  let baseId = "";
  let recordId = "";
  const targets: string[] = [];

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(path.resolve(__dirname, "../../../apps/busabase"));
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-relation-readback-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-relation-assets-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    const targetBase = await client.bases.create({
      slug: "relation-subjects",
      name: "Subjects",
      fields: [{ slug: "title", name: "Title", type: "text" }],
      autoMerge: true,
    });
    for (const title of ["Mathematics", "Biology"]) {
      const target = await client.bases.createChangeRequest({
        baseId: targetBase.id,
        fields: { title },
        autoMerge: true,
      });
      if (!target.materialized) throw new Error("Target must be materialized");
      targets.push(target.id);
    }
    const base = await client.bases.create({
      slug: "relation-students",
      name: "Students",
      fields: [
        { slug: "title", name: "Title", type: "text" },
        {
          slug: "subjects",
          name: "Subjects",
          type: "relation",
          options: { targetBaseId: targetBase.id, multiple: true },
        },
      ],
      autoMerge: true,
    });
    baseId = base.id;
    const record = await client.bases.createChangeRequest({
      baseId,
      fields: { title: "Student", subjects: [] },
      autoMerge: true,
    });
    if (!record.materialized) throw new Error("Student must be materialized");
    recordId = record.id;
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  const expectReadback = async (ids: string[]) => {
    const detail = await client.records.get({ recordId });
    const page = await client.records.listPage({ baseId, page: 1, pageSize: 50 });
    expect(detail.headCommit.payload.subjects).toEqual(ids);
    expect(
      page.records.find((record) => record.id === recordId)?.headCommit.payload.subjects,
    ).toEqual(ids);
  };

  it("returns the same multiple relations from saved detail and paged list", async () => {
    const result = await client.records.changeRequest({
      operation: "update",
      recordId,
      fields: { subjects: targets },
      autoMerge: true,
    });
    expect(result.materialized).toBe(true);
    await expectReadback(targets);
    expect((await client.records.get({ recordId: targets[0]! })).headCommit.payload.title).toBe(
      "Mathematics",
    );
  });

  it("does not expose pending relations as saved values, then reads back after merge", async () => {
    const result = await client.records.changeRequest({
      operation: "update",
      recordId,
      fields: { subjects: [targets[1]!] },
      autoMerge: false,
    });
    expect(result.materialized).toBe(false);
    await expectReadback(targets);
    await client.changeRequests.review({ changeRequestIds: [result.id], verdict: "approved" });
    await client.changeRequests.merge({ changeRequestIds: [result.id] });
    await expectReadback([targets[1]!]);
  });

  it("persists clearing a relation without modifying other fields", async () => {
    await client.records.changeRequest({
      operation: "update",
      recordId,
      fields: { subjects: [] },
      autoMerge: true,
    });
    await expectReadback([]);
    expect((await client.records.get({ recordId })).headCommit.payload.title).toBe("Student");
  });
});
