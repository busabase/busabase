import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "../src/db";
import { busabaseCommits, busabaseRecords } from "../src/db/schema";
import { commitPayloadWithFields } from "../src/domains/base/logic/commit-payload-projection";
import {
  getOmittedWhiteboardPreview,
  isListPayloadOmitted,
  LIST_OMITTED_FIELD_VALUE,
  LIST_OMITTED_LONG_TEXT_VALUE,
} from "../src/domains/dashboard/utils/list-payload-preview";
import { busabaseRouter } from "../src/router";

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const hugeBody = (name: string) => `${name} ${"body ".repeat(20_000)} needle-${name}`;
const scene = {
  version: 1,
  appState: {},
  elements: Array.from({ length: 60 }, (_, index) => ({
    id: `el${index}`,
    type: "rectangle",
    x: index,
    y: index,
    width: 40,
    height: 30,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: index + 1,
    version: 1,
    versionNonce: index + 1,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
  })),
};
const SMALL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 5"><rect width="8" height="5"/></svg>`;

describe("table-mode server reads", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let plainBaseId = "";
  let lookupBaseId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-table-reads-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-table-reads-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const plain = await client.bases.create({
      slug: "plain-reports",
      name: "Plain reports",
      fields: [
        { slug: "name", name: "Name", type: "text", required: true, options: {} },
        { slug: "status", name: "Status", type: "text", options: {} },
        { slug: "rank", name: "Rank", type: "number", options: {} },
        { slug: "body", name: "Body", type: "longtext", options: {} },
        { slug: "board", name: "Board", type: "whiteboard", options: {} },
      ],
      autoMerge: true,
    });
    plainBaseId = plain.id;
    for (const [index, name] of ["Alpha", "Beta", "Gamma", "Delta"].entries()) {
      await client.bases.createChangeRequest({
        baseId: plain.id,
        autoMerge: true,
        fields: {
          name,
          status: index % 2 ? "open" : "done",
          rank: index,
          body: hugeBody(name),
          board: {
            scene,
            // Delta's thumbnail is itself too large to travel with a list row.
            previewSvg: name === "Delta" ? `<svg>${"x".repeat(40_000)}</svg>` : SMALL_SVG,
          },
        },
      });
    }

    const source = await client.bases.create({
      slug: "offers",
      name: "Offers",
      fields: [
        { slug: "title", name: "Title", type: "text", required: true, options: {} },
        { slug: "price", name: "Price", type: "number", options: {} },
        { slug: "notes", name: "Notes", type: "longtext", options: {} },
      ],
      autoMerge: true,
    });
    const offers = [];
    for (const [title, price] of [
      ["Offer A", 10],
      ["Offer B", 32],
    ] as const) {
      offers.push(
        await client.bases.createChangeRequest({
          baseId: source.id,
          autoMerge: true,
          fields: { title, price, notes: hugeBody(title) },
        }),
      );
    }
    const quotes = await client.bases.create({
      slug: "quotes",
      name: "Quotes",
      fields: [
        { slug: "name", name: "Name", type: "text", required: true, options: {} },
        { slug: "body", name: "Body", type: "longtext", options: {} },
        { slug: "bonus", name: "Bonus", type: "number", options: {} },
        {
          slug: "offers",
          name: "Offers",
          type: "relation",
          options: { targetBaseId: source.id, multiple: true },
        },
        {
          slug: "total",
          name: "Total",
          type: "lookup",
          options: {
            lookup: { relationFieldSlug: "offers", targetFieldSlug: "price", rollup: "sum" },
          },
        },
        {
          slug: "sized",
          name: "Sized",
          type: "formula",
          options: { formula: { expression: "{total} + {bonus} + LEN({body})" } },
        },
      ],
      autoMerge: true,
    });
    lookupBaseId = quotes.id;
    for (const [name, links, bonus] of [
      ["Both", offers.map((offer) => offer.id), 1],
      ["One", [offers[0]?.id ?? ""], 2],
      ["None", [], 3],
    ] as const) {
      await client.bases.createChangeRequest({
        baseId: quotes.id,
        autoMerge: true,
        fields: { name, body: hugeBody(name), bonus, offers: [...links] },
      });
    }
  }, 180_000);

  afterAll(async () => {
    process.chdir(originalCwd);
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    await rm(dataDir, { recursive: true, force: true });
    await rm(storageDir, { recursive: true, force: true });
  });

  const names = (records: { headCommit: { payload: Record<string, unknown> } }[]) =>
    records.map((record) => record.headCommit.payload.name);

  it("projects only the named keys, and an empty object when none exist", async () => {
    const db = await getDb();
    const read = async (slugs: string[]) => {
      const [row] = await db
        .select({ payload: commitPayloadWithFields(slugs).as("payload") })
        .from(busabaseRecords)
        .innerJoin(busabaseCommits, eq(busabaseCommits.id, busabaseRecords.headCommitId))
        .where(eq(busabaseRecords.baseId, plainBaseId))
        .limit(1);
      return row?.payload;
    };
    expect(Object.keys((await read(["name", "rank"])) ?? {}).sort()).toEqual(["name", "rank"]);
    expect(await read(["no_such_field"])).toEqual({});
    expect(await read([])).toEqual({});
  });

  describe.each(["table", "full"] as const)("filtered pages in %s mode", (listMode) => {
    it("filters on a short field, in the same order as an unprojected read", async () => {
      const page = await client.records.listPage({
        baseId: plainBaseId,
        listMode,
        page: 1,
        pageSize: 10,
        filters: [{ fieldSlug: "status", operator: "equals", value: "open" }],
      });
      expect(page.total).toBe(2);
      expect(names(page.records).sort()).toEqual(["Beta", "Delta"]);
      const body = page.records[0]?.headCommit.payload.body;
      if (listMode === "table") expect(body).toBe(LIST_OMITTED_LONG_TEXT_VALUE);
      else expect(String(body)).toContain("needle-");
    });

    it("still searches inside a long field the filter names", async () => {
      const page = await client.records.listPage({
        baseId: plainBaseId,
        listMode,
        page: 1,
        pageSize: 10,
        filters: [{ fieldSlug: "body", operator: "contains", value: "needle-Gamma" }],
      });
      expect(names(page.records)).toEqual(["Gamma"]);
    });

    it("sorts and paginates a saved view over projected fields", async () => {
      const changeRequest = await client.views.changeRequest({
        operation: "create",
        baseId: plainBaseId,
        slug: `by-rank-${listMode}`,
        name: `By rank ${listMode}`,
        config: {
          filters: [],
          sorts: [{ fieldSlug: "rank", direction: "desc" }],
        },
        autoMerge: false,
      });
      await client.changeRequests.review({
        changeRequestIds: [changeRequest.id],
        verdict: "approved",
      });
      const merged = await client.changeRequests.merge({ changeRequestIds: [changeRequest.id] });
      const view = merged.results[0]?.view;
      if (!view) throw new Error("Expected view");
      const first = await client.records.listPage({
        baseId: plainBaseId,
        viewId: view.id,
        listMode,
        page: 1,
        pageSize: 2,
      });
      const second = await client.records.listPage({
        baseId: plainBaseId,
        viewId: view.id,
        listMode,
        page: 2,
        pageSize: 2,
      });
      expect(names(first.records)).toEqual(["Delta", "Gamma"]);
      expect(names(second.records)).toEqual(["Beta", "Alpha"]);
    });

    it("filters on a lookup and returns correct pages with every read-time value", async () => {
      const page = await client.records.listPage({
        baseId: lookupBaseId,
        listMode,
        page: 1,
        pageSize: 10,
        filters: [{ fieldSlug: "total", operator: "equals", value: 42 }],
      });
      expect(names(page.records)).toEqual(["Both"]);
      const [record] = page.records;
      expect(record?.headCommit.payload.total).toBe(42);
      expect(record?.computedFields?.total?.sources.map((source) => source.title)).toEqual([
        "Offer A",
        "Offer B",
      ]);
      expect(record?.headCommit.payload.sized).toBe(42 + 1 + hugeBody("Both").length);
      const body = record?.headCommit.payload.body;
      if (listMode === "table") expect(body).toBe(LIST_OMITTED_LONG_TEXT_VALUE);
      else expect(body).toBe(hugeBody("Both"));
    });

    it("filters on a read-time formula whose input is a long field", async () => {
      const expected = 10 + 2 + hugeBody("One").length;
      const page = await client.records.listPage({
        baseId: lookupBaseId,
        listMode,
        page: 1,
        pageSize: 10,
        filters: [{ fieldSlug: "sized", operator: "equals", value: expected }],
      });
      expect(names(page.records)).toEqual(["One"]);
    });
  });

  it("gives a lookup source its title and value without its other fields", async () => {
    const list = await client.records.list({ baseId: lookupBaseId, limit: 10 });
    const both = list.records.find((record) => record.headCommit.payload.name === "Both");
    const detail = await client.records.get({ recordId: both?.id ?? "" });
    expect(detail.computedFields?.total?.status).toBe("ready");
    expect(detail.computedFields?.total?.value).toBe(42);
    expect(
      detail.computedFields?.total?.sources.map((source) => [source.title, source.value]),
    ).toEqual([
      ["Offer A", 10],
      ["Offer B", 32],
    ]);
  });

  it("keeps a small whiteboard thumbnail in table mode, and only there", async () => {
    const table = await client.records.listPage({
      baseId: plainBaseId,
      listMode: "table",
      page: 1,
      pageSize: 10,
    });
    const boardOf = (name: string) =>
      table.records.find((record) => record.headCommit.payload.name === name)?.headCommit.payload
        .board;
    const alpha = boardOf("Alpha");
    expect(isListPayloadOmitted(alpha)).toBe(true);
    expect(getOmittedWhiteboardPreview(alpha)).toBe(SMALL_SVG);
    expect(JSON.stringify(alpha)).not.toContain("el59");
    // A thumbnail over the budget falls back to the plain marker.
    expect(boardOf("Delta")).toBe(LIST_OMITTED_FIELD_VALUE);

    const summary = await client.records.list({ baseId: plainBaseId, limit: 10, summary: true });
    expect(
      summary.records.every(
        (record) => record.headCommit.payload.board === LIST_OMITTED_FIELD_VALUE,
      ),
    ).toBe(true);

    const id = table.records.find((record) => record.headCommit.payload.name === "Alpha")?.id;
    const full = await client.records.get({ recordId: id ?? "" });
    expect((full.headCommit.payload.board as { scene: typeof scene }).scene.elements).toHaveLength(
      60,
    );
  });
});
