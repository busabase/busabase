import type { PGlite } from "@electric-sql/pglite";
import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";
import { LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import * as schema from "../src/db/schema";
import { busabaseFieldValues, busabaseRecords } from "../src/db/schema";
import { busabaseRouter } from "../src/router";
import { seedScenario } from "./helpers/seed-scenario";

const raw = () => createRouterClient(busabaseRouter);
const member = <T>(fn: () => Promise<T>) =>
  runWithBusabaseContext({ spaceId: LOCAL_SPACE_ID, actorId: "reader", isSpaceManager: false }, fn);

describe("record search with existing indexes", () => {
  it("finds short Chinese substrings and treats LIKE metacharacters literally", async () => {
    const { client } = await seedScenario("literal-record-search");
    const base = await client.bases.create({ slug: "literal", name: "Literal" });
    for (const title of ["人工智能帮助", "cost 50%", "snake_case", "C:\\files", "ordinary text"]) {
      await client.records.createChangeRequest({
        baseId: base.id,
        fields: { title },
        mergeImmediately: true,
      });
    }
    for (const [query, expected] of [
      ["人工", "人工智能帮助"],
      ["智", "人工智能帮助"],
      ["%", "cost 50%"],
      ["_", "snake_case"],
      ["\\", "C:\\files"],
    ]) {
      const result = await raw().search({ query, sources: ["records"], limit: 100 });
      expect(result.results.filter((row) => row.kind === "record").map((row) => row.title)).toEqual(
        [expected],
      );
    }
    expect((await raw().search({ query: "不存在", sources: ["records"] })).results).toEqual([]);
    expect((await raw().search({ query: " ", sources: ["records"] })).results).toEqual([]);
  });

  it("keeps short-query pagination, ACL revocation, creator/date and Base narrowing", async () => {
    const { client } = await seedScenario("short-record-acl-pages");
    const base = await client.bases.create({ slug: "inside", name: "Inside" });
    const hidden = await client.bases.create({ slug: "hidden", name: "Hidden" });
    for (let index = 0; index < 4; index++) {
      await client.records.createChangeRequest({
        baseId: base.id,
        fields: { title: `中文 ${index}` },
        submittedBy: "writer",
        mergeImmediately: true,
      });
    }
    await client.records.createChangeRequest({
      baseId: hidden.id,
      fields: { title: "中文 hidden" },
      mergeImmediately: true,
    });
    await raw().nodes.updateVisibility({ nodeId: hidden.nodeId, visibility: "private" });
    const options = {
      query: "中文",
      sources: ["records"] as ["records"],
      sort: "created_asc" as const,
    };
    const all = await member(() => raw().search({ ...options, limit: 100 }));
    expect(all.results.some((row) => row.title.includes("hidden"))).toBe(false);
    const pages = [];
    for (let offset = 0; offset < all.results.length; offset += 2) {
      const page = await member(() => raw().search({ ...options, offset, limit: 2 }));
      pages.push(...page.results);
      expect(page.hasMore).toBe(offset + 2 < all.results.length);
    }
    expect(pages.map((row) => `${row.kind}:${row.id}`)).toEqual(
      all.results.map((row) => `${row.kind}:${row.id}`),
    );
    const scoped = await member(() =>
      raw().search({
        ...options,
        inNodeId: base.nodeId,
        createdBy: all.results.find((row) => row.kind === "record")?.createdBy ?? undefined,
        limit: 100,
        updatedAfter: "2000-01-01T00:00:00.000Z",
      }),
    );
    expect(scoped.results.filter((row) => row.kind === "record")).toHaveLength(4);
    expect(
      (
        await member(() =>
          raw().search({
            ...options,
            updatedBefore: "2000-01-01T00:00:00.000Z",
          }),
        )
      ).results,
    ).toEqual([]);
    await raw().nodes.updateVisibility({ nodeId: base.nodeId, visibility: "private" });
    expect((await member(() => raw().search(options))).results).toEqual([]);
  });

  it("uses the scoped CTE only for short inputs and keeps historical field slugs", async () => {
    const { client, db } = await seedScenario("short-record-query-plan");
    const base = await client.bases.create({ slug: "plans", name: "Plans" });
    await client.records.createChangeRequest({
      baseId: base.id,
      fields: { title: "人工智能 uniqueneedle" },
      mergeImmediately: true,
    });
    const pending = await raw().bases.createChangeRequest({
      baseId: base.id,
      fields: { title: "人工智能 pending" },
      autoMerge: false,
    });
    const pg = (db as unknown as { $client: PGlite }).$client;
    const queries: { query: string; params: unknown[] }[] = [];
    const observedDb = drizzle(pg, {
      schema,
      logger: {
        logQuery(query, params) {
          queries.push({ query, params });
        },
      },
    });
    const search = (query: string) =>
      runWithBusabaseContext(
        {
          db: observedDb,
          spaceId: LOCAL_SPACE_ID,
          isSpaceManager: true,
        },
        () => raw().search({ query, sources: ["records"] }),
      );
    await search("人工");
    const candidate = queries.find(({ query }) => query.includes("search_candidates"));
    expect(candidate).toBeDefined();
    if (!candidate) throw new Error("Missing actual short-query SQL");
    const plan = await pg.query(`explain (analyze, buffers) ${candidate.query}`, candidate.params);
    expect(JSON.stringify(plan.rows)).toContain("CTE Scan");

    queries.length = 0;
    const long = await search("uniqueneedle");
    expect(long.results.some((row) => row.kind === "record")).toBe(true);
    expect(queries.some(({ query }) => query.includes("search_candidates"))).toBe(false);

    await db
      .update(busabaseFieldValues)
      .set({ fieldSlug: "historic" })
      .where(eq(busabaseFieldValues.baseId, base.id));
    const history = await raw().search({ query: "hi", sources: ["records"] });
    expect(history.results.some((row) => row.kind === "record")).toBe(true);

    const [record] = await db
      .select({ id: busabaseRecords.id })
      .from(busabaseRecords)
      .where(eq(busabaseRecords.baseId, base.id));
    if (!record) throw new Error("Missing canonical record");
    await db
      .update(busabaseRecords)
      .set({ status: "archived" })
      .where(eq(busabaseRecords.id, record.id));
    const archived = await raw().search({ query: "人工", sources: ["records"] });
    expect(archived.results.some((row) => row.kind === "record" && row.id === record.id)).toBe(
      false,
    );
    // Pending CR projections remain searchable when the canonical record is archived.
    expect(
      archived.results.some((row) => row.kind === "change_request" && row.id === pending.id),
    ).toBe(true);
  });
});
