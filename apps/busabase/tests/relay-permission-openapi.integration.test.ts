import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("relay permission ceiling over the real OSS OpenAPI boundary", () => {
  let dataDir = "";
  let storageDir = "";
  let route: typeof import("../src/app/api/v1/[[...rest]]/route");

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-relay-permission-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-relay-permission-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    route = await import("../src/app/api/v1/[[...rest]]/route");
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  const createFolder = async (permissionLevel: "changeRequest" | "manage", slug: string) => {
    const response = await route.POST(
      new Request("http://localhost/api/v1/nodes/change-requests", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-busabase-relay-permission-level": permissionLevel,
        },
        body: JSON.stringify({
          autoMerge: true,
          submittedBy: "relay-test",
          operations: [{ kind: "create", nodeType: "folder", name: slug, slug }],
        }),
      }),
    );
    expect(response.status).toBe(200);
    return response.json();
  };

  it("downgrades autoMerge for a changeRequest key while manage may materialize", async () => {
    const pending = await createFolder("changeRequest", "relay-pending-folder");
    expect(pending.status).toBe("in_review");

    const merged = await createFolder("manage", "relay-merged-folder");
    expect(merged.status).toBe("merged");

    const response = await route.GET(new Request("http://localhost/api/v1/nodes"));
    expect(response.status).toBe(200);
    const nodes = await response.json();
    const serialized = JSON.stringify(nodes);
    expect(serialized).not.toContain("relay-pending-folder");
    expect(serialized).toContain("relay-merged-folder");
  });
});
