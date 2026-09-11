import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";
import { seedScenario } from "./helpers/seed-scenario";

type RawClient = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

/**
 * `sort`, `updatedAfter`/`updatedBefore` and `inNodeId` — the narrowing the
 * search overlay's controls are built on.
 *
 * The property that matters most here is that narrowing NARROWS rather than
 * empties: a source that cannot answer a given filter must not silently
 * contribute zero rows, because "no matches" and "this source cannot tell" look
 * identical to whoever is reading the screen.
 */
describe("search narrowing", () => {
  it("orders by name-independent columns when asked, and by relevance by default", async () => {
    await seedScenario("search-sort");
    const raw: RawClient = createRouterClient(busabaseRouter);

    // Created in a known order, so created_asc / created_desc are checkable.
    for (const slug of ["sortable-one", "sortable-two", "sortable-three"]) {
      await raw.nodes.createChangeRequest({
        autoMerge: true,
        message: `seed ${slug}`,
        operations: [{ kind: "create", nodeType: "doc", slug, name: `Sortable ${slug}` }],
      });
    }
    for (const slug of ["sortable-one", "sortable-two", "sortable-three"]) {
      const [node] = await raw.nodes.searchByName({ query: slug });
      await raw.nodes.updateContent({
        nodeId: node?.id ?? "",
        content: { kind: "doc", body: `SORTMARKER body for ${slug}` },
      });
    }

    const asc = await raw.search({ query: "SORTMARKER", sources: ["nodes"], sort: "created_asc" });
    const desc = await raw.search({
      query: "SORTMARKER",
      sources: ["nodes"],
      sort: "created_desc",
    });

    expect(asc.results.length).toBeGreaterThan(1);
    // Same set, opposite order — the assertion that actually proves the ORDER BY
    // changed rather than the filter.
    expect(desc.results.map((r) => r.id)).toEqual([...asc.results.map((r) => r.id)].reverse());

    // The default must stay whatever each source already did, so existing
    // callers see no change.
    const relevance = await raw.search({ query: "SORTMARKER", sources: ["nodes"] });
    expect(relevance.results.length).toBe(asc.results.length);
  });

  it("restricts to a subtree, and a node outside it drops out", async () => {
    await seedScenario("search-in-node");
    const raw: RawClient = createRouterClient(busabaseRouter);

    await raw.nodes.createChangeRequest({
      autoMerge: true,
      message: "seed tree",
      operations: [
        { kind: "create", nodeType: "folder", slug: "inside-folder", name: "Inside Folder" },
        { kind: "create", nodeType: "doc", slug: "outside-doc", name: "SUBTREEMARKER outside" },
      ],
    });
    const [folder] = await raw.nodes.searchByName({ query: "inside-folder" });
    await raw.nodes.createChangeRequest({
      autoMerge: true,
      message: "seed child",
      operations: [
        {
          kind: "create",
          nodeType: "doc",
          slug: "inside-doc",
          name: "SUBTREEMARKER inside",
          parentNodeId: folder?.id,
        },
      ],
    });
    for (const slug of ["inside-doc", "outside-doc"]) {
      const [node] = await raw.nodes.searchByName({ query: slug });
      await raw.nodes.updateContent({
        nodeId: node?.id ?? "",
        content: { kind: "doc", body: "SUBTREEMARKER in the body" },
      });
    }

    const all = await raw.search({ query: "SUBTREEMARKER", sources: ["nodes"] });
    expect(all.results.length).toBe(2);

    const scoped = await raw.search({
      query: "SUBTREEMARKER",
      sources: ["nodes"],
      inNodeId: folder?.id,
    });
    expect(scoped.results.map((r) => r.title)).toEqual(["SUBTREEMARKER inside"]);
  });

  it("filters by date without emptying a source that has no timestamp of its own", async () => {
    await seedScenario("search-date");
    const raw: RawClient = createRouterClient(busabaseRouter);

    await raw.nodes.createChangeRequest({
      autoMerge: true,
      message: "seed base",
      operations: [
        { kind: "create", nodeType: "base", slug: "dated-base", name: "DATEMARKER Base" },
      ],
    });

    // `busabase_bases` has no `updatedAt` at all; the filter resolves through
    // the owning node. A wide-open window must therefore still return it —
    // if this comes back empty, the date filter is silently deleting Bases.
    const wide = await raw.search({
      query: "DATEMARKER",
      sources: ["names"],
      updatedAfter: "2000-01-01T00:00:00.000Z",
    });
    expect(wide.results.some((r) => r.title === "DATEMARKER Base")).toBe(true);

    // …and a window that genuinely excludes it does exclude it, so the filter
    // is doing something rather than being ignored.
    const past = await raw.search({
      query: "DATEMARKER",
      sources: ["names"],
      updatedBefore: "2000-01-01T00:00:00.000Z",
    });
    expect(past.results).toEqual([]);
  });
});

/**
 * The bug these cover: every source applied `orderForSort` in SQL and was
 * internally correct, then the sources were CONCATENATED and never merged, so
 * concatenation order (records, Bases, files, node content) outranked the order
 * the caller asked for. Found against a running server, not by a type — with
 * `sort=updated_desc` the newest document in the workspace came back below
 * records a full minute older.
 *
 * Every pre-existing sort test passed throughout, because each one restricted
 * itself to a single `sources` entry. Mixing sources is the whole point here;
 * do not narrow these to one source to make them faster.
 */
describe("search sort across a MIXED result set", () => {
  const seedMixed = async (raw: RawClient, marker: string) => {
    // A Base with a record — the sources concatenated FIRST.
    const base = await raw.bases.create({
      slug: `mixed-${marker.toLowerCase()}`,
      name: `Mixed ${marker} Base`,
      fields: [{ slug: "notes", name: "Notes", type: "longtext" }],
      autoMerge: true,
    });
    if (!("id" in base)) throw new Error("Expected a materialized BaseVO");
    await raw.bases.createChangeRequest({
      baseId: base.id,
      fields: { notes: `A record mentioning ${marker}.` },
      submittedBy: "test",
      autoMerge: true,
    });

    // A document — the source concatenated LAST, and deliberately created AFTER
    // the record so "newest" and "last in concatenation order" disagree. That
    // disagreement is the only thing that can tell a sorted list from an
    // unsorted one.
    const slug = `mixed-doc-${marker.toLowerCase()}`;
    await raw.nodes.createChangeRequest({
      autoMerge: true,
      message: `seed ${slug}`,
      operations: [{ kind: "create", nodeType: "doc", slug, name: `Mixed Doc ${marker}` }],
    });
    const [node] = await raw.nodes.searchByName({ query: slug });
    await raw.nodes.updateContent({
      nodeId: node?.id ?? "",
      content: { kind: "doc", body: `A document mentioning ${marker}.` },
    });
    return { docNodeId: node?.id ?? "" };
  };

  it("orders the whole list by time, not by which source produced each row", async () => {
    await seedScenario("search-sort-mixed");
    const raw: RawClient = createRouterClient(busabaseRouter);
    const { docNodeId } = await seedMixed(raw, "MIXMARKER");

    const desc = await raw.search({ query: "MIXMARKER", sort: "updated_desc" });

    // More than one KIND, or this proves nothing about merging.
    expect(new Set(desc.results.map((r) => r.kind)).size).toBeGreaterThan(1);

    const times = desc.results.map((r) => (r.updatedAt ? Date.parse(r.updatedAt) : null));
    expect(times.every((t) => t !== null)).toBe(true);
    for (let i = 0; i < times.length - 1; i += 1) {
      // Monotonic across the ENTIRE list. Before the merge existed this held
      // within each source and broke at every source boundary.
      expect(times[i] ?? 0).toBeGreaterThanOrEqual(times[i + 1] ?? 0);
    }

    // The document was written last, so it must lead — even though its source is
    // concatenated last.
    expect(desc.results[0]?.id).toBe(docNodeId);
  });

  it("reverses that same mixed list for the ascending order", async () => {
    await seedScenario("search-sort-mixed-asc");
    const raw: RawClient = createRouterClient(busabaseRouter);
    const { docNodeId } = await seedMixed(raw, "ASCMARKER");

    const asc = await raw.search({ query: "ASCMARKER", sort: "updated_asc" });
    const times = asc.results.map((r) => (r.updatedAt ? Date.parse(r.updatedAt) : 0));
    for (let i = 0; i < times.length - 1; i += 1) {
      expect(times[i] ?? 0).toBeLessThanOrEqual(times[i + 1] ?? 0);
    }
    // Newest thing, ascending order — it goes last, not first.
    expect(asc.results.at(-1)?.id).toBe(docNodeId);
  });

  it("leaves `relevance` grouped by source, which is its documented behavior", async () => {
    await seedScenario("search-sort-mixed-relevance");
    const raw: RawClient = createRouterClient(busabaseRouter);
    await seedMixed(raw, "RELMARKER");

    const relevance = await raw.search({ query: "RELMARKER" });
    const kinds = relevance.results.map((r) => r.kind);
    // Records rank by full-text score and everything else by recency; those are
    // not comparable, so relevance deliberately does NOT interleave. The record
    // still leads even though the document is newer.
    expect(kinds[0]).toBe("record");
    expect(kinds.at(-1)).toBe("node");
  });
});
