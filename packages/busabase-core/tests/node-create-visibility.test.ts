/**
 * `visibility` passed when a node is CREATED must be honoured for every node
 * type, on both create paths:
 *
 *   - direct: the actor can write the parent, so the endpoint inserts the node
 *     in the same call;
 *   - review-first: the endpoint files a pending node_create change request,
 *     and the node only exists once someone merges it.
 *
 * Reproduced before the fix with `busabase-cli nodes create --type doc
 * --visibility private --auto-merge`: the call succeeded and the Doc came out
 * with `explicitVisibility: null`, readable by everyone in the space. The Doc,
 * Base and File create endpoints had no `visibility` field (their schemas
 * stripped it), and the `node_create` task dropped it for every type outside
 * Skill/Drive/AirApp.
 *
 * Asserted the way a member experiences it — can another member still open the
 * node? — and not only on the column, with a no-visibility control so the
 * member check cannot pass vacuously. The second block drives the real
 * `node_create` task (what the CLI and MCP run) against the in-process router.
 */
import { createHash } from "node:crypto";
import { createRouterClient } from "@orpc/server";
import { type BusabaseTaskClient, nodeCreateTask } from "busabase-contract/tasks";
import { storage } from "openlib/storage";
import { beforeAll, describe, expect, it } from "vitest";
import { LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import { getEffectiveNodeLevel } from "../src/logic/node-acl";
import { busabaseRouter } from "../src/router";
import { seedScenario } from "./helpers/seed-scenario";

type RawClient = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const asOwner = <T>(fn: () => Promise<T>) =>
  runWithBusabaseContext(
    { spaceId: LOCAL_SPACE_ID, actorId: "usr_owner_alice", isSpaceManager: true },
    fn,
  );

/** A plain member of an open space: no grant on anything this file creates. */
const memberCanOpen = (nodeId: string) =>
  runWithBusabaseContext(
    {
      spaceId: LOCAL_SPACE_ID,
      actorId: "usr_member_bob",
      isSpaceManager: false,
      permissionLevel: "write",
      restrictedVisibility: false,
    },
    async () => (await getEffectiveNodeLevel(nodeId)) !== null,
  );

type CreatedType = "doc" | "base" | "file" | "folder";

describe("create-time visibility", () => {
  let raw: RawClient;
  let assetCounter = 0;

  beforeAll(async () => {
    await seedScenario("node-create-visibility");
    raw = createRouterClient(busabaseRouter);
  });

  /** A confirmed Asset to back a File node; each call uploads distinct bytes. */
  const uploadAsset = async (): Promise<string> => {
    assetCounter += 1;
    const bytes = Buffer.from(`visibility fixture ${assetCounter}`);
    const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const meta = {
      fileName: `fixture-${assetCounter}.txt`,
      mimeType: "text/plain",
      sizeBytes: bytes.length,
      contentHash,
      context: "file-node" as const,
    };
    const upload = await asOwner(() => raw.assets.createUploadUrl(meta));
    await storage.uploadFileToKey(bytes, upload.storageKey, "text/plain");
    const confirmed = await asOwner(() =>
      raw.assets.confirm({ storageKey: upload.storageKey, ...meta }),
    );
    return confirmed.assetId as string;
  };

  /**
   * Create one node of `type` through its own endpoint, and return the
   * immediate result (materialized node, or pending change request).
   */
  const create = async (
    type: CreatedType,
    slug: string,
    options: { visibility?: "private"; autoMerge: boolean },
  ): Promise<{ materialized: boolean; id?: string; status?: string }> => {
    const common = {
      slug,
      name: `Node ${slug}`,
      autoMerge: options.autoMerge,
      ...(options.visibility ? { visibility: options.visibility } : {}),
    };
    if (type === "doc") return asOwner(() => raw.docs.create({ ...common, body: "secret" }));
    if (type === "base") return asOwner(() => raw.bases.create(common));
    if (type === "file") {
      const assetId = await uploadAsset();
      return asOwner(() => raw.files.create({ ...common, assetId }));
    }
    // Folders have no dedicated create endpoint: the generic node change
    // request is THE create path, and `metadata.visibility` its spelling.
    const changeRequest = await asOwner(() =>
      raw.nodes.createChangeRequest({
        autoMerge: options.autoMerge,
        operations: [
          {
            kind: "create",
            nodeType: "folder",
            slug,
            name: common.name,
            ...(options.visibility ? { metadata: { visibility: options.visibility } } : {}),
          },
        ],
      }),
    );
    return { ...changeRequest, materialized: changeRequest.status === "merged" };
  };

  const approveAndMerge = async (changeRequestId: string) => {
    await asOwner(() =>
      raw.changeRequests.review({ changeRequestIds: [changeRequestId], verdict: "approved" }),
    );
    const merged = await asOwner(() =>
      raw.changeRequests.merge({ changeRequestIds: [changeRequestId] }),
    );
    expect(merged.results[0]).toMatchObject({ ok: true });
  };

  const nodeBySlug = async (type: CreatedType, slug: string) =>
    (await asOwner(() => raw.nodes.get({ nodeId: slug, type }))).node;

  const types: CreatedType[] = ["doc", "base", "file", "folder"];

  describe.each(types)("%s", (type) => {
    it("direct create: private is stored and hides the node from members", async () => {
      const slug = `${type}-direct-private`;
      const result = await create(type, slug, { visibility: "private", autoMerge: true });
      expect(result.materialized).toBe(true);

      const node = await nodeBySlug(type, slug);
      expect(node.explicitVisibility).toBe("private");
      // Promoted out of the free-form bag, not kept as a second copy.
      expect(node.metadata).not.toHaveProperty("visibility");
      expect(await memberCanOpen(node.id)).toBe(false);
    });

    it("review-first create: private survives review and applies on merge", async () => {
      const slug = `${type}-pending-private`;
      const pending = await create(type, slug, { visibility: "private", autoMerge: false });
      expect(pending.materialized).toBe(false);
      expect(pending.status).toBe("in_review");

      await approveAndMerge(pending.id as string);

      const node = await nodeBySlug(type, slug);
      expect(node.explicitVisibility).toBe("private");
      expect(await memberCanOpen(node.id)).toBe(false);
    });

    // Control: without it, a member check that always says "hidden" would pass
    // both tests above.
    it("no visibility: the node follows the space default and members see it", async () => {
      const slug = `${type}-direct-default`;
      await create(type, slug, { autoMerge: true });

      const node = await nodeBySlug(type, slug);
      expect(node.explicitVisibility).toBeNull();
      expect(await memberCanOpen(node.id)).toBe(true);
    });
  });

  describe("through the node_create task (what the CLI and MCP run)", () => {
    const taskClient = () => raw as unknown as BusabaseTaskClient;

    it.each(types)(
      "%s: --visibility private merges private with nothing to report",
      async (type) => {
        const slug = `task-${type}-direct`;
        const result = await asOwner(async () =>
          nodeCreateTask.execute(taskClient(), {
            type,
            slug,
            name: `Task ${type}`,
            visibility: "private",
            autoMerge: true,
            ...(type === "file" ? { assetId: await uploadAsset() } : {}),
          }),
        );

        expect(result).not.toHaveProperty("visibilityWrite");
        const node = await nodeBySlug(type, slug);
        expect(node.explicitVisibility).toBe("private");
        expect(await memberCanOpen(node.id)).toBe(false);
      },
    );

    it.each(types)(
      "%s: --visibility private --require-review carries it into the proposal",
      async (type) => {
        const slug = `task-${type}-pending`;
        const result = (await asOwner(async () =>
          nodeCreateTask.execute(taskClient(), {
            type,
            slug,
            name: `Task ${type}`,
            visibility: "private",
            requireReview: true,
            ...(type === "file" ? { assetId: await uploadAsset() } : {}),
          }),
        )) as { id: string; status: string };

        // The task inspected the real proposal and found the value in it.
        expect(result).not.toHaveProperty("visibilityWrite");
        expect(result.status).toBe("in_review");

        await approveAndMerge(result.id);
        const node = await nodeBySlug(type, slug);
        expect(node.explicitVisibility).toBe("private");
        expect(await memberCanOpen(node.id)).toBe(false);
      },
    );
  });
});
