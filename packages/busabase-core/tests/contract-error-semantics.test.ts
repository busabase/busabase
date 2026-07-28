import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

const API = "http://busabase.test/api/v1";
const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

describe("Busabase contract error semantics", () => {
  let client: Client;
  let dataDir = "";
  let handler: OpenAPIHandler<Record<never, never>>;
  let originalCwd = "";
  let storageDir = "";

  const call = async (method: string, routePath: string, body?: unknown) => {
    const result = await handler.handle(
      new Request(`${API}${routePath}`, {
        method,
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      { context: {} },
    );
    if (!result.matched) throw new Error(`No OpenAPI route matched ${method} ${routePath}`);
    return { status: result.response.status, body: await result.response.json() };
  };

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-error-semantics-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-error-semantics-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
    handler = new OpenAPIHandler(busabaseRouter);
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns NOT_FOUND / 404 instead of 200 null for an unknown Base token", async () => {
    await expect(client.bases.get({ baseId: "archived" })).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });

    const response = await call("GET", "/bases/archived");
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns CONFLICT / 409 when direct file-tree creates reuse a sibling slug across types", async () => {
    const drive = await call("POST", "/file-trees", {
      type: "drive",
      slug: "shared-node-slug",
      name: "Shared Drive",
      autoMerge: true,
    });
    expect(drive.status).toBe(200);

    const conflict = await call("POST", "/file-trees", {
      type: "skill",
      slug: "shared-node-slug",
      name: "Conflicting Skill",
      autoMerge: true,
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body).toMatchObject({ code: "CONFLICT" });
  });

  it("returns CONFLICT / 409 when restoring an active field or record", async () => {
    const base = await client.bases.create({
      slug: "restore-preconditions",
      name: "Restore Preconditions",
      fields: [{ slug: "title", name: "Title", type: "text" }],
      autoMerge: true,
    });
    if ("status" in base) throw new Error("Expected a materialized Base");

    const fieldResponse = await call("POST", `/bases/${base.id}/fields/change-requests`, {
      operation: "restore",
      baseId: base.id,
      fieldId: base.fields[0]?.id,
    });
    expect(fieldResponse.status).toBe(409);
    expect(fieldResponse.body).toMatchObject({ code: "CONFLICT" });

    const record = await client.bases.createChangeRequest({
      baseId: base.id,
      fields: { title: "Active record" },
      autoMerge: true,
    });
    if (!record.materialized) throw new Error("Expected a materialized Record");

    const recordResponse = await call("POST", `/records/${record.id}/change-requests`, {
      operation: "restore",
      recordId: record.id,
    });
    expect(recordResponse.status).toBe(409);
    expect(recordResponse.body).toMatchObject({ code: "CONFLICT" });
  });
});
