import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

/**
 * Reverse relation columns: "Company → Opportunities" as the read-only other
 * side of "Opportunity → Company". The relationship is stored once (on the
 * forward field); the reverse column is computed from the link table, so the two
 * sides cannot disagree.
 */
describe("reverse relation columns", () => {
  const client = createRouterClient(busabaseRouter);
  let originalCwd = "";
  let dataDir = "";
  let storageDir = "";
  let companiesId = "";
  let oppsId = "";
  let forwardFieldId = "";
  let reverseFieldId = "";
  let companyA = "";
  let companyB = "";
  let oppX = "";
  let oppY = "";

  const createRecord = async (baseId: string, fields: Record<string, unknown>) => {
    const result = await client.bases.createChangeRequest({ baseId, fields, autoMerge: true });
    if (!result.materialized) throw new Error("record must be materialized");
    return result.id;
  };
  const update = (recordId: string, fields: Record<string, unknown>) =>
    client.records.changeRequest({ operation: "update", recordId, fields, autoMerge: true });
  const reverseOf = async (recordId: string) =>
    (await client.records.get({ recordId })).headCommit.payload.opportunities;
  const addField = (baseId: string, slug: string, type: string, options: Record<string, unknown>) =>
    client.bases.fieldChangeRequest({
      operation: "create",
      baseId,
      slug,
      name: slug,
      type: type as "relation",
      options,
      autoMerge: true,
    });
  const fieldIdOf = async (baseId: string, slug: string) => {
    const base = await client.bases.get({ baseId });
    const field = base.fields.find((candidate) => candidate.slug === slug);
    if (!field) throw new Error(`no field ${slug}`);
    return field;
  };

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(path.resolve(__dirname, "../../../apps/busabase"));
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-reverse-relation-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-reverse-relation-assets-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;

    const companies = await client.bases.create({
      slug: "rr-companies",
      name: "Companies",
      fields: [{ slug: "name", name: "Name", type: "text" }],
      autoMerge: true,
    });
    companiesId = companies.id;
    const opps = await client.bases.create({
      slug: "rr-opportunities",
      name: "Opportunities",
      fields: [
        { slug: "name", name: "Name", type: "text" },
        { slug: "amount", name: "Amount", type: "number" },
        {
          slug: "company",
          name: "Company",
          type: "relation",
          options: { targetBaseId: companiesId, multiple: false },
        },
      ],
      autoMerge: true,
    });
    oppsId = opps.id;
    forwardFieldId = (await fieldIdOf(oppsId, "company")).id;

    companyA = await createRecord(companiesId, { name: "Alpha" });
    companyB = await createRecord(companiesId, { name: "Beta" });
    oppX = await createRecord(oppsId, { name: "X", amount: 100, company: [companyA] });
    oppY = await createRecord(oppsId, { name: "Y", amount: 250, company: [companyA] });
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  it("creates a reverse column, defaulting its target and pairing both sides", async () => {
    // targetBaseId omitted on purpose: it defaults to the forward field's Base.
    const result = await addField(companiesId, "opportunities", "relation", {
      reverseOfFieldId: forwardFieldId,
    });
    expect(result.status).toBe("merged");
    const reverse = await fieldIdOf(companiesId, "opportunities");
    reverseFieldId = reverse.id;
    expect(reverse.options).toMatchObject({
      reverseOfFieldId: forwardFieldId,
      targetBaseId: oppsId,
      multiple: true,
      inverseFieldId: forwardFieldId,
    });
    expect((await fieldIdOf(oppsId, "company")).options.inverseFieldId).toBe(reverseFieldId);
  });

  it("lists every record that links here, in link order", async () => {
    expect(await reverseOf(companyA)).toEqual([oppX, oppY]);
    expect(await reverseOf(companyB)).toEqual([]);
    const page = await client.records.listPage({ baseId: companiesId, page: 1, pageSize: 50 });
    expect(
      page.records.find((record) => record.id === companyA)?.headCommit.payload.opportunities,
    ).toEqual([oppX, oppY]);
  });

  it("follows the forward side when a link moves", async () => {
    await update(oppX, { company: [companyB] });
    expect(await reverseOf(companyA)).toEqual([oppY]);
    expect(await reverseOf(companyB)).toEqual([oppX]);
  });

  it("drops archived sources and brings them back on restore", async () => {
    await client.records.changeRequest({ operation: "delete", recordId: oppY, autoMerge: true });
    expect(await reverseOf(companyA)).toEqual([]);
    await client.records.changeRequest({ operation: "restore", recordId: oppY, autoMerge: true });
    expect(await reverseOf(companyA)).toEqual([oppY]);
  });

  it("ignores an echoed reverse value and rejects a changed one", async () => {
    const echoed = await update(companyA, { name: "Alpha Ltd", opportunities: [oppY] });
    expect(echoed.materialized).toBe(true);
    expect((await client.records.get({ recordId: companyA })).headCommit.payload.name).toBe(
      "Alpha Ltd",
    );
    await expect(update(companyA, { opportunities: [oppX, oppY] })).rejects.toThrow(
      /read-only reverse relation/,
    );
    await expect(
      client.bases.createChangeRequest({
        baseId: companiesId,
        fields: { name: "Gamma", opportunities: [oppX] },
        autoMerge: true,
      }),
    ).rejects.toThrow(/read-only reverse relation/);
    const created = await createRecord(companiesId, { name: "Delta", opportunities: [] });
    expect(await reverseOf(created)).toEqual([]);
    // Nothing was ever stored for the reverse column.
    const raw = await client.records.listLinks({ recordId: companyA });
    expect(raw.filter((link) => link.fieldSlug === "opportunities")).toEqual([]);
  });

  it("rolls up a lookup across the reverse column and follows source edits", async () => {
    await addField(companiesId, "pipeline", "lookup", {
      lookup: { relationFieldSlug: "opportunities", targetFieldSlug: "amount", rollup: "sum" },
    });
    await update(oppX, { company: [companyA] });
    expect((await client.records.get({ recordId: companyA })).headCommit.payload.pipeline).toBe(
      350,
    );
    await update(oppY, { amount: 400 });
    expect((await client.records.get({ recordId: companyA })).headCommit.payload.pipeline).toBe(
      500,
    );
  });

  it("lists inbound links", async () => {
    const inbound = await client.records.listLinks({ recordId: companyA, direction: "inbound" });
    expect(inbound.map((link) => link.sourceRecordId).sort()).toEqual([oppX, oppY].sort());
    expect(new Set(inbound.map((link) => link.fieldId))).toEqual(new Set([forwardFieldId]));
    const outbound = await client.records.listLinks({ recordId: oppX });
    expect(outbound.map((link) => link.targetRecordId)).toEqual([companyA]);
  });

  it("rejects invalid reverse definitions", async () => {
    // A second reverse column for the same forward field.
    await expect(
      addField(companiesId, "opportunities-again", "relation", {
        reverseOfFieldId: forwardFieldId,
      }),
    ).rejects.toThrow(/already has a reverse column/);
    // Pointing at a non-relation field.
    const amount = await fieldIdOf(oppsId, "amount");
    await expect(
      addField(companiesId, "bad-type", "relation", { reverseOfFieldId: amount.id }),
    ).rejects.toThrow(/must name a relation field/);
    // A forward field that links somewhere else.
    const other = await client.bases.create({
      slug: "rr-other",
      name: "Other",
      fields: [{ slug: "name", name: "Name", type: "text" }],
      autoMerge: true,
    });
    await expect(
      addField(other.id, "bad-target", "relation", { reverseOfFieldId: forwardFieldId }),
    ).rejects.toThrow(/targetBaseId must be|links to a different Base/);
    // Pointing at another reverse column.
    await expect(
      addField(oppsId, "reverse-of-reverse", "relation", { reverseOfFieldId: reverseFieldId }),
    ).rejects.toThrow(/itself a reverse column/);
    // Single-value reverse.
    await expect(
      addField(companiesId, "single", "relation", {
        reverseOfFieldId: forwardFieldId,
        multiple: false,
      }),
    ).rejects.toThrow(/multiple:false/);
  });

  it("keeps the pairing through option edits and guards the forward field", async () => {
    await client.bases.fieldChangeRequest({
      operation: "update",
      baseId: companiesId,
      fieldId: reverseFieldId,
      patch: { options: { help: { description: "Deals for this company" } } },
      autoMerge: true,
    });
    expect((await fieldIdOf(companiesId, "opportunities")).options).toMatchObject({
      reverseOfFieldId: forwardFieldId,
      multiple: true,
    });
    await expect(
      client.bases.fieldChangeRequest({
        operation: "delete",
        baseId: oppsId,
        fieldId: forwardFieldId,
        autoMerge: true,
      }),
    ).rejects.toThrow(/reverse column/);
  });

  it("refuses to filter, sort or group by a reverse column", async () => {
    await expect(
      client.records.listPage({
        baseId: companiesId,
        page: 1,
        pageSize: 10,
        filters: [{ fieldSlug: "opportunities", operator: "not_empty" }],
      }),
    ).rejects.toThrow(/reverse relation/);
    await expect(
      client.records.list({
        baseId: companiesId,
        sort: { fieldSlug: "opportunities", direction: "asc" },
      }),
    ).rejects.toThrow(/reverse relation/);
    await expect(
      client.records.groupBy({ baseId: companiesId, fieldSlug: "opportunities" }),
    ).rejects.toThrow(/reverse relation/);
  });
});
