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

  // Views gained `autoMerge` after node/base/record did, so re-assert the same
  // ceiling on them: the flag is a "don't force review if I'm allowed" request,
  // never a permission override. A changeRequest-level key that passes
  // `autoMerge: true` must still land in review.
  it("holds the same autoMerge ceiling on views", async () => {
    const baseResponse = await route.POST(
      new Request("http://localhost/api/v1/bases", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-busabase-relay-permission-level": "manage",
        },
        body: JSON.stringify({
          slug: "relay-view-base",
          name: "Relay View Base",
          autoMerge: true,
          fields: [{ slug: "title", name: "Title", type: "text", required: true }],
        }),
      }),
    );
    expect(baseResponse.status).toBe(200);
    const base = await baseResponse.json();
    expect(base.materialized).toBe(true);
    const baseId = base.id;

    const createView = async (permissionLevel: "changeRequest" | "manage", slug: string) => {
      const response = await route.POST(
        new Request("http://localhost/api/v1/views/change-requests", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-busabase-relay-permission-level": permissionLevel,
          },
          body: JSON.stringify({
            operation: "create",
            baseId,
            name: slug,
            slug,
            autoMerge: true,
            submittedBy: "relay-test",
          }),
        }),
      );
      expect(response.status).toBe(200);
      return response.json();
    };

    const pending = await createView("changeRequest", "relay-pending-view");
    expect(pending.materialized).toBe(false);
    expect(pending.status).toBe("in_review");

    const merged = await createView("manage", "relay-merged-view");
    expect(merged.materialized).toBe(true);
    expect(merged.status).toBe("active");

    const views = await (
      await route.GET(new Request(`http://localhost/api/v1/bases/${baseId}/views`))
    ).json();
    const slugs = views.map((view: { slug: string }) => view.slug);
    expect(slugs).not.toContain("relay-pending-view");
    expect(slugs).toContain("relay-merged-view");
  });
});
