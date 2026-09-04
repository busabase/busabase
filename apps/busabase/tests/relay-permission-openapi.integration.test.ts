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

  // These operations — field delete, field convert, Base archive — used to REJECT
  // `autoMerge: true` with a 400 no matter who asked. They are permission-aware
  // now like the rest of the write surface, and this asserts it over the REAL
  // HTTP/OpenAPI boundary rather than in-process: the schema, the router, and the
  // logic layer all had to change together, and an in-process call would not have
  // caught a stale contract still refusing the field at the transport edge.
  it("merges the formerly review-only operations when the caller may write", async () => {
    const post = async (path: string, body: unknown) => {
      const response = await route.POST(
        new Request(`http://localhost/api/v1${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
      return { status: response.status, payload: await response.json() };
    };

    const messageOf = (payload: {
      error?: string;
      data?: { issues?: Array<{ message?: string }> };
    }): string => payload.data?.issues?.[0]?.message ?? payload.error ?? "";

    // This suite starts on an empty database, so mint the Base this test needs.
    const created = await route.POST(
      new Request("http://localhost/api/v1/bases", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-busabase-relay-permission-level": "manage",
        },
        body: JSON.stringify({
          slug: "reject-automerge-base",
          name: "Reject AutoMerge Base",
          autoMerge: true,
          fields: [
            { slug: "title", name: "Title", type: "text", required: true },
            { slug: "note", name: "Note", type: "text" },
          ],
        }),
      }),
    );
    expect(created.status).toBe(200);
    const base = await created.json();
    expect(base.materialized).toBe(true);
    const baseId: string = base.id;
    const fieldId: string = base.fields.find((f: { slug: string }) => f.slug === "note").id;

    // Each of the three used to answer 400 here. Ordering matters: convert first
    // (it needs the field alive), then delete, then archive the whole Base.
    const convert = await post(`/bases/${baseId}/fields/change-requests`, {
      operation: "convert",
      baseId,
      fieldId,
      newType: "number",
      autoMerge: true,
    });
    expect(convert.status, messageOf(convert.payload)).toBe(200);
    expect(convert.payload.status).toBe("merged");

    const fieldDelete = await post(`/bases/${baseId}/fields/change-requests`, {
      operation: "delete",
      baseId,
      fieldId,
      autoMerge: true,
    });
    expect(fieldDelete.status, messageOf(fieldDelete.payload)).toBe(200);
    expect(fieldDelete.payload.status).toBe("merged");

    // `autoMerge: false` is still the way to ask for a human, on the very same
    // operations — the point of the change was to stop FORCING review, not to
    // remove the option.
    const pendingArchive = await post(`/bases/${baseId}/lifecycle/change-requests`, {
      operation: "archive",
      autoMerge: false,
    });
    expect(pendingArchive.status).toBe(200);
    expect(pendingArchive.payload.status).toBe("in_review");

    const archive = await post(`/bases/${baseId}/lifecycle/change-requests`, {
      operation: "archive",
      autoMerge: true,
    });
    expect(archive.status, messageOf(archive.payload)).toBe(200);
    expect(archive.payload.status).toBe("merged");
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
