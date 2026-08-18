import { PACKAGE_FORMAT } from "busabase-contract/domains/package/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyInstall, batchIdempotencyKey, RECORD_BATCH_SIZE, toApiFieldOptions } from "./apply";
import type { PackageClient } from "./client";
import { buildInstallPlan } from "./plan";
import type { PackageBaseNode, PackageTree } from "./tree";

/** Every payload the CLI sends, so a test can assert on what actually crosses the wire. */
interface Call {
  method: string;
  input: unknown;
}

interface FakeServer {
  calls: Call[];
  client: PackageClient;
}

/**
 * A fake standing in for the typed oRPC client. It records every call and returns the
 * minimum shape each pass reads, so the five passes can be exercised without a server.
 */
const createFakeServer = (): FakeServer => {
  const calls: Call[] = [];
  let nodeSeq = 0;
  let baseSeq = 0;
  let fieldSeq = 0;
  let crSeq = 0;
  let recordSeq = 0;
  /** baseId → fields, so `createField` can return the whole base like the real API does. */
  const fieldsByBase = new Map<string, { id: string; slug: string }[]>();
  /** changeRequestId → the record count it proposes, for the merge response. */
  const bulkSizes = new Map<string, number>();

  const record = (method: string, input: unknown) => calls.push({ method, input });
  let assetSeq = 0;

  const client = {
    assets: {
      // The real endpoint hands back a presigned URL; the harness stubs `fetch`
      // for the PUT (see stubUploadFetch) so the whole three-step upload runs.
      createUploadUrl: async (input: unknown) => {
        record("assets.createUploadUrl", input);
        return {
          uploadUrl: "https://storage.example/put",
          storageKey: `key_${assetSeq + 1}`,
          publicUrl: "https://storage.example/get",
          expiresIn: 900,
        };
      },
      confirm: async (input: unknown) => {
        record("assets.confirm", input);
        return {
          success: true as const,
          attachmentId: `att_${++assetSeq}`,
          assetId: `ast_new_${assetSeq}`,
          storageKey: `key_${assetSeq}`,
          publicUrl: "https://storage.example/get",
        };
      },
    },
    nodes: {
      list: async () => [],
      createChangeRequest: async (input: unknown) => {
        record("nodes.createChangeRequest", input);
        nodeSeq++;
        return { id: `crq_${++crSeq}`, operations: [{ nodeId: `nod_${nodeSeq}` }] };
      },
    },
    bases: {
      list: async () => [],
      create: async (input: unknown) => {
        record("bases.create", input);
        const baseId = `bse_${++baseSeq}`;
        const typed = input as { fields?: { slug: string }[] };
        const fields = (typed.fields ?? []).map((field) => ({
          id: `bsf_${++fieldSeq}`,
          slug: field.slug,
        }));
        fieldsByBase.set(baseId, fields);
        return { materialized: true as const, id: baseId, fields };
      },
      createField: async (input: unknown) => {
        record("bases.createField", input);
        const typed = input as { baseId: string; slug: string };
        const fields = fieldsByBase.get(typed.baseId) ?? [];
        fields.push({ id: `bsf_${++fieldSeq}`, slug: typed.slug });
        fieldsByBase.set(typed.baseId, fields);
        return { id: typed.baseId, fields };
      },
      fieldChangeRequest: async (input: unknown) => {
        record(`bases.fieldChangeRequest:${(input as { operation: string }).operation}`, input);
        // `status` matters now: pass 3 asks for the field patch with
        // `autoMerge: true` and refuses to continue unless it really came back
        // merged, so a stub without a status would look like a failed wiring.
        return { id: `crq_${++crSeq}`, status: "merged" };
      },
      createBulkChangeRequest: async (input: unknown) => {
        record("bases.createBulkChangeRequest", input);
        const id = `crq_${++crSeq}`;
        bulkSizes.set(id, (input as { records: unknown[] }).records.length);
        return { id };
      },
    },
    records: {
      changeRequest: async (input: unknown) => {
        record(`records.changeRequest:${(input as { operation: string }).operation}`, input);
        return { id: `crq_${++crSeq}` };
      },
    },
    views: {
      changeRequest: async (input: unknown) => {
        record(`views.changeRequest:${(input as { operation: string }).operation}`, input);
        return { id: `crq_${++crSeq}` };
      },
    },
    docs: {
      create: async (input: unknown) => {
        record("docs.create", input);
        return { materialized: true as const, node: { id: `nod_${++nodeSeq}` } };
      },
    },
    changeRequests: {
      review: async (input: unknown) => {
        record("changeRequests.review", input);
        const [changeRequestId] = (input as { changeRequestIds: string[] }).changeRequestIds;
        return {
          results: [
            {
              changeRequestId,
              ok: true as const,
              status: "approved",
              changeRequest: { id: changeRequestId, status: "approved" },
            },
          ],
        };
      },
      merge: async (input: unknown) => {
        record("changeRequests.merge", input);
        const [changeRequestId] = (input as { changeRequestIds: string[] }).changeRequestIds;
        const size = bulkSizes.get(changeRequestId) ?? 0;
        return {
          results: [
            {
              changeRequestId,
              ok: true as const,
              status: "merged",
              changeRequest: {
                operations: Array.from({ length: size }, (_, index) => ({
                  operation: "record_create",
                  position: index,
                  mergedRecordId: `rec_new_${++recordSeq}`,
                })),
              },
              record: null,
              view: null,
            },
          ],
        };
      },
    },
  };
  return { calls, client: client as unknown as PackageClient };
};

const relationBase = (
  slug: string,
  targetBaseSlug: string,
  inverseFieldSlug: string,
): PackageBaseNode => ({
  type: "base",
  slug,
  name: slug,
  description: "",
  position: 0,
  base: {
    name: slug,
    description: "",
    position: 0,
    fields: [
      { slug: "title", name: "Title", type: "text", required: true, position: 0, options: {} },
      {
        slug: "link",
        name: "Link",
        type: "relation",
        required: false,
        position: 1,
        options: { multiple: true, targetBaseSlug, inverseFieldSlug },
      },
    ],
    views: [],
  },
  records: [],
});

const planFor = (nodes: PackageTree["nodes"], assets?: PackageTree["assets"]) =>
  buildInstallPlan(
    {
      manifest: { format: PACKAGE_FORMAT, name: "my-package", description: "", tags: [] },
      nodes,
      assets,
    },
    { targetFolder: undefined, existingNodeSlugsByType: new Map() },
  );

describe("target folder", () => {
  it("reuses an existing workspace root instead of creating a second root folder", async () => {
    const { calls, client } = createFakeServer();
    const plan = buildInstallPlan(
      {
        manifest: { format: PACKAGE_FORMAT, name: "root", description: "", tags: [] },
        nodes: [
          { type: "doc", slug: "guide", name: "Guide", description: "", position: 0, body: "" },
        ],
      },
      {
        targetFolder: {
          id: "nod_root",
          slug: "root",
          type: "folder",
          children: [],
        },
        existingNodeSlugsByType: new Map([["folder", new Set(["root"])]]),
      },
    );

    const result = await applyInstall(client, plan, { autoMerge: true });

    expect(result.targetFolderNodeId).toBe("nod_root");
    expect(result.created.folders).toBe(0);
    expect(calls.some((call) => call.method === "nodes.createChangeRequest")).toBe(false);
    const docCreate = calls.find((call) => call.method === "docs.create");
    expect((docCreate?.input as { parentNodeId: string }).parentNodeId).toBe("nod_root");
  });
});

describe("package-only option keys never reach the API", () => {
  it("strips inverseFieldSlug and ai.sourceFieldSlugs from every payload", async () => {
    const { calls, client } = createFakeServer();
    const plan = planFor([relationBase("a", "b", "link"), relationBase("b", "a", "link")]);
    await applyInstall(client, plan, { autoMerge: true });

    const serialized = JSON.stringify(calls);
    expect(serialized).not.toContain("inverseFieldSlug");
    expect(serialized).not.toContain("sourceFieldSlugs");
    // The native alias, by contrast, is exactly what the server expects.
    expect(serialized).toContain("targetBaseSlug");
  });

  it("strips them from an AI field's options too", async () => {
    const { calls, client } = createFakeServer();
    const node: PackageBaseNode = {
      type: "base",
      slug: "posts",
      name: "posts",
      description: "",
      position: 0,
      base: {
        name: "posts",
        description: "",
        position: 0,
        fields: [
          { slug: "title", name: "Title", type: "text", required: true, position: 0, options: {} },
          {
            slug: "summary",
            name: "Summary",
            type: "ai_summary",
            required: false,
            position: 1,
            options: { ai: { model: "haiku", prompt: "Sum", sourceFieldSlugs: ["title"] } },
          },
        ],
        views: [],
      },
      records: [],
    };
    await applyInstall(client, planFor([node]), { autoMerge: true });
    expect(JSON.stringify(calls)).not.toContain("sourceFieldSlugs");
  });

  it("toApiFieldOptions keeps the native alias and drops only the package-only keys", () => {
    expect(
      toApiFieldOptions({
        multiple: true,
        targetBaseSlug: "vendors",
        inverseFieldSlug: "products",
        choices: [{ id: "live", name: "Live" }],
        ai: { model: "haiku", sourceFieldSlugs: ["title"] },
      }),
    ).toEqual({
      multiple: true,
      targetBaseSlug: "vendors",
      choices: [{ id: "live", name: "Live" }],
      ai: { model: "haiku" },
    });
  });
});

describe("the five passes", () => {
  it("defers relation fields out of bases.create and into a later createField", async () => {
    const { calls, client } = createFakeServer();
    await applyInstall(
      client,
      planFor([relationBase("a", "b", "link"), relationBase("b", "a", "link")]),
      { autoMerge: true },
    );

    // Pass 1: bases.create carries the plain field only.
    const creates = calls.filter((call) => call.method === "bases.create");
    expect(creates).toHaveLength(2);
    for (const call of creates) {
      const fields = (call.input as { fields: { slug: string }[] }).fields;
      expect(fields.map((field) => field.slug)).toEqual(["title"]);
    }

    // Pass 2: both relation fields are added after BOTH bases exist — which is what a
    // cyclic A↔B pair needs and no base ordering could provide.
    const createFields = calls.filter((call) => call.method === "bases.createField");
    expect(createFields).toHaveLength(2);
    const firstCreateField = calls.findIndex((call) => call.method === "bases.createField");
    const lastBaseCreate = calls.map((call) => call.method).lastIndexOf("bases.create");
    expect(firstCreateField).toBeGreaterThan(lastBaseCreate);
  });

  it("patches inverseFieldId to a real field id in pass 3", async () => {
    const { calls, client } = createFakeServer();
    await applyInstall(
      client,
      planFor([relationBase("a", "b", "link"), relationBase("b", "a", "link")]),
      { autoMerge: true },
    );
    const patches = calls.filter((call) => call.method === "bases.fieldChangeRequest:update");
    expect(patches).toHaveLength(2);
    for (const patch of patches) {
      const options = (patch.input as { patch: { options: Record<string, unknown> } }).patch
        .options;
      expect(options.inverseFieldId).toMatch(/^bsf_/);
      expect(options).not.toHaveProperty("inverseFieldSlug");
    }
  });

  it("omits relation values from pass 4 and sets them in pass 5", async () => {
    const { calls, client } = createFakeServer();
    const a = relationBase("a", "b", "link");
    a.records = [{ key: "k1", fields: { title: "One", link: ["k2"] } }];
    const b = relationBase("b", "a", "link");
    b.records = [{ key: "k2", fields: { title: "Two" } }];
    await applyInstall(client, planFor([a, b]), { autoMerge: true });

    // Pass 4: relation values would be SILENTLY DROPPED server-side (their targets do
    // not exist yet), so they must not be sent here.
    const bulk = calls.filter((call) => call.method === "bases.createBulkChangeRequest");
    const proposed = bulk.flatMap(
      (call) => (call.input as { records: Record<string, unknown>[] }).records,
    );
    for (const proposedRecord of proposed) expect(proposedRecord).not.toHaveProperty("link");

    // Pass 5: the link is set to the newly minted id, not the package key.
    const updates = calls.filter((call) => call.method === "records.changeRequest:update");
    expect(updates).toHaveLength(1);
    const fields = (updates[0].input as { fields: Record<string, unknown> }).fields;
    expect(fields.link).toEqual(["rec_new_2"]);
    expect(fields.link).not.toContain("k2");
  });

  it("resends non-relation values in pass 5, because a revise REPLACES the field map", async () => {
    const { calls, client } = createFakeServer();
    const a = relationBase("a", "b", "link");
    a.records = [{ key: "k1", fields: { title: "One", link: ["k2"] } }];
    const b = relationBase("b", "a", "link");
    b.records = [{ key: "k2", fields: { title: "Two" } }];
    await applyInstall(client, planFor([a, b]), { autoMerge: true });

    const update = calls.find((call) => call.method === "records.changeRequest:update");
    const fields = (update?.input as { fields: Record<string, unknown> }).fields;
    // Sending only { link } would blank `title` — the revise commit stores exactly the
    // fields it is given.
    expect(fields.title).toBe("One");
  });

  it("batches records and merges every change request through review", async () => {
    const { calls, client } = createFakeServer();
    const node = relationBase("a", "b", "link");
    node.records = Array.from({ length: RECORD_BATCH_SIZE + 5 }, (_, index) => ({
      key: `k${String(index).padStart(4, "0")}`,
      fields: { title: `Row ${index}` },
    }));
    await applyInstall(client, planFor([node, relationBase("b", "a", "link")]), {
      autoMerge: true,
    });

    const bulk = calls.filter((call) => call.method === "bases.createBulkChangeRequest");
    expect(bulk).toHaveLength(2);
    expect((bulk[0].input as { records: unknown[] }).records).toHaveLength(RECORD_BATCH_SIZE);
    expect((bulk[1].input as { records: unknown[] }).records).toHaveLength(5);

    // Merging requires an approved status, so every merge is preceded by a review.
    const reviews = calls.filter((call) => call.method === "changeRequests.review").length;
    const merges = calls.filter((call) => call.method === "changeRequests.merge").length;
    expect(reviews).toBe(merges);
  });

  it("sets a deterministic idempotency key per batch (§7.5)", async () => {
    const { calls, client } = createFakeServer();
    const node = relationBase("a", "b", "link");
    node.records = [{ key: "k1", fields: { title: "One" } }];
    await applyInstall(client, planFor([node, relationBase("b", "a", "link")]), {
      autoMerge: true,
    });

    const bulk = calls.find((call) => call.method === "bases.createBulkChangeRequest");
    expect((bulk?.input as { idempotencyKey: string }).idempotencyKey).toBe("pkg:my-package:k1");
  });

  it("skips computed field values, keeping only the definitions", async () => {
    const { calls, client } = createFakeServer();
    const node: PackageBaseNode = {
      type: "base",
      slug: "posts",
      name: "posts",
      description: "",
      position: 0,
      base: {
        name: "posts",
        description: "",
        position: 0,
        fields: [
          { slug: "title", name: "Title", type: "text", required: true, position: 0, options: {} },
          {
            slug: "made",
            name: "Made",
            type: "created_time",
            required: false,
            position: 1,
            options: {},
          },
        ],
        views: [],
      },
      records: [{ key: "k1", fields: { title: "One", made: "2026-01-01T00:00:00Z" } }],
    };
    await applyInstall(client, planFor([node]), { autoMerge: true });
    const bulk = calls.find((call) => call.method === "bases.createBulkChangeRequest");
    const proposed = (bulk?.input as { records: Record<string, unknown>[] }).records[0];
    expect(proposed).toEqual({ title: "One" });
  });

  it("proposes docs as change requests without --auto-merge", async () => {
    const { calls, client } = createFakeServer();
    const plan = planFor([
      { type: "doc", slug: "faq", name: "FAQ", description: "", position: 0, body: "hi" },
    ]);
    const result = await applyInstall(client, plan, { autoMerge: false });
    expect(calls.some((call) => call.method === "docs.create")).toBe(true);
    expect(result.created.folders).toBe(1);
  });

  /**
   * Regression: a plain Base's records used to be dropped on the floor by a
   * review-first install. `bases.create` without autoMerge returns a PENDING change
   * request and therefore no base id, apply bailed out at "not materialized", and the
   * records — the whole point of the package — silently never got proposed. The user
   * merged the change request and got an empty Base, with no error and no warning.
   */
  it("proposes a plain Base's records for review without --auto-merge (never drops them)", async () => {
    const { calls, client } = createFakeServer();
    const plan = planFor([
      {
        type: "base",
        slug: "blog",
        name: "Blog",
        description: "",
        position: 0,
        base: {
          name: "Blog",
          description: "",
          fields: [
            {
              slug: "title",
              name: "Title",
              type: "text",
              required: true,
              position: 0,
              options: {},
            },
          ],
          views: [],
        },
        records: [{ key: "k1", fields: { title: "One" } }],
      },
    ]);
    const result = await applyInstall(client, plan, { autoMerge: false });

    // The Base is structure: created immediately, so it HAS an id to hang records on.
    const create = calls.find((call) => call.method === "bases.create");
    expect((create?.input as { autoMerge?: boolean }).autoMerge).toBe(true);

    // The records are content: proposed, and left pending for a human.
    const bulk = calls.find((call) => call.method === "bases.createBulkChangeRequest");
    expect(bulk).toBeDefined();
    expect((bulk?.input as { records: unknown[] }).records).toHaveLength(1);
    expect(calls.some((call) => call.method === "changeRequests.merge")).toBe(false);
    expect(result.pendingChangeRequests).toBeGreaterThan(0);
    expect(result.created.records).toBe(0);
  });

  it("merges a plain Base's records on the spot with --auto-merge", async () => {
    const { calls, client } = createFakeServer();
    const plan = planFor([
      {
        type: "base",
        slug: "blog",
        name: "Blog",
        description: "",
        position: 0,
        base: {
          name: "Blog",
          description: "",
          fields: [
            {
              slug: "title",
              name: "Title",
              type: "text",
              required: true,
              position: 0,
              options: {},
            },
          ],
          views: [],
        },
        records: [{ key: "k1", fields: { title: "One" } }],
      },
    ]);
    const result = await applyInstall(client, plan, { autoMerge: true });
    expect(calls.some((call) => call.method === "changeRequests.merge")).toBe(true);
    expect(result.created.records).toBe(1);
  });
});

describe("doc images the package carries", () => {
  /** The PUT of the bytes to the presigned url — the one step that is not an oRPC call. */
  const stubUploadFetch = () => {
    const put = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", put);
    return put;
  };

  const docNode = (body: string): PackageTree["nodes"][number] => ({
    type: "doc",
    slug: "spec",
    name: "Spec",
    description: "",
    position: 0,
    body,
  });

  const pngAsset = (assetId: string) => ({
    assetId,
    fileName: "diagram.png",
    mimeType: "image/png",
    contentHash: "sha256:abc",
    bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  });

  beforeEach(() => stubUploadFetch());
  afterEach(() => vi.unstubAllGlobals());

  it("uploads the bytes and rewrites the body to the NEW asset id", async () => {
    const { calls, client } = createFakeServer();
    const plan = planFor([docNode("# Spec\n\n![](/api/assets/astold/raw)")], [pngAsset("astold")]);
    const result = await applyInstall(client, plan, { autoMerge: true });

    const created = calls.find((call) => call.method === "docs.create");
    const body = (created?.input as { body: string }).body;
    // The old id is host-local and does not exist here; the new one does.
    expect(body).toContain("/api/assets/ast_new_1/raw");
    expect(body).not.toContain("astold");
    expect(result.warnings).toEqual([]);
  });

  it("uploads before creating the doc — the map has to exist when the body is written", async () => {
    const { calls, client } = createFakeServer();
    await applyInstall(
      client,
      planFor([docNode("![](/api/assets/astold/raw)")], [pngAsset("astold")]),
      { autoMerge: true },
    );
    const methods = calls.map((call) => call.method);
    expect(methods.indexOf("assets.confirm")).toBeLessThan(methods.indexOf("docs.create"));
  });

  it("records the image under the same upload context the Doc editor uses", async () => {
    const { calls, client } = createFakeServer();
    await applyInstall(
      client,
      planFor([docNode("![](/api/assets/astold/raw)")], [pngAsset("astold")]),
      { autoMerge: true },
    );
    expect(
      (calls.find((c) => c.method === "assets.confirm")?.input as { context: string }).context,
    ).toBe("doc");
  });

  it("carries an image shared by two docs once, and rewrites both", async () => {
    const { calls, client } = createFakeServer();
    const plan = planFor(
      [
        docNode("![](/api/assets/astold/raw)"),
        { ...docNode("![](/api/assets/astold/raw)"), slug: "other", name: "Other", position: 1 },
      ],
      [pngAsset("astold")],
    );
    await applyInstall(client, plan, { autoMerge: true });

    expect(calls.filter((call) => call.method === "assets.confirm")).toHaveLength(1);
    for (const call of calls.filter((call) => call.method === "docs.create")) {
      expect((call.input as { body: string }).body).toContain("/api/assets/ast_new_1/raw");
    }
  });

  it("leaves a reference the package did not carry alone, and warns naming it", async () => {
    const { calls, client } = createFakeServer();
    const plan = planFor(
      [docNode("![carried](/api/assets/astold/raw) ![missing](/api/assets/astgone/raw)")],
      [pngAsset("astold")],
    );
    const result = await applyInstall(client, plan, { autoMerge: true });

    const body = (calls.find((call) => call.method === "docs.create")?.input as { body: string })
      .body;
    // A partial map must never corrupt what it does not know about.
    expect(body).toContain("/api/assets/ast_new_1/raw");
    expect(body).toContain("/api/assets/astgone/raw");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("astgone");
    expect(result.warnings[0]).not.toContain("astold");
  });

  it("says nothing about a doc whose every image was carried", async () => {
    const { client } = createFakeServer();
    const result = await applyInstall(
      client,
      planFor([docNode("![](/api/assets/astold/raw)")], [pngAsset("astold")]),
      { autoMerge: true },
    );
    expect(result.warnings).toEqual([]);
  });

  it("still warns for a package from an older exporter that carries no assets at all", async () => {
    const { client } = createFakeServer();
    const result = await applyInstall(client, planFor([docNode("![](/api/assets/astold/raw)")]), {
      autoMerge: true,
    });
    expect(result.warnings[0]).toContain("astold");
  });

  it("skips the image (not the install) when the host cannot take a client upload", async () => {
    const { calls, client } = createFakeServer();
    // A local-disk host answers with a root-relative relay sentinel only its own
    // web UI understands — see uploadAsset.
    const original = client.assets.createUploadUrl;
    client.assets.createUploadUrl = (async (input: unknown) => {
      const result = (await original(input as never)) as { uploadUrl: string };
      return { ...result, uploadUrl: "/api/storage/upload" };
    }) as typeof client.assets.createUploadUrl;

    const result = await applyInstall(
      client,
      planFor([docNode("![](/api/assets/astold/raw)")], [pngAsset("astold")]),
      { autoMerge: true },
    );

    // The doc still installs, with its original reference and two warnings: the
    // skipped upload, and the image the doc is therefore missing.
    expect(calls.some((call) => call.method === "docs.create")).toBe(true);
    expect(result.warnings.join("\n")).toContain("diagram.png");
    expect(result.warnings.join("\n")).toContain("astold");
  });
});

describe("batchIdempotencyKey", () => {
  it("is stable for the same package and batch", () => {
    expect(batchIdempotencyKey("support-kb", "rec_01J")).toBe("pkg:support-kb:rec_01J");
  });
});
