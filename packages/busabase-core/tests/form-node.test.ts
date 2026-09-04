import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { createRouterClient } from "@orpc/server";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOCAL_SPACE_ID, runWithAnonymousContext, runWithBusabaseContext } from "../src/context";
import { getDb } from "../src/db";
import { DEMO_BASES, DEMO_FOLDERS } from "../src/demo/dataset";
import {
  createForm,
  getFormByNodeId,
  listForms,
  submitForm,
  updateForm,
} from "../src/domains/form/logic/form-ops";
import { busabaseForms } from "../src/domains/form/schema";
import { getPublicScopeOf } from "../src/logic/node-acl";
import { seedScenario } from "../src/logic/seed";
import { busabaseRouter } from "../src/router";

/**
 * Form-as-Node: the submission spine and its access gates.
 *
 * Submitting must produce an approval-first record-create ChangeRequest on the
 * target Base (never a direct write), and the share settings must be enforced
 * SERVER-side (APITable's equivalent only checked the limit in the browser).
 */
const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

describe("Form-as-Node — submission + access gates", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;
  let openApiHandler: OpenAPIHandler<Record<never, never>>;
  let blogBaseId = "";
  let formNodeId = "";
  let publicFormNodeId = "";
  let listFormNodeIds: string[] = [];
  const listFormIds: string[] = [];
  let openApiFormNodeId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-form-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-form-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
    openApiHandler = new OpenAPIHandler(busabaseRouter);
    await seedScenario({ folders: DEMO_FOLDERS, bases: DEMO_BASES });

    const bases = await client.bases.list({});
    blogBaseId = bases.find((b) => b.slug === "blog")?.id ?? "";

    // A form node to bind the form row to.
    await client.nodes.createChangeRequest({
      autoMerge: true,
      operations: [
        { kind: "create", nodeType: "form", slug: "t-form", name: "T Form" },
        {
          kind: "create",
          nodeType: "form",
          slug: "t-public-form",
          name: "T Public Form",
        },
        { kind: "create", nodeType: "form", slug: "t-list-form-a", name: "List Form A" },
        { kind: "create", nodeType: "form", slug: "t-list-form-b", name: "List Form B" },
        { kind: "create", nodeType: "form", slug: "t-list-form-c", name: "List Form C" },
        {
          kind: "create",
          nodeType: "form",
          slug: "t-openapi-form",
          name: "OpenAPI Form",
        },
      ],
    });
    const nodes = await client.nodes.list({});
    const flat: Array<{ id: string; slug: string; type: string; children?: unknown[] }> = [];
    const walk = (list: unknown[]) => {
      for (const raw of list) {
        const n = raw as { id: string; slug: string; type: string; children?: unknown[] };
        flat.push(n);
        if (n.children?.length) {
          walk(n.children);
        }
      }
    };
    walk(nodes as unknown[]);
    formNodeId = flat.find((n) => n.slug === "t-form" && n.type === "form")?.id ?? "";
    publicFormNodeId = flat.find((n) => n.slug === "t-public-form" && n.type === "form")?.id ?? "";
    listFormNodeIds = flat
      .filter((n) => n.slug.startsWith("t-list-form-") && n.type === "form")
      .map((n) => n.id);
    openApiFormNodeId =
      flat.find((n) => n.slug === "t-openapi-form" && n.type === "form")?.id ?? "";

    await createForm({
      nodeId: publicFormNodeId,
      targetBaseId: blogBaseId,
      name: "T Public Form",
      bindings: [
        { inputName: "subject", fieldSlug: "title", required: true },
        { inputName: "msg", fieldSlug: "body", required: true },
      ],
    });
    for (const [index, nodeId] of listFormNodeIds.entries()) {
      const created = await createForm({
        nodeId,
        targetBaseId: blogBaseId,
        name: `List Form ${index + 1}`,
        share: { isPublic: true, anonymousSubmit: false },
      });
      expect(created.share.anonymousSubmit).toBe(false);
      listFormIds.push(created.id);
    }
    await (await getDb())
      .update(busabaseForms)
      .set({ createdAt: new Date("2099-01-01T00:00:00.000Z") })
      .where(inArray(busabaseForms.nodeId, listFormNodeIds));
  }, 120_000);

  afterAll(async () => {
    process.chdir(originalCwd);
    await rm(dataDir, { force: true, recursive: true });
    await rm(storageDir, { force: true, recursive: true });
  });

  it("turns a submission into a record-create ChangeRequest (not a direct write)", async () => {
    expect(formNodeId).not.toBe("");
    await createForm({
      nodeId: formNodeId,
      targetBaseId: blogBaseId,
      name: "T Form",
      bindings: [
        { inputName: "subject", fieldSlug: "title", required: true },
        { inputName: "msg", fieldSlug: "body", required: true },
      ],
    });

    const { records: before } = await client.records.list({});
    const result = await submitForm(formNodeId, {
      values: { subject: "Hello", msg: "Body text" },
    });
    expect(result.status).toBe("pending_review");

    // No record yet — it's pending review.
    const { records: after } = await client.records.list({});
    expect(after.length).toBe(before.length);

    // Merging the CR materializes the record with the submitted values.
    await client.changeRequests.review({
      changeRequestIds: [result.changeRequestId],
      verdict: "approved",
    });
    await client.changeRequests.merge({ changeRequestIds: [result.changeRequestId] });
    const { records: merged } = await client.records.list({});
    expect(merged.length).toBe(before.length + 1);
    expect(
      merged.some((r) => (r.headCommit.payload as Record<string, unknown>).title === "Hello"),
    ).toBe(true);
  });

  it("allows multiple forms for one Base and returns stable cursor pages", async () => {
    expect(listFormNodeIds).toHaveLength(3);
    const expectedIds = [...listFormIds].sort((left, right) => right.localeCompare(left));

    const first = await client.forms.list({ targetBaseId: blogBaseId, limit: 2 });
    expect(first.forms.map((form) => form.id)).toEqual(expectedIds.slice(0, 2));
    expect(first.forms.every((form) => form.targetBaseId === blogBaseId)).toBe(true);
    expect(first.nextCursor).not.toBeNull();

    const second = await listForms({
      targetBaseId: blogBaseId,
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.forms[0]?.id).toBe(expectedIds[2]);
    expect(new Set([...first.forms, ...second.forms].map((form) => form.id)).size).toBe(
      first.forms.length + second.forms.length,
    );
  });

  it("returns anonymousSubmit=false from the real POST /api/v1/forms route", async () => {
    const result = await openApiHandler.handle(
      new Request("http://busabase.test/api/v1/forms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nodeId: openApiFormNodeId,
          targetBaseId: blogBaseId,
          name: "OpenAPI Form",
          bindings: [{ inputName: "subject", fieldSlug: "title", required: true }],
          share: { isPublic: true, anonymousSubmit: false },
        }),
      }),
      { context: {} },
    );
    if (!result.matched) throw new Error("POST /api/v1/forms did not match the OpenAPI router");

    expect(result.response.status).toBe(200);
    const body = (await result.response.json()) as {
      nodeId: string;
      share: { anonymousSubmit: boolean; isPublic: boolean };
    };
    expect(body).toMatchObject({
      nodeId: openApiFormNodeId,
      share: { isPublic: true, anonymousSubmit: false },
    });
  });

  it("rejects an invalid form cursor instead of repeating the first page", async () => {
    await expect(
      client.forms.list({ targetBaseId: blogBaseId, cursor: "not-a-valid-cursor" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: { errorCode: "INVALID_FORM_CURSOR" },
    });
  });

  it("rejects duplicate form creation with a structured conflict", async () => {
    await expect(
      createForm({
        nodeId: listFormNodeIds[0] ?? "",
        targetBaseId: blogBaseId,
        name: "Duplicate form",
        share: { isPublic: true, anonymousSubmit: true },
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      data: { errorCode: "FORM_ALREADY_EXISTS", nodeId: listFormNodeIds[0] },
    });

    const [row] = await (await getDb())
      .select({ anonymousSubmit: busabaseForms.share })
      .from(busabaseForms)
      .where(eq(busabaseForms.nodeId, listFormNodeIds[0] ?? ""));
    expect(row?.anonymousSubmit.anonymousSubmit).toBe(false);
  });

  it("rejects a required field that the page did not fill", async () => {
    await expect(submitForm(formNodeId, { values: { subject: "No body" } })).rejects.toThrow(
      /Missing required fields|Body is required/,
    );
  });

  it("rejects anonymous submission to a private form", async () => {
    await expect(
      submitForm(formNodeId, { values: { subject: "a", msg: "b" } }, { isAnonymous: true }),
    ).rejects.toThrow(/not public/i);
  });

  it("rejects anonymous submission when the public form requires sign-in", async () => {
    await updateForm(formNodeId, {
      share: { isPublic: true, anonymousSubmit: false },
    });
    await expect(
      submitForm(formNodeId, { values: { subject: "a", msg: "b" } }, { isAnonymous: true }),
    ).rejects.toThrow(/sign-in/i);
  });

  it("enforces submitLimit server-side", async () => {
    // Allow anonymous, and cap at the submissions already recorded.
    await updateForm(formNodeId, {
      share: { isPublic: true, anonymousSubmit: true, submitLimit: 1 },
    });
    // One submission was already accepted by the first test, so the cap is hit.
    await expect(
      submitForm(formNodeId, { values: { subject: "over", msg: "limit" } }, { isAnonymous: true }),
    ).rejects.toThrow(/submission limit/i);
  });

  it("submits through the anonymous Router without exposing the target Base", async () => {
    expect(publicFormNodeId).not.toBe("");
    const target = await client.bases.get({ baseId: blogBaseId });
    if (!target) throw new Error("expected target Base");

    await client.nodes.share.set({
      nodeId: publicFormNodeId,
      scope: "public",
      capability: "submit",
    });
    await updateForm(publicFormNodeId, {
      share: { isPublic: true, anonymousSubmit: false },
    });

    await runWithAnonymousContext({}, async () => {
      const publicForm = await client.forms.getByNode({ nodeId: publicFormNodeId });
      expect(publicForm).toMatchObject({ nodeId: publicFormNodeId });
      expect(publicForm?.boundFields).toEqual([
        expect.objectContaining({ slug: "title", type: "text" }),
        expect.objectContaining({ slug: "body", type: "markdown" }),
      ]);
      await expect(
        client.forms.submit({
          nodeId: publicFormNodeId,
          values: { subject: "Login required", msg: "Should be rejected" },
        }),
      ).rejects.toThrow(/sign-in/i);
    });

    await updateForm(publicFormNodeId, {
      share: { isPublic: true, anonymousSubmit: true },
    });
    await client.nodes.share.set({
      nodeId: publicFormNodeId,
      scope: "public",
      capability: "read",
    });
    await runWithAnonymousContext({}, async () => {
      await expect(
        client.forms.submit({
          nodeId: publicFormNodeId,
          values: { subject: "Read only", msg: "Should be rejected" },
        }),
      ).rejects.toThrow(/anonymous/i);
    });

    await client.nodes.share.set({
      nodeId: publicFormNodeId,
      scope: "public",
      capability: "submit",
    });
    const { records: before } = await client.records.list({});
    const submission = await runWithAnonymousContext({}, () =>
      client.forms.submit({
        nodeId: publicFormNodeId,
        values: { subject: "Public submission", msg: "Pending review" },
      }),
    );
    expect(submission.status).toBe("pending_review");

    const { records: after } = await client.records.list({});
    expect(after).toHaveLength(before.length);
    expect(await getPublicScopeOf(target.nodeId)).toBeNull();
    await runWithAnonymousContext({}, async () => {
      await expect(client.bases.get({ baseId: blogBaseId })).rejects.toThrow(/not found/i);
    });
  });

  it("accepts an anonymous submission that names the form by node SLUG", async () => {
    // The public link is `/<nodeType>/<node slug>` and the dashboard route
    // passes that URL segment straight through as `nodeId` — so the slug, not
    // the id, is what every real visitor sends. Every other anonymous test here
    // uses the id, which is how an id-only capability gate shipped looking fine.
    const slug = "t-public-form";
    await client.nodes.share.set({
      nodeId: publicFormNodeId,
      scope: "public",
      capability: "submit",
    });
    await updateForm(publicFormNodeId, { share: { isPublic: true, anonymousSubmit: true } });

    const { records: before } = await client.records.list({});
    const submission = await runWithAnonymousContext({}, async () => {
      await expect(client.forms.getByNode({ nodeId: slug })).resolves.toMatchObject({
        nodeId: publicFormNodeId,
      });
      return client.forms.submit({
        nodeId: slug,
        values: { subject: "Slug submission", msg: "Pending review" },
      });
    });
    expect(submission.status).toBe("pending_review");
    const { records: after } = await client.records.list({});
    expect(after).toHaveLength(before.length);

    // A read-only share still refuses the slug path, at BOTH layers: the router
    // guard (reachability) and the handler's own check on the resolved node id.
    await client.nodes.share.set({
      nodeId: publicFormNodeId,
      scope: "public",
      capability: "read",
    });
    await runWithAnonymousContext({}, async () => {
      await expect(
        client.forms.submit({
          nodeId: slug,
          values: { subject: "Read only", msg: "Should be rejected" },
        }),
      ).rejects.toThrow(/anonymous|read-only/i);
      await expect(
        submitForm(
          slug,
          { values: { subject: "Read only", msg: "Rejected" } },
          { isAnonymous: true },
        ),
      ).rejects.toThrow(/read-only/i);
    });

    await client.nodes.share.set({
      nodeId: publicFormNodeId,
      scope: "public",
      capability: "submit",
    });
  });

  it("hides an archived Form and rejects member and anonymous submissions", async () => {
    const created = await client.nodes.createChangeRequest({
      autoMerge: true,
      operations: [
        {
          kind: "create",
          nodeType: "form",
          slug: "t-archived-form",
          name: "Archived Form",
        },
      ],
    });
    const archivedFormNodeId = created.mergeSummary.mergedNodeIds?.[0];
    if (!archivedFormNodeId) throw new Error("expected a materialized Form node");
    await createForm({
      nodeId: archivedFormNodeId,
      targetBaseId: blogBaseId,
      name: "Archived Form",
      bindings: [{ inputName: "subject", fieldSlug: "title", required: true }],
      share: { isPublic: true, anonymousSubmit: true },
    });
    await client.nodes.share.set({
      nodeId: archivedFormNodeId,
      scope: "public",
      capability: "submit",
    });
    await client.nodes.createChangeRequest({
      autoMerge: true,
      operations: [{ kind: "delete", nodeId: archivedFormNodeId }],
    });

    await expect(getFormByNodeId(archivedFormNodeId)).resolves.toBeNull();
    await expect(getFormByNodeId("t-archived-form")).resolves.toBeNull();
    const listed = await listForms({ targetBaseId: blogBaseId });
    expect(listed.forms.some((form) => form.nodeId === archivedFormNodeId)).toBe(false);
    await expect(submitForm(archivedFormNodeId, { values: { subject: "member" } })).rejects.toThrow(
      /Form not found/i,
    );

    await runWithAnonymousContext({}, async () => {
      await expect(client.forms.getByNode({ nodeId: archivedFormNodeId })).rejects.toThrow();
      await expect(
        client.forms.submit({
          nodeId: archivedFormNodeId,
          values: { subject: "anonymous" },
        }),
      ).rejects.toThrow();
    });
  });

  it("hides form configuration when its target Base is not visible", async () => {
    const target = await client.bases.get({ baseId: blogBaseId });
    if (!target) throw new Error("expected target Base");
    await client.nodes.updateVisibility({ nodeId: target.nodeId, visibility: "private" });

    const hidden = await runWithBusabaseContext(
      {
        spaceId: LOCAL_SPACE_ID,
        actorId: "form-reader",
        isSpaceManager: false,
        permissionLevel: "read",
      },
      () => getFormByNodeId(formNodeId),
    );
    expect(hidden).toBeNull();
  });
});
