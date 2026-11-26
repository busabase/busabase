import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import { getDb, getPgliteClient } from "../src/db";
import * as schema from "../src/db/schema";
import {
  busabaseBaseFields,
  busabaseCommits,
  busabaseFieldValues,
  busabaseRecordLinks,
  busabaseRecords,
} from "../src/db/schema";
import { legacyRelationLinks } from "../src/domains/base/logic/legacy-relation-links";
import { resolveLookupValues } from "../src/domains/base/logic/lookup-values";
import { busabaseRouter } from "../src/router";

let cwd = "";
let dataDir = "";
const client = createRouterClient(busabaseRouter);
beforeAll(async () => {
  cwd = process.cwd();
  process.chdir(path.resolve(__dirname, "../../../apps/busabase"));
  dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-legacy-relations-"));
  process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
  process.env.STORAGE_URL = `local:${dataDir}/storage?base_url=/api/test/storage`;
});

it("skips normal indexed relations without reading large commit payloads", async () => {
  const targets = await client.bases.create({
    slug: "legacy-perf-targets",
    name: "Perf targets",
    autoMerge: true,
    fields: [{ slug: "title", name: "Title", type: "text" }],
  });
  const sources = await client.bases.create({
    slug: "legacy-perf-sources",
    name: "Perf sources",
    autoMerge: true,
    fields: [
      { slug: "title", name: "Title", type: "text" },
      { slug: "target", name: "Target", type: "relation", options: { targetBaseId: targets.id } },
    ],
  });
  const field = sources.fields.find((candidate) => candidate.slug === "target");
  if (!field) throw new Error("Expected target field");
  const target = await client.bases.createChangeRequest({
    baseId: targets.id,
    fields: { title: "Target" },
    autoMerge: true,
  });
  const db = await getDb();
  for (let i = 0; i < 4; i++) {
    const source = await client.bases.createChangeRequest({
      baseId: sources.id,
      fields: { title: `Source ${i}`, target: [target.id] },
      autoMerge: true,
    });
    const head = await client.records.get({ recordId: source.id });
    await db
      .update(busabaseCommits)
      .set({
        payload: {
          ...head.headCommit.payload,
          largeText: "large unrelated field ".repeat(150_000),
        },
      })
      .where(eq(busabaseCommits.id, head.headCommitId));
  }
  const queries: Array<{ query: string; params: unknown[] }> = [];
  const pglite = await getPgliteClient();
  const measuredDb = drizzle({
    client: pglite,
    schema,
    logger: { logQuery: (query, params) => queries.push({ query, params }) },
  });
  expect(await legacyRelationLinks(measuredDb, [field])).toEqual([]);
  expect(queries.length).toBeGreaterThan(0);
  for (const read of queries) {
    expect(read.query).not.toContain("busabase_commits");
    expect(read.query).not.toContain("payload");
  }
  const read = queries.find(({ query }) => query.includes("busabase_field_values"));
  if (!read) throw new Error("Expected fallback query");
  expect(read.query).not.toContain("busabase_commits");
  expect(read.query).not.toContain("payload");
  expect(read.query).toContain("busabase_record_links");
  const plan = await pglite.query(`explain (analyze, format json) ${read.query}`, read.params);
  expect(JSON.stringify(plan.rows)).not.toContain("busabase_commits");
  if (process.env.DEBUG_EXPLAIN)
    console.info("Legacy fallback query plan:", JSON.stringify(plan.rows));
});
it("narrows reverse fallback candidates in SQL before loading unrelated legacy projections", async () => {
  const targets = await client.bases.create({
    slug: "bounded-targets",
    name: "Bounded targets",
    autoMerge: true,
    fields: [{ slug: "title", name: "Title", type: "text" }],
  });
  const sources = await client.bases.create({
    slug: "bounded-sources",
    name: "Bounded sources",
    autoMerge: true,
    fields: [
      { slug: "target", name: "Target", type: "relation", options: { targetBaseId: targets.id } },
    ],
  });
  const target = await client.bases.createChangeRequest({
    baseId: targets.id,
    fields: { title: "Requested" },
    autoMerge: true,
  });
  const unrelated = await client.bases.createChangeRequest({
    baseId: targets.id,
    fields: { title: "Unrelated" },
    autoMerge: true,
  });
  const ids: string[] = [];
  for (let i = 0; i < 150; i++) {
    const record = await client.bases.createChangeRequest({
      baseId: sources.id,
      fields: { target: [JSON.stringify([i === 0 ? target.id : unrelated.id])] },
      autoMerge: true,
    });
    ids.push(record.id);
  }
  const db = await getDb();
  await db.delete(busabaseRecordLinks).where(eq(busabaseRecordLinks.baseId, sources.id));
  const queries: Array<{ query: string; params: unknown[] }> = [];
  const pglite = await getPgliteClient();
  const measuredDb = drizzle({
    client: pglite,
    schema,
    logger: { logQuery: (query, params) => queries.push({ query, params }) },
  });
  const field = sources.fields[0];
  if (!field) throw new Error("Missing relation field");
  const links = await legacyRelationLinks(measuredDb, [field], undefined, [target.id]);
  expect(links.map((link) => link.sourceRecordId)).toEqual([ids[0]]);
  const read = queries.find(({ query }) => query.includes("jsonb_agg(indexed.target_record_id)"));
  if (!read) throw new Error("Missing recovery query");
  // Assert the SQL result cardinality, not only the final in-memory result.
  expect((await pglite.query(read.query, read.params)).rows).toHaveLength(1);
  const plan = await pglite.query(`explain (analyze, format json) ${read.query}`, read.params);
  expect(JSON.stringify(plan.rows)).toContain("busabase_field_values_base_field_idx");
  expect(JSON.stringify(plan.rows)).toContain("busabase_record_links_source_field_idx");
  if (process.env.DEBUG_EXPLAIN)
    console.info("Bounded reverse recovery plan:", JSON.stringify(plan.rows));
});
afterAll(async () => {
  delete process.env.PG_DATABASE_URL;
  delete process.env.STORAGE_URL;
  process.chdir(cwd);
  await rm(dataDir, { recursive: true, force: true });
});

it.each(["plain", "encoded", "mixed"] as const)(
  "does not recover archived or tombstoned %s links and restores live links",
  async (encoding) => {
    const targets = await client.bases.create({
      slug: `archive-targets-${encoding}`,
      name: "Archive targets",
      autoMerge: true,
      fields: [{ slug: "title", name: "Title", type: "text" }],
    });
    const sources = await client.bases.create({
      slug: `archive-sources-${encoding}`,
      name: "Archive sources",
      autoMerge: true,
      fields: [
        { slug: "title", name: "Title", type: "text" },
        { slug: "target", name: "Target", type: "relation", options: { targetBaseId: targets.id } },
        {
          slug: "target_titles",
          name: "Target titles",
          type: "lookup",
          options: { lookup: { relationFieldSlug: "target", targetFieldSlug: "title" } },
        },
      ],
    });
    const forward = sources.fields.find((field) => field.slug === "target");
    if (!forward) throw new Error("Missing relation field");
    await client.bases.fieldChangeRequest({
      baseId: targets.id,
      operation: "create",
      slug: "sources",
      name: "Sources",
      type: "relation",
      options: { reverseOfFieldId: forward.id },
      autoMerge: true,
    });
    const first = await client.bases.createChangeRequest({
      baseId: targets.id,
      fields: { title: "First target" },
      autoMerge: true,
    });
    const second = await client.bases.createChangeRequest({
      baseId: targets.id,
      fields: { title: "Second target" },
      autoMerge: true,
    });
    const value =
      encoding === "plain"
        ? [first.id, second.id]
        : encoding === "encoded"
          ? [JSON.stringify([first.id, second.id])]
          : [first.id, JSON.stringify([second.id])];
    const source = await client.bases.createChangeRequest({
      baseId: sources.id,
      fields: { title: "Source", target: value },
      autoMerge: true,
    });
    const db = await getDb();
    if (encoding === "mixed" || encoding === "plain") {
      // One indexed relation and one missing legacy index share the same value.
      await db
        .delete(busabaseRecordLinks)
        .where(
          and(
            eq(busabaseRecordLinks.sourceRecordId, source.id),
            eq(busabaseRecordLinks.targetRecordId, second.id),
          ),
        );
    }
    const readSource = () => client.records.get({ recordId: source.id });
    expect((await readSource()).headCommit.payload.target_titles).toEqual([
      "First target",
      "Second target",
    ]);
    await client.records.changeRequest({
      recordId: first.id,
      operation: "delete",
      autoMerge: true,
    });
    expect((await readSource()).headCommit.payload.target_titles).toEqual(["Second target"]);
    await client.records.changeRequest({
      recordId: second.id,
      operation: "delete",
      autoMerge: true,
    });
    const unlinked = await readSource();
    expect(unlinked.headCommit.payload.target_titles).toEqual([]);
    expect(unlinked.computedFields?.target_titles?.status).toBe("unlinked");
    await client.records.changeRequest({
      recordId: first.id,
      operation: "restore",
      autoMerge: true,
    });
    expect((await readSource()).headCommit.payload.target_titles).toEqual(["First target"]);
    await client.records.changeRequest({
      recordId: second.id,
      operation: "restore",
      autoMerge: true,
    });
    expect((await readSource()).headCommit.payload.target_titles).toEqual([
      "First target",
      "Second target",
    ]);

    // Reverse fallback must also respect source archive and restore.
    await client.records.changeRequest({
      recordId: source.id,
      operation: "delete",
      autoMerge: true,
    });
    expect((await client.records.get({ recordId: second.id })).headCommit.payload.sources).toEqual(
      [],
    );
    await client.records.changeRequest({
      recordId: source.id,
      operation: "restore",
      autoMerge: true,
    });
    expect((await client.records.get({ recordId: second.id })).headCommit.payload.sources).toEqual([
      source.id,
    ]);

    // A deliberate tombstone is authoritative even while the target is active.
    await db
      .update(busabaseRecordLinks)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(busabaseRecordLinks.sourceRecordId, source.id),
          eq(busabaseRecordLinks.targetRecordId, first.id),
        ),
      );
    expect((await readSource()).headCommit.payload.target_titles).toEqual(["Second target"]);
    expect((await client.records.get({ recordId: first.id })).headCommit.payload.sources).toEqual(
      [],
    );
  },
);

it("recovers old missing link projections for forward/reverse Lookups and preserves ACL and current-head filtering", async () => {
  const targets = await client.bases.create({
    slug: "legacy-targets",
    name: "Targets",
    autoMerge: true,
    fields: [{ slug: "title", name: "Title", type: "text" }],
  });
  const sources = await client.bases.create({
    slug: "legacy-sources",
    name: "Sources",
    autoMerge: true,
    fields: [
      { slug: "title", name: "Title", type: "text" },
      { slug: "target", name: "Target", type: "relation", options: { targetBaseId: targets.id } },
      {
        slug: "target_title",
        name: "Target title",
        type: "lookup",
        options: { lookup: { relationFieldSlug: "target", targetFieldSlug: "title" } },
      },
    ],
  });
  const forward = sources.fields.find((field) => field.slug === "target");
  if (!forward) throw new Error("Missing forward field");
  await client.bases.fieldChangeRequest({
    baseId: targets.id,
    operation: "create",
    slug: "sources",
    name: "Sources",
    type: "relation",
    options: { reverseOfFieldId: forward.id },
    autoMerge: true,
  });
  await client.bases.fieldChangeRequest({
    baseId: targets.id,
    operation: "create",
    slug: "source_titles",
    name: "Source titles",
    type: "lookup",
    options: { lookup: { relationFieldSlug: "sources", targetFieldSlug: "title" } },
    autoMerge: true,
  });
  const target = await client.bases.createChangeRequest({
    baseId: targets.id,
    fields: { title: "Target name" },
    autoMerge: true,
  });
  const source = await client.bases.createChangeRequest({
    baseId: sources.id,
    fields: { title: "Source name", target: [target.id] },
    autoMerge: true,
  });
  const db = await getDb();
  const current = await client.records.get({ recordId: source.id });
  const encoded = [JSON.stringify([JSON.stringify([target.id, target.id])])];
  // Explicitly model the old writer: raw value exists in current commit and
  // field projection but no link passes its FK/existing-target check.
  await db
    .update(busabaseCommits)
    .set({ payload: { title: "Source name", target: encoded } })
    .where(eq(busabaseCommits.id, current.headCommitId));
  await db
    .update(busabaseFieldValues)
    .set({ valueJson: encoded })
    .where(
      and(eq(busabaseFieldValues.recordId, source.id), eq(busabaseFieldValues.fieldSlug, "target")),
    );
  await db.delete(busabaseRecordLinks).where(eq(busabaseRecordLinks.sourceRecordId, source.id));
  expect(
    (await client.records.get({ recordId: source.id })).headCommit.payload.target_title,
  ).toEqual(["Target name"]);
  const readTarget = () => client.records.get({ recordId: target.id });
  expect((await readTarget()).headCommit.payload.sources).toEqual([source.id]);
  expect((await readTarget()).headCommit.payload.source_titles).toEqual(["Source name"]);
  const queries: Array<{ query: string; params: unknown[] }> = [];
  const pglite = await getPgliteClient();
  const measuredDb = drizzle({
    client: pglite,
    schema,
    logger: { logQuery: (query, params) => queries.push({ query, params }) },
  });
  const base = await client.bases.get({ baseId: targets.id });
  const resolved = await resolveLookupValues(
    measuredDb,
    [{ id: target.id, baseId: targets.id }],
    new Map([[base.id, base]]),
  );
  expect(resolved.get(target.id)?.values.source_titles).toEqual(["Source name"]);
  const recoveries = queries.filter(({ query }) =>
    query.includes("jsonb_agg(indexed.target_record_id)"),
  );
  expect(recoveries).toHaveLength(1); // Forward + reverse Lookup share their recovery batch.
  expect(recoveries[0]?.query).toContain("strpos(");
  expect(recoveries[0]?.params).toContain(target.id);
  const recovered = () => legacyRelationLinks(db, [forward]);
  expect(await recovered()).toHaveLength(1);
  const before = await db
    .select()
    .from(busabaseRecordLinks)
    .where(eq(busabaseRecordLinks.sourceRecordId, source.id));
  expect(before).toEqual([]); // Reads never repair by writing.

  // An orphan projection with only nonexistent targets was deliberately not
  // indexed by the writer and must remain omitted, rather than inaccessible.
  await db
    .update(busabaseFieldValues)
    .set({ valueJson: ["missing-target-id"] })
    .where(
      and(eq(busabaseFieldValues.recordId, source.id), eq(busabaseFieldValues.fieldSlug, "target")),
    );
  expect(await recovered()).toEqual([]);
  expect(
    (await client.records.get({ recordId: source.id })).headCommit.payload.target_title,
  ).toEqual([]);

  // A scalar JSON string was decoded once in valueJson by the old projector,
  // even though its link was omitted. The raw head retains that distinction.
  await db
    .update(busabaseCommits)
    .set({ payload: { title: "Source name", target: JSON.stringify([target.id]) } })
    .where(eq(busabaseCommits.id, current.headCommitId));
  await db
    .update(busabaseFieldValues)
    .set({ valueJson: [target.id] })
    .where(
      and(eq(busabaseFieldValues.recordId, source.id), eq(busabaseFieldValues.fieldSlug, "target")),
    );
  expect(
    (await client.records.get({ recordId: source.id })).headCommit.payload.target_title,
  ).toEqual(["Target name"]);
  expect((await readTarget()).headCommit.payload.source_titles).toEqual(["Source name"]);

  // A normal indexed link and the compatibility result cannot duplicate one source.
  await client.records.changeRequest({
    recordId: source.id,
    operation: "update",
    fields: { target: encoded },
    autoMerge: true,
  });
  expect((await readTarget()).headCommit.payload.sources).toEqual([source.id]);
  expect((await readTarget()).headCommit.payload.source_titles).toEqual(["Source name"]);

  const secondTarget = await client.bases.createChangeRequest({
    baseId: targets.id,
    fields: { title: "Second target" },
    autoMerge: true,
  });
  await client.records.changeRequest({
    recordId: source.id,
    operation: "update",
    fields: {
      target: [JSON.stringify([secondTarget.id]), target.id],
    },
    autoMerge: true,
  });
  // Simulate partial old indexing: the direct ID was indexed, the encoded
  // first target was omitted. Recovered ordering must precede the indexed ID.
  await db
    .delete(busabaseRecordLinks)
    .where(
      and(
        eq(busabaseRecordLinks.sourceRecordId, source.id),
        eq(busabaseRecordLinks.targetRecordId, secondTarget.id),
      ),
    );
  expect(
    (await client.records.get({ recordId: source.id })).headCommit.payload.target_title,
  ).toEqual(["Second target", "Target name"]);

  // Projection drift must not overwrite a live target known only to the index.
  await client.records.changeRequest({
    recordId: source.id,
    operation: "update",
    fields: { target: [secondTarget.id, target.id] },
    autoMerge: true,
  });
  await db
    .update(busabaseFieldValues)
    .set({ valueJson: [JSON.stringify([secondTarget.id])] })
    .where(
      and(eq(busabaseFieldValues.recordId, source.id), eq(busabaseFieldValues.fieldSlug, "target")),
    );
  expect(
    (await client.records.get({ recordId: source.id })).headCommit.payload.target_title,
  ).toEqual(["Second target", "Target name"]);

  const validHead = await client.records.get({ recordId: source.id });
  const projectionFilter = and(
    eq(busabaseFieldValues.recordId, source.id),
    eq(busabaseFieldValues.fieldSlug, "target"),
  );
  await db
    .update(busabaseFieldValues)
    .set({ valueJson: ['["broken'] })
    .where(projectionFilter);
  expect(await recovered()).toEqual([]);
  await db
    .update(busabaseFieldValues)
    .set({ valueJson: validHead.headCommit.payload.target })
    .where(projectionFilter);

  await db
    .update(busabaseRecords)
    .set({ archivedAt: new Date(), status: "archived" })
    .where(eq(busabaseRecords.id, source.id));
  expect(await recovered()).toEqual([]);
  await db
    .update(busabaseRecords)
    .set({ archivedAt: null, status: "active" })
    .where(eq(busabaseRecords.id, source.id));
  await db
    .update(busabaseBaseFields)
    .set({ deletedAt: new Date() })
    .where(eq(busabaseBaseFields.id, forward.id));
  expect(await recovered()).toEqual([]);
  await db
    .update(busabaseBaseFields)
    .set({ deletedAt: null })
    .where(eq(busabaseBaseFields.id, forward.id));

  const head = (await client.records.get({ recordId: source.id })).headCommitId;
  await db
    .update(busabaseFieldValues)
    .set({ commitId: current.headCommitId })
    .where(
      and(eq(busabaseFieldValues.recordId, source.id), eq(busabaseFieldValues.fieldSlug, "target")),
    );
  expect(await recovered()).toEqual([]);
  await db
    .update(busabaseFieldValues)
    .set({ commitId: head })
    .where(
      and(eq(busabaseFieldValues.recordId, source.id), eq(busabaseFieldValues.fieldSlug, "target")),
    );
  await client.nodes.updateVisibility({ nodeId: sources.nodeId, visibility: "private" });
  await runWithBusabaseContext(
    {
      spaceId: LOCAL_SPACE_ID,
      actorId: "other-viewer",
      isSpaceManager: false,
      permissionLevel: "read",
    },
    async () => {
      expect(await recovered()).toEqual([]);
      expect((await readTarget()).headCommit.payload.sources).toEqual([]);
    },
  );
  await runWithBusabaseContext(
    {
      spaceId: "another-space",
      actorId: "other-viewer",
      isSpaceManager: false,
      permissionLevel: "read",
    },
    async () => {
      expect(await recovered()).toEqual([]);
    },
  );
});
