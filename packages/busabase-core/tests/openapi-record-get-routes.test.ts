import { describe, expect, it } from "vitest";
import { getBusabaseOpenApiSpec } from "../src/openapi/spec";

describe("Busabase OpenAPI record get route", () => {
  it("publishes one get-one operation with both selector modes", async () => {
    const spec = await getBusabaseOpenApiSpec();
    const paths = spec.paths ?? {};
    const operation = paths["/api/v1/records/get"]?.get;
    const parameters = (operation?.parameters ?? []).filter(
      (parameter): parameter is Exclude<typeof parameter, { $ref: string }> =>
        !("$ref" in parameter),
    );
    const byName = new Map(parameters.map((parameter) => [parameter.name, parameter]));

    expect(operation).toBeDefined();
    expect([...byName.keys()].sort()).toEqual(["baseId", "fieldSlug", "recordId", "valueText"]);
    expect(operation?.description).toContain("exactly one selector");
    expect(byName.get("recordId")?.schema).toEqual(
      expect.objectContaining({ description: expect.stringContaining("Use alone") }),
    );
    expect(byName.get("baseId")?.schema).toEqual(
      expect.objectContaining({ description: expect.stringContaining("Requires fieldSlug") }),
    );
    expect(operation?.responses).toHaveProperty("400");
    expect(operation?.responses).toHaveProperty("404");
  });

  it("does not publish either retired get-one path", async () => {
    const spec = await getBusabaseOpenApiSpec();
    expect(spec.paths?.["/api/v1/records/{recordId}"]).toBeUndefined();
    expect(spec.paths?.["/api/v1/records/by-field"]).toBeUndefined();
  });

  it("keeps numbered record pagination in the public contract", async () => {
    const spec = await getBusabaseOpenApiSpec();
    expect(spec.paths?.["/api/v1/records/page"]?.get).toBeDefined();
  });

  it("publishes one-CR bulk record updates", async () => {
    const spec = await getBusabaseOpenApiSpec();
    expect(
      spec.paths?.["/api/v1/bases/{baseId}/records/bulk-update-change-request"]?.post,
    ).toBeDefined();
  });

  it("publishes only the two canonical change-request action paths", async () => {
    const spec = await getBusabaseOpenApiSpec();
    expect(spec.paths?.["/api/v1/change-requests/reviews"]?.post).toBeDefined();
    expect(spec.paths?.["/api/v1/change-requests/merge"]?.post).toBeDefined();
    expect(spec.paths?.["/api/v1/change-requests/{changeRequestId}/reviews"]).toBeUndefined();
    expect(spec.paths?.["/api/v1/change-requests/{changeRequestId}/merge"]).toBeUndefined();
  });

  it("no longer publishes any of the four retired typed list/get pairs", async () => {
    const spec = await getBusabaseOpenApiSpec();
    for (const path of [
      "/api/v1/docs",
      "/api/v1/docs/{nodeId}",
      "/api/v1/files/{nodeId}",
      "/api/v1/folders",
      "/api/v1/folders/{nodeId}",
      "/api/v1/file-trees/{nodeId}",
    ]) {
      expect(spec.paths?.[path]?.get, `${path} GET must be gone`).toBeUndefined();
    }
    // `/api/v1/files` and `/api/v1/file-trees` still exist — as POST-only
    // creation routes. Only their GET twin was retired.
    expect(spec.paths?.["/api/v1/files"]?.get).toBeUndefined();
    expect(spec.paths?.["/api/v1/files"]?.post).toBeDefined();
    expect(spec.paths?.["/api/v1/file-trees"]?.get).toBeUndefined();
    expect(spec.paths?.["/api/v1/file-trees"]?.post).toBeDefined();
  });

  it("serves all four through one unified Node detail route", async () => {
    const spec = await getBusabaseOpenApiSpec();
    const operation = spec.paths?.["/api/v1/nodes/{nodeId}"]?.get;
    expect(operation).toBeDefined();
    const parameterNames = (operation?.parameters ?? [])
      .filter(
        (parameter): parameter is Exclude<typeof parameter, { $ref: string }> =>
          !("$ref" in parameter),
      )
      .map((parameter) => parameter.name)
      .sort();
    expect(parameterNames).toEqual(["nodeId", "type"]);
  });

  it("keeps the literal /nodes GET routes as their own operations", async () => {
    // They share a prefix with the new `/nodes/{nodeId}` template; if either
    // were swallowed by it, quick-jump and favorites would silently 404.
    const spec = await getBusabaseOpenApiSpec();
    expect(spec.paths?.["/api/v1/nodes/search"]?.get).toBeDefined();
    expect(spec.paths?.["/api/v1/nodes/favorites"]?.get).toBeDefined();
  });

  it("serves Base archive and restore through one lifecycle path", async () => {
    const spec = await getBusabaseOpenApiSpec();
    expect(spec.paths?.["/api/v1/bases/{baseId}/lifecycle/change-requests"]?.post).toBeDefined();
    expect(spec.paths?.["/api/v1/bases/{baseId}/archive/change-requests"]).toBeUndefined();
    expect(spec.paths?.["/api/v1/bases/{baseId}/restore/change-requests"]).toBeUndefined();
  });

  it("keeps the compressed public API at 113 operations", async () => {
    const spec = await getBusabaseOpenApiSpec();
    const operationCount = Object.values(spec.paths ?? {}).reduce(
      (count, pathItem) =>
        count +
        Object.keys(pathItem ?? {}).filter((key) =>
          ["get", "post", "put", "patch", "delete", "head", "options"].includes(key),
        ).length,
      0,
    );
    // Numbered pagination raised the merged develop baseline from 104 to 105;
    // consolidating four CR action operations into two brought it to 103.
    // Unified Node detail retired four typed gets and added one (-3 -> 100);
    // unified Node summary lists retired the four typed lists (-4 -> 96).
    // Collapsing Base archive + restore into one lifecycle operation (-1 -> 95).
    // Numbered change request paging for the inbox (+1 -> 96) — the cursor
    // listing stays, since "keep scrolling" and "jump to page 30 of 45" are
    // different jobs and the inbox needs both.
    // Anonymous form submit endpoint added (+1 -> 97).
    // Unified node content write: `PUT /docs/{nodeId}/body` and
    // `POST /docs/{nodeId}/change-requests` retired, replaced by ONE
    // `PUT /nodes/{nodeId}/content` that also gives whiteboard/workflow/html
    // their first reviewed write (-2 +1 -> 96). See
    // apps/busabase/content/spec/node-content-storage.md (D3).
    // Node/record-scoped Activity history pages added `GET /activity/node`
    // and `GET /activity/record` (+2 -> 98) — same public-surface treatment
    // as the existing `GET /activity/paged`.
    // The Template Center catalog added `GET /templates` (+1). It reads a
    // public repository's index and returns nothing about the workspace, so it
    // belongs on the public surface for the same reason it is a `read` in the
    // permission policy; installing from it remains `install.fromGithub`.
    // The node-avatar upload pair added `POST /nodes/icon/upload-urls` and
    // `POST /nodes/icon/confirmations` (+2) — same public-surface treatment as
    // the existing `assets.createUploadUrl`/`assets.confirm`. 98 + 1 + 2 = 101.
    // Bulk record update adds one review-first operation while preserving the
    // compressed single-record change surface (+1 -> 102).
    // The guide catalog added `GET /guides` and `GET /guides/{topic}` (+2).
    // Public for the same reason `GET /templates` is: they return static
    // documents about how Busabase works and nothing about this workspace, and
    // a `read` key that cannot read the rules it is expected to follow is the
    // situation these routes exist to end. 101 + 1 + 2 = 104.
    // Embed-link create/list/revoke now belong to this shared contract so
    // Desktop can execute them directly and Cloud can forward the same paths
    // to a remote tunnel (+3 -> 107).
    // `GET /nodes/{nodeId}/ancestors` added (+1 -> 108). Public for the same
    // reason `nodes.list` is — it returns ids from the tree the caller can
    // already read, under the same node-visibility ACL — and it is what lets a
    // depth-bounded sidebar open straight to a deep node on a cold load.
    // `GET /records/group-by` added (+1 -> 109). Public for the same reason
    // `records.count` is — it reports aggregate counts over records the caller
    // can already read — and it is what lets a board column header or a summary
    // tile show its split without draining the whole Base to the client.
    // `POST /dump/export/doc-bodies` added (+1 -> 110). The export-side
    // counterpart to the `docBodies` pseudo-table `dump.importTables` already
    // accepted: `nodes.get` refuses an ARCHIVED Doc, so a backup driven
    // through it captured 13 of 88 bodies on a real space and restored the
    // other 75 empty. Manager-gated like every other `dump.*` route.
    // `PATCH /nodes/{nodeId}/settings` added (+1 -> 111). Public for the same
    // reason `PATCH /nodes/{nodeId}/metadata` is, and gated at the same `write`
    // level: it edits one property of a node the caller can already write to.
    // What differs is the shape, not the exposure — settings takes a CLOSED
    // schema Busabase itself acts on, so an unknown key is refused rather than
    // merged, which is exactly why it is a separate endpoint instead of another
    // key in the free-form metadata bag.
    // +2 for the node agent-prompt pair (`GET`/`PUT /nodes/{id}/agent-prompts`)
    // -> 113. A read and a write rather than a field on the node: the list is
    // capped at 50 prompts x 8 KiB per locale, so it is excluded from every node
    // listing and has to be asked for on its own.
    expect(operationCount).toBe(113);
  });
});
