import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";
import { seedScenario } from "./helpers/seed-scenario";

/**
 * Regression: searching kept returning things the user had already deleted or
 * archived. Record and Base results were already hidden — but every MERGED
 * change request stayed searchable by the values it wrote, so a deleted
 * record (or every row of an archived Base) came back as a "· merged" change
 * request result. Search now only returns change requests still awaiting a
 * decision; a merged one lives on as the record it produced.
 */

type RawClient = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

describe("search — excludes deleted and archived content", () => {
  it("hides a deleted record, an archived Base's rows, and a deleted Doc; keeps open change requests", async () => {
    const { client } = await seedScenario("search-excludes-archived");
    const raw: RawClient = createRouterClient(busabaseRouter);
    const kindsFor = async (query: string) =>
      (await raw.search({ query })).results.map((result) => result.kind);

    // A live record is found once — as the record, not also as the CR that made it.
    const leads = await client.bases.create({ name: "Leads", slug: "leads" });
    const record = await client.records.createChangeRequest({
      baseId: leads.id,
      fields: { title: "RECNEEDLE deal" },
      submittedBy: "alice",
      mergeImmediately: true,
    });
    expect(await kindsFor("RECNEEDLE")).toEqual(["record"]);

    // Deleting the record removes it from search entirely.
    await client.records.createDeleteChangeRequest({
      recordId: record.id,
      mergeImmediately: true,
    });
    expect(await kindsFor("RECNEEDLE")).toEqual([]);

    // Archiving a Base hides the Base and every row it held.
    const archived = await client.bases.create({ name: "BASENEEDLE Archive", slug: "archive-me" });
    await client.records.createChangeRequest({
      baseId: archived.id,
      fields: { title: "BASENEEDLE row" },
      submittedBy: "alice",
      mergeImmediately: true,
    });
    expect((await kindsFor("BASENEEDLE")).sort()).toEqual(["base", "record"]);
    await client.bases.createArchiveChangeRequest({
      baseId: archived.id,
      submittedBy: "alice",
      mergeImmediately: true,
    });
    expect(await kindsFor("BASENEEDLE")).toEqual([]);

    // Deleting a Doc hides it from content search and from name search.
    const doc = await raw.docs.create({
      autoMerge: true,
      slug: "docneedle-notes",
      name: "DOCNEEDLE notes",
      body: "DOCNEEDLE body text\n",
    });
    if (!("node" in doc)) throw new Error("expected a materialized DocVO");
    expect(await kindsFor("DOCNEEDLE")).toContain("node");
    expect((await raw.nodes.searchByName({ query: "DOCNEEDLE" })).length).toBe(1);
    await raw.nodes.createChangeRequest({
      autoMerge: true,
      operations: [{ kind: "delete", nodeId: doc.node.id }],
    });
    expect(await kindsFor("DOCNEEDLE")).toEqual([]);
    expect(await raw.nodes.searchByName({ query: "DOCNEEDLE" })).toEqual([]);

    // A change request still in review IS findable — it is work waiting on someone.
    const pending = await client.records.createChangeRequest({
      baseId: leads.id,
      fields: { title: "PENDINGNEEDLE proposal" },
      submittedBy: "alice",
    });
    const pendingResults = (await raw.search({ query: "PENDINGNEEDLE" })).results;
    expect(pendingResults.map((result) => [result.kind, result.id])).toEqual([
      ["change_request", pending.id],
    ]);

    // "Request changes" keeps it open, so it stays findable...
    await raw.changeRequests.review({ changeRequestIds: [pending.id], verdict: "rejected" });
    expect(await kindsFor("PENDINGNEEDLE")).toEqual(["change_request"]);

    // ...closing it ends it, and it leaves search with it.
    await raw.changeRequests.close({ changeRequestId: pending.id });
    expect(await kindsFor("PENDINGNEEDLE")).toEqual([]);
  });
});
