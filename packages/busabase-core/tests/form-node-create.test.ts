import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import { getDb } from "../src/db";
import { busabaseNodes } from "../src/db/schema";
import { DEMO_BASES, DEMO_FOLDERS } from "../src/demo/dataset";
import { seedScenario } from "../src/logic/seed";
import { busabaseRouter } from "../src/router";

/**
 * Creating a Form from a create surface — the gap that kept the Form tile hidden.
 *
 * `busabase_forms.target_base_id` is NOT NULL, so a Form built through the
 * generic New-item flow used to be a node row with no config behind it: it
 * opened to "Form not set up yet", every time, for everyone. `materializeFormNode`
 * closes that by writing the config row inside the merge, from the `node_create`
 * operation's metadata. What matters here is that BOTH create paths do it — a
 * Form merged after review has to come out configured exactly like one created
 * immediately, or the review path quietly re-creates the dead end.
 */
const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

describe("Form node create — materializing the config row", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;
  let blogBaseId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-form-create-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-form-create-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
    await seedScenario({ folders: DEMO_FOLDERS, bases: DEMO_BASES });
    const bases = await client.bases.list({});
    blogBaseId = bases.find((base) => base.slug === "blog")?.id ?? "";
    expect(blogBaseId).toBeTruthy();
  }, 120_000);

  afterAll(async () => {
    process.chdir(originalCwd);
    await rm(dataDir, { recursive: true, force: true });
    await rm(storageDir, { recursive: true, force: true });
  });

  it("binds the form to its target Base on the immediate (auto-merge) path", async () => {
    await client.nodes.createChangeRequest({
      autoMerge: true,
      operations: [
        {
          kind: "create",
          nodeType: "form",
          slug: "c-now-form",
          name: "Leads intake",
          metadata: {
            targetBaseId: blogBaseId,
            formBindings: [{ inputName: "title", fieldSlug: "title" }],
          },
        },
      ],
    });

    const form = await client.forms.getByNode({ nodeId: "c-now-form" });
    expect(form.targetBaseId).toBe(blogBaseId);
    expect(form.name).toBe("Leads intake");
    expect(form.bindings).toEqual([{ inputName: "title", fieldSlug: "title" }]);
    // The binding resolved against the live Base — a form whose `boundFields` is
    // empty renders no inputs, which is the dead end with extra steps.
    expect(form.boundFields.map((field) => field.slug)).toEqual(["title"]);
  });

  it("binds it the same way when the create waits for review first", async () => {
    const changeRequest = await client.nodes.createChangeRequest({
      autoMerge: false,
      operations: [
        {
          kind: "create",
          nodeType: "form",
          slug: "c-review-form",
          name: "Reviewed intake",
          metadata: {
            targetBaseId: blogBaseId,
            formBindings: [{ inputName: "title", fieldSlug: "title", required: true }],
          },
        },
      ],
    });
    // Nothing exists until the change request merges.
    await expect(client.forms.getByNode({ nodeId: "c-review-form" })).rejects.toThrow();

    await client.changeRequests.review({
      changeRequestIds: [changeRequest.id],
      verdict: "approved",
    });
    const merged = await client.changeRequests.merge({ changeRequestIds: [changeRequest.id] });
    expect(merged.results[0]?.ok).toBe(true);

    const form = await client.forms.getByNode({ nodeId: "c-review-form" });
    expect(form.targetBaseId).toBe(blogBaseId);
    expect(form.bindings).toEqual([{ inputName: "title", fieldSlug: "title", required: true }]);
  });

  it("keeps the create input out of the node's metadata bag", async () => {
    const db = await getDb();
    const [node] = await db
      .select({ metadata: busabaseNodes.metadata })
      .from(busabaseNodes)
      .where(eq(busabaseNodes.slug, "c-now-form"))
      .limit(1);
    // `busabase_forms` is the single source of truth for the binding contract;
    // a second copy on the node row would be free to drift from it.
    expect(node?.metadata).not.toHaveProperty("targetBaseId");
    expect(node?.metadata).not.toHaveProperty("formBindings");
  });

  it("still creates a recoverable node when no target Base was asked for", async () => {
    await client.nodes.createChangeRequest({
      autoMerge: true,
      operations: [{ kind: "create", nodeType: "form", slug: "c-bare-form", name: "Bare form" }],
    });
    // Unconfigured, not failed: the detail view's empty state can bind it in
    // place, so an API caller that sent only the generic node fields does not
    // take somebody else's change request down with it.
    await expect(client.forms.getByNode({ nodeId: "c-bare-form" })).rejects.toThrow(/not found/i);
  });

  it("refuses to bind a form to a Base the actor only has write on", async () => {
    // Binding is what opens an inbound write funnel into the target Base, so it
    // takes `manage` there — the same bar `forms.create` applies. Without this,
    // anyone who can create a node could point a form at somebody else's Base
    // and then turn it public.
    await expect(
      runWithBusabaseContext(
        {
          spaceId: LOCAL_SPACE_ID,
          actorId: "writer",
          isSpaceManager: false,
          permissionLevel: "write",
          permissionLevelIsCeiling: true,
        },
        () =>
          client.nodes.createChangeRequest({
            autoMerge: true,
            operations: [
              {
                kind: "create",
                nodeType: "form",
                slug: "c-writer-form",
                name: "Writer form",
                metadata: { targetBaseId: blogBaseId },
              },
            ],
          }),
      ),
    ).rejects.toThrow(/manage/i);
  });

  it("refuses to bind a form to a Base that does not exist", async () => {
    await expect(
      client.nodes.createChangeRequest({
        autoMerge: true,
        operations: [
          {
            kind: "create",
            nodeType: "form",
            slug: "c-missing-base-form",
            name: "Missing base",
            metadata: { targetBaseId: "bas_does_not_exist" },
          },
        ],
      }),
    ).rejects.toThrow(/Base not found/i);
  });
});
