import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { fieldOptionsSchema } from "busabase-contract/domains/base/contract/base-schemas";
import { PackageFieldOptionsSchema } from "busabase-contract/domains/package/types";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// Not a package export; the form VO schema is only reachable by path.
import { FormBoundFieldSchema } from "../../busabase-contract/src/domains/form/types";
import { getDb } from "../src/db";
import { busabaseFieldValues } from "../src/db/schema";
import { fieldSchema } from "../src/logic/base-schemas";
import { busabaseRouter } from "../src/router";

/**
 * `options.date` ({ includeTime, timezone }) has to survive every schema a field
 * definition passes through. Each of these is a plain zod object, so a key it
 * does not list is STRIPPED, not rejected — the setting would vanish with no
 * error anywhere.
 */
describe("options.date survives every field-options schema", () => {
  const date = { includeTime: true, timezone: "Asia/Shanghai" };

  it("contract fieldOptionsSchema", () => {
    expect(fieldOptionsSchema.parse({ date }).date).toEqual(date);
  });

  it("server mirror (logic/base-schemas fieldSchema)", () => {
    const parsed = fieldSchema.parse({ slug: "due", name: "Due", type: "date", options: { date } });
    expect(parsed.options.date).toEqual(date);
  });

  it("template package schema (export → install)", () => {
    expect(PackageFieldOptionsSchema.parse({ date }).date).toEqual(date);
  });

  it("generated Form bound-field metadata", () => {
    expect(
      FormBoundFieldSchema.parse({ slug: "due", name: "Due", type: "date", date }).date,
    ).toEqual(date);
  });
});

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

describe("date fields end to end", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-date-field-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-date-field-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const base = await client.bases.create({
      slug: "deadlines",
      name: "Deadlines",
      fields: [
        { slug: "title", name: "Title", type: "text", required: true, options: {} },
        { slug: "due", name: "Due", type: "date", required: false, options: {} },
        { slug: "when", name: "When", type: "text", required: false, options: {} },
      ],
      autoMerge: true,
    });
    baseId = base.id;
    await client.bases.createBulkChangeRequest({
      baseId,
      records: [
        { title: "a", when: "10/2/2026" },
        { title: "b", when: "2026-10-02T18:00:00+08:00" },
      ],
      message: "seed",
      autoMerge: true,
    });
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  const fieldBySlug = async (slug: string) => {
    const base = (await client.bases.list({})).find((item) => item.id === baseId);
    return base?.fields.find((field) => field.slug === slug);
  };

  it("an existing date field can turn on include-time with a zone", async () => {
    const due = await fieldBySlug("due");
    await client.bases.fieldChangeRequest({
      operation: "update",
      baseId,
      fieldId: due?.id ?? "",
      patch: { options: { date: { includeTime: true, timezone: "Asia/Shanghai" } } },
      autoMerge: true,
    });
    expect((await fieldBySlug("due"))?.options.date).toEqual({
      includeTime: true,
      timezone: "Asia/Shanghai",
    });
  });

  it("rejects an unknown time zone with a clean BAD_REQUEST", async () => {
    const due = await fieldBySlug("due");
    await expect(
      client.bases.fieldChangeRequest({
        operation: "update",
        baseId,
        fieldId: due?.id ?? "",
        patch: { options: { date: { includeTime: true, timezone: "Asia/Shangai" } } },
        autoMerge: true,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      client.bases.fieldChangeRequest({
        operation: "create",
        baseId,
        slug: "starts",
        name: "Starts",
        type: "date",
        options: { date: { includeTime: true, timezone: "Mars/Olympus" } },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("converting a text column to date projects valueDate and keeps a day a day", async () => {
    const when = await fieldBySlug("when");
    await client.bases.fieldChangeRequest({
      operation: "convert",
      baseId,
      fieldId: when?.id ?? "",
      newType: "date",
      selectChoiceMode: "null_on_missing",
      autoMerge: true,
    });
    expect((await fieldBySlug("when"))?.type).toBe("date");

    const page = await client.records.list({ baseId, limit: 50 });
    const byTitle = new Map(
      page.records.map((record) => [record.headCommit.payload.title, record.headCommit.payload]),
    );
    // A day typed as "10/2/2026" is stored as that day, whatever zone the server is in.
    expect(byTitle.get("a")?.when).toBe("2026-10-02");
    expect(byTitle.get("b")?.when).toBe("2026-10-02T10:00:00.000Z");

    const db = await getDb();
    const rows = await db
      .select({ valueDate: busabaseFieldValues.valueDate })
      .from(busabaseFieldValues)
      .where(
        and(
          eq(busabaseFieldValues.fieldId, when?.id ?? ""),
          isNull(busabaseFieldValues.changeRequestId),
        ),
      );
    const instants = rows.map((row) => row.valueDate?.toISOString()).sort();
    expect(instants).toEqual(["2026-10-02T00:00:00.000Z", "2026-10-02T10:00:00.000Z"]);
  });
});
