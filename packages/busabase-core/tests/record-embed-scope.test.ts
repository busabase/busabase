import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { runWithEmbedContext } from "../src/context";
import { busabaseBases } from "../src/db/schema";
import { listViews } from "../src/domains/base/handlers";
import {
  EMBED_RUNTIME_CAPABILITY_HEADER,
  encodeEmbedCapability,
} from "../src/domains/embed-links/capability";
import { resolveEmbedLink, resolveEmbedRequestContext } from "../src/domains/embed-links/logic";
import { readEmbedCapabilityRequest } from "../src/domains/embed-links/rpc-capability";
import { busabaseRouter } from "../src/router";
import { seedScenario } from "./helpers/seed-scenario";

describe("record-detail embed authorization with a real database", () => {
  it("serves exactly the shared record and denies neighboring data and writes", async () => {
    await seedScenario("record-embed-scope");
    const client = createRouterClient(busabaseRouter);
    const base = await client.bases.create({
      autoMerge: true,
      slug: "record-preview-scope",
      name: "Record preview scope",
      fields: [{ slug: "title", name: "Title", type: "text" }],
    });
    if (!base.materialized) throw new Error("expected materialized Base");
    const target = await client.bases.createChangeRequest({
      baseId: base.id,
      fields: { title: "Shared delivery" },
      autoMerge: true,
    });
    const sibling = await client.bases.createChangeRequest({
      baseId: base.id,
      fields: { title: "Unshared delivery" },
      autoMerge: true,
    });
    if (!target.materialized || !sibling.materialized) throw new Error("expected records");
    const link = await client.embedLinks.create({ type: "record-detail", typeId: target.id });
    const secret = new URL(link.url).searchParams.get("token") ?? "";
    const request = new Request("http://localhost/api/rpc/core/records/get", {
      headers: { [EMBED_RUNTIME_CAPABILITY_HEADER]: encodeEmbedCapability(link.id, secret) },
    });
    const auth = await readEmbedCapabilityRequest(request);
    if (auth.kind !== "embed") throw new Error("expected capability authentication");
    expect(auth.context.embedRecordScope).toEqual({
      recordId: target.id,
      baseId: base.id,
      baseNodeId: base.nodeId,
      baseSlug: base.slug,
    });
    await runWithEmbedContext(auth.context, async () => {
      await expect(client.records.get({ recordId: target.id })).resolves.toMatchObject({
        id: target.id,
      });
      await expect(
        client.nodes.resolveRouteState({ nodeId: base.slug, type: "base" }),
      ).resolves.toMatchObject({ status: "active" });
      await expect(client.bases.listViews({ baseId: base.id })).resolves.toBeInstanceOf(Array);
      await expect(client.records.get({ recordId: sibling.id })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(client.records.list({ baseId: base.id })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(client.records.count({ baseId: base.id })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(client.bases.list({})).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        client.bases.createChangeRequest({ baseId: base.id, fields: { title: "Injected" } }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        client.embedLinks.create({ type: "record-detail", typeId: sibling.id }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
    await expect(client.records.get({ recordId: sibling.id })).resolves.toMatchObject({
      id: sibling.id,
    });
    await expect(resolveEmbedLink(link.id, secret)).resolves.toMatchObject({
      record: { id: target.id },
    });
    await client.embedLinks.revoke({ id: link.id });
    await expect(resolveEmbedRequestContext(link.id, secret)).resolves.toBeNull();
    await expect(readEmbedCapabilityRequest(request)).resolves.toEqual({ kind: "rejected" });
  });

  it("fails closed when the target Base disappears after capability authentication", async () => {
    const { db } = await seedScenario("record-embed-missing-base");
    const client = createRouterClient(busabaseRouter);
    const targetBase = await client.bases.create({
      autoMerge: true,
      slug: "vanishing-preview-base",
      name: "Vanishing preview Base",
      fields: [{ slug: "title", name: "Title", type: "text" }],
    });
    const otherBase = await client.bases.create({
      autoMerge: true,
      slug: "unshared-preview-base",
      name: "Unshared preview Base",
    });
    if (!targetBase.materialized || !otherBase.materialized) {
      throw new Error("expected materialized Bases");
    }
    await client.views.changeRequest({
      operation: "create",
      baseId: otherBase.id,
      slug: "unshared-view",
      name: "Unshared view",
      config: { filters: [], sorts: [] },
      autoMerge: true,
    });
    const otherViews = await client.bases.listViews({ baseId: otherBase.id });
    expect(otherViews.some((view) => view.slug === "unshared-view")).toBe(true);
    const record = await client.bases.createChangeRequest({
      baseId: targetBase.id,
      fields: { title: "Temporary delivery" },
      autoMerge: true,
    });
    if (!record.materialized) throw new Error("expected a materialized record");
    const link = await client.embedLinks.create({ type: "record-detail", typeId: record.id });
    const secret = new URL(link.url).searchParams.get("token") ?? "";
    const context = await resolveEmbedRequestContext(link.id, secret);
    if (!context?.embedRecordScope) throw new Error("expected record-scoped capability");

    // Model deletion between capability authentication and the scoped handler.
    await db
      .update(busabaseBases)
      .set({ deletedAt: new Date() })
      .where(eq(busabaseBases.id, targetBase.id));
    await runWithEmbedContext(context, async () => {
      await expect(client.bases.listViews({ baseId: targetBase.id })).resolves.toEqual([]);
    });
    // Omitting the scope remains the intentional global query for normal callers.
    expect((await listViews()).some((view) => view.slug === "unshared-view")).toBe(true);
  });
});
