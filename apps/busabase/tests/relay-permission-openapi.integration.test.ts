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

  // The seven operations that deliberately never auto-merge now REJECT `autoMerge`
  // with an actionable message instead of silently dropping it — a silently
  // ignored flag is indistinguishable, to an agent, from "the server decided to
  // require review", which is how the original bug survived. Blanket `.strict()`
  // was rejected for this: the SDK/CLI ship ahead of the server on npm and
  // busabase is self-hosted, so an unknown-but-newer optional field is normal
  // traffic that must keep degrading gracefully.
  it("rejects autoMerge with an actionable reason where it never applies", async () => {
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

    const cases: Array<[string, unknown, RegExp]> = [
      [
        `/bases/${baseId}/fields/change-requests`,
        { operation: "delete", baseId, fieldId, autoMerge: true },
        /soft-deletes its stored values/,
      ],
      [
        `/bases/${baseId}/fields/change-requests`,
        { operation: "convert", baseId, fieldId, newType: "number", autoMerge: true },
        /previewFieldConversion/,
      ],
      [
        // Archive and restore became one operation-discriminated endpoint in
        // #5959; `archive` is the branch that still refuses autoMerge.
        `/bases/${baseId}/lifecycle/change-requests`,
        { operation: "archive", autoMerge: true },
        /every record in it from every listing/,
      ],
    ];

    for (const [path, body, expected] of cases) {
      const { status, payload } = await post(path, body);
      expect(status, `${path} should reject autoMerge`).toBe(400);
      // The point is not just "it failed" — the message must say why AND what to
      // do, which is exactly what `unrecognized key` would not have said.
      expect(messageOf(payload)).toMatch(expected);
      expect(messageOf(payload)).toMatch(/autoMerge/);
    }

    // Omitting the flag on the very same operation still works — the rejection is
    // scoped to asking for a merge, not to the operation.
    const omitted = await post(`/bases/${baseId}/lifecycle/change-requests`, {
      operation: "archive",
    });
    expect(omitted.status).toBe(200);
    expect(omitted.payload.status).toBe("in_review");

    // And an explicit `false` is accepted, not pedantically refused: it asks for
    // exactly what these operations already do, and every review-first call site in
    // this repo passes a uniform `autoMerge: false`.
    const explicitFalse = await post(`/bases/${baseId}/lifecycle/change-requests`, {
      operation: "archive",
      autoMerge: false,
    });
    expect(explicitFalse.status).toBe(200);
    expect(explicitFalse.payload.status).toBe("in_review");
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
