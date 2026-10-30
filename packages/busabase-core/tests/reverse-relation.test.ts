import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import { busabaseRouter } from "../src/router";

/**
 * Reverse relation columns: "Company → Opportunities" as the other side of
 * "Opportunity → Company". The relationship is stored once (on the forward
 * field); the reverse column is computed from the link table, so the two sides
 * cannot disagree. Both sides are editable: a write to the reverse column is
 * redirected to the forward field on the linked records.
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

  it("ignores an echoed reverse value; a create still refuses a non-empty one", async () => {
    const before = (await client.records.listChangeRequests({ recordId: oppY })).length;
    const echoed = await update(companyA, { name: "Alpha Ltd", opportunities: [oppY] });
    expect(echoed.materialized).toBe(true);
    expect((await client.records.get({ recordId: companyA })).headCommit.payload.name).toBe(
      "Alpha Ltd",
    );
    // An echo writes nothing on the forward side.
    expect((await client.records.listChangeRequests({ recordId: oppY })).length).toBe(before);
    await expect(
      client.bases.createChangeRequest({
        baseId: companiesId,
        fields: { name: "Gamma", opportunities: [oppX] },
        autoMerge: true,
      }),
    ).rejects.toThrow(/cannot be set while creating a record/);
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
  // ── Two-way editing: writes to the reverse column land on the forward field ──

  const payloadOf = async (recordId: string) =>
    (await client.records.get({ recordId })).headCommit.payload;

  it("moves a single-value forward link when a source is added via the reverse column", async () => {
    // State here: Alpha ← [Y, X] (pipeline 500), Beta ← [].
    expect((await reverseOf(companyA))?.slice().sort()).toEqual([oppX, oppY].sort());
    const crsOnBeta = (await client.records.listChangeRequests({ recordId: companyB })).length;
    const result = await update(companyB, { opportunities: [oppY] });
    expect(result.materialized).toBe(true);
    if (!result.materialized) throw new Error("expected a materialized record");
    expect(result.id).toBe(companyB);
    expect(result.headCommit.payload.opportunities).toEqual([oppY]);
    // `company` is single-value, so Y MOVED from Alpha to Beta.
    expect((await payloadOf(oppY)).company).toEqual([companyB]);
    expect(await reverseOf(companyA)).toEqual([oppX]);
    expect(await reverseOf(companyB)).toEqual([oppY]);
    // Lookups/rollups through the reverse column follow.
    expect((await payloadOf(companyA)).pipeline).toBe(100);
    expect((await payloadOf(companyB)).pipeline).toBe(400);
    // Only the reverse column changed, so no (empty) change request on Beta.
    expect((await client.records.listChangeRequests({ recordId: companyB })).length).toBe(
      crsOnBeta,
    );
  });

  it("removes a link via the reverse column", async () => {
    await update(companyB, { opportunities: [] });
    expect((await payloadOf(oppY)).company ?? []).toEqual([]);
    expect(await reverseOf(companyB)).toEqual([]);
    expect((await payloadOf(companyB)).pipeline ?? 0).toBe(0);
  });

  it("lands a mixed update (own field + reverse column) on both sides", async () => {
    const result = await update(companyA, { name: "Alpha Mixed", opportunities: [oppX, oppY] });
    expect(result.materialized).toBe(true);
    if (!result.materialized) throw new Error("expected a materialized record");
    expect(result.headCommit.payload.name).toBe("Alpha Mixed");
    expect(result.headCommit.payload.opportunities).toEqual([oppX, oppY]);
    expect((await payloadOf(oppY)).company).toEqual([companyA]);
    expect((await payloadOf(companyA)).pipeline).toBe(500);
  });

  it("appends to and removes from a multi-value forward field", async () => {
    await addField(oppsId, "partners", "relation", { targetBaseId: companiesId, multiple: true });
    const partnersFieldId = (await fieldIdOf(oppsId, "partners")).id;
    await addField(companiesId, "partner-deals", "relation", {
      reverseOfFieldId: partnersFieldId,
    });
    await update(oppX, { partners: [companyA] });
    await update(companyB, { "partner-deals": [oppX] });
    expect((await payloadOf(oppX)).partners).toEqual([companyA, companyB]);
    expect((await payloadOf(companyA))["partner-deals"]).toEqual([oppX]);
    expect((await payloadOf(companyB))["partner-deals"]).toEqual([oppX]);
    await update(companyA, { "partner-deals": [] });
    expect((await payloadOf(oppX)).partners).toEqual([companyB]);
    // The single-value `company` link of X was not touched by any of this.
    expect((await payloadOf(oppX)).company).toEqual([companyA]);
  });

  it("rejects unknown, archived and malformed ids without writing the main record", async () => {
    await expect(
      update(companyA, { name: "Should not land", opportunities: [oppX, oppY, "rec_missing"] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: /opportunities.*not a live record/ });
    expect((await payloadOf(companyA)).name).toBe("Alpha Mixed");
    // A record on another Base is not a valid source either.
    await expect(update(companyA, { opportunities: [companyB] })).rejects.toThrow(
      /not a live record/,
    );
    await client.records.changeRequest({ operation: "delete", recordId: oppY, autoMerge: true });
    await expect(update(companyB, { opportunities: [oppY] })).rejects.toThrow(/not a live record/);
    await client.records.changeRequest({ operation: "restore", recordId: oppY, autoMerge: true });
    await expect(update(companyA, { opportunities: 42 })).rejects.toThrow(
      /must be a record id or a list of record ids/,
    );
  });

  it("redirects reverse columns in a bulk update as one forward change request", async () => {
    const result = await client.bases.createBulkUpdateChangeRequest({
      baseId: companiesId,
      updates: [
        { recordId: companyA, fields: { opportunities: [oppX] } },
        { recordId: companyB, fields: { name: "Beta Bulk", opportunities: [oppY] } },
      ],
      autoMerge: true,
    });
    expect(result.status).toBe("merged");
    expect((await payloadOf(oppY)).company).toEqual([companyB]);
    expect((await payloadOf(companyB)).name).toBe("Beta Bulk");
    expect(await reverseOf(companyA)).toEqual([oppX]);
    expect(await reverseOf(companyB)).toEqual([oppY]);
    // A bulk whose only change is a reverse column returns the forward CR.
    const onlyReverse = await client.bases.createBulkUpdateChangeRequest({
      baseId: companiesId,
      updates: [{ recordId: companyA, fields: { opportunities: [oppX, oppY] } }],
      autoMerge: true,
    });
    expect(onlyReverse.status).toBe("merged");
    expect(onlyReverse.baseId).toBe(oppsId);
    expect((await payloadOf(oppY)).company).toEqual([companyA]);
  });

  it("returns the pending forward change request when the write is review-first", async () => {
    const result = await client.records.changeRequest({
      operation: "update",
      recordId: companyB,
      fields: { opportunities: [oppY] },
      autoMerge: false,
    });
    expect(result.materialized).toBe(false);
    if (result.materialized) throw new Error("expected a pending change request");
    expect(result.status).toBe("in_review");
    expect(result.baseId).toBe(oppsId);
    // Nothing moved yet.
    expect((await payloadOf(oppY)).company).toEqual([companyA]);
    await client.changeRequests.review({ changeRequestIds: [result.id], verdict: "rejected" });
  });

  it("handles a self-relation without looping or double-applying", async () => {
    const people = await client.bases.create({
      slug: "rr-people",
      name: "People",
      fields: [{ slug: "name", name: "Name", type: "text" }],
      autoMerge: true,
    });
    await addField(people.id, "manager", "relation", { targetBaseId: people.id, multiple: false });
    const managerFieldId = (await fieldIdOf(people.id, "manager")).id;
    await addField(people.id, "reports", "relation", { reverseOfFieldId: managerFieldId });
    const boss = await createRecord(people.id, { name: "Boss" });
    const p1 = await createRecord(people.id, { name: "P1" });
    const p2 = await createRecord(people.id, { name: "P2" });
    await update(boss, { reports: [p1, p2] });
    expect((await payloadOf(p1)).manager).toEqual([boss]);
    expect((await payloadOf(p2)).manager).toEqual([boss]);
    expect((await payloadOf(boss)).reports).toEqual([p1, p2]);
    expect((await payloadOf(boss)).manager ?? []).toEqual([]);
    // Same write also setting the forward cell this reverse change rewrites → refused.
    await expect(
      client.bases.createBulkUpdateChangeRequest({
        baseId: people.id,
        updates: [
          { recordId: boss, fields: { reports: [p1] } },
          { recordId: p2, fields: { manager: [p1] } },
        ],
        autoMerge: true,
      }),
    ).rejects.toThrow(/Change one side at a time/);
    expect((await payloadOf(p2)).manager).toEqual([boss]);
    // Moving a report to another manager through the reverse column.
    await update(p1, { reports: [p2] });
    expect((await payloadOf(p2)).manager).toEqual([p1]);
    expect((await payloadOf(boss)).reports).toEqual([p1]);
  });

  it("never leaves an orphaned reverse column behind its forward field", async () => {
    const before = await reverseOf(companyA);
    // The forward field cannot be deleted while its reverse column is live.
    await expect(
      client.bases.fieldChangeRequest({
        operation: "delete",
        baseId: oppsId,
        fieldId: forwardFieldId,
        autoMerge: true,
      }),
    ).rejects.toMatchObject({ message: /Delete the reverse column first/ });

    // Archiving the forward Base empties the column and refuses edits through
    // it, like any relation to an archived Base; restoring brings it all back.
    await client.bases.lifecycleChangeRequest({
      operation: "archive",
      baseId: oppsId,
      autoMerge: true,
    });
    expect(await reverseOf(companyA)).toEqual([]);
    await expect(update(companyA, { opportunities: [oppX] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await client.bases.lifecycleChangeRequest({
      operation: "restore",
      baseId: oppsId,
      autoMerge: true,
    });
    expect(await reverseOf(companyA)).toEqual(before);
  });

  describe("edge cases of editing through the reverse column", () => {
    // Fresh Bases so nothing here depends on the state the tests above leave.
    const createPair = async (tag: string, forward: { required?: boolean; multiple: boolean }) => {
      const targets = await client.bases.create({
        slug: `ec-${tag}-targets`,
        name: "Targets",
        fields: [{ slug: "name", name: "Name", type: "text" }],
        autoMerge: true,
      });
      const sources = await client.bases.create({
        slug: `ec-${tag}-sources`,
        name: "Sources",
        fields: [
          { slug: "name", name: "Name", type: "text" },
          {
            slug: "target",
            name: "Target",
            type: "relation",
            required: forward.required ?? false,
            options: { targetBaseId: targets.id, multiple: forward.multiple },
          },
        ],
        autoMerge: true,
      });
      const forwardId = (await fieldIdOf(sources.id, "target")).id;
      await addField(targets.id, "sources", "relation", { reverseOfFieldId: forwardId });
      return { targetsId: targets.id, sourcesId: sources.id };
    };
    const get = async (recordId: string) => (await client.records.get({ recordId })).headCommit;
    const changeRequestCount = async (recordId: string) =>
      (await client.records.listChangeRequests({ recordId })).length;

    it("refuses to unlink a source whose forward field is required, writing nothing", async () => {
      const { targetsId, sourcesId } = await createPair("required", {
        required: true,
        multiple: false,
      });
      const t1 = await createRecord(targetsId, { name: "T1" });
      const t2 = await createRecord(targetsId, { name: "T2" });
      const s1 = await createRecord(sourcesId, { name: "S1", target: [t1] });
      const crsBefore = await changeRequestCount(t1);

      await expect(update(t1, { name: "T1 renamed", sources: [] })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        data: { reason: "forward_required", recordId: s1 },
        message: /“S1” needs a “Target” in “Sources”/,
      });
      // Refused up front: neither the rename nor the unlink happened.
      expect((await get(t1)).payload.name).toBe("T1");
      expect((await get(s1)).payload.target).toEqual([t1]);
      expect(await changeRequestCount(t1)).toBe(crsBefore);

      // Moving it to another record is still fine: the field is never empty.
      await update(t2, { sources: [s1] });
      expect((await get(s1)).payload.target).toEqual([t2]);
      expect((await get(t1)).payload.sources).toEqual([]);
    });

    it("treats a repeated id as one link", async () => {
      const { targetsId, sourcesId } = await createPair("dup", { multiple: true });
      const t1 = await createRecord(targetsId, { name: "T1" });
      const s1 = await createRecord(sourcesId, { name: "S1" });
      await update(t1, { sources: [s1, s1] });
      expect((await get(s1)).payload.target).toEqual([t1]);
      expect((await get(t1)).payload.sources).toEqual([s1]);
    });

    it("keeps an archived source archived, and re-linked, through a reverse edit", async () => {
      const { targetsId, sourcesId } = await createPair("archived", { multiple: true });
      const t1 = await createRecord(targetsId, { name: "T1" });
      const s1 = await createRecord(sourcesId, { name: "S1", target: [t1] });
      const s2 = await createRecord(sourcesId, { name: "S2", target: [t1] });
      await client.records.changeRequest({ operation: "delete", recordId: s1, autoMerge: true });
      // The archived source is not shown, so keeping only S2 changes nothing.
      expect((await get(t1)).payload.sources).toEqual([s2]);
      await update(t1, { name: "T1 renamed", sources: [s2] });
      await client.records.changeRequest({ operation: "restore", recordId: s1, autoMerge: true });
      // Restoring brings S1's link back: an unrelated edit did not silently unlink it.
      expect((await get(s1)).payload.target).toEqual([t1]);
      expect((await get(t1)).payload.sources?.slice().sort()).toEqual([s1, s2].sort());
    });

    it("is idempotent: submitting the same reverse edit twice changes nothing more", async () => {
      const { targetsId, sourcesId } = await createPair("idem", { multiple: true });
      const t1 = await createRecord(targetsId, { name: "T1" });
      const s1 = await createRecord(sourcesId, { name: "S1" });
      await update(t1, { sources: [s1] });
      const sourceCrs = await changeRequestCount(s1);
      await update(t1, { sources: [s1] });
      expect(await changeRequestCount(s1)).toBe(sourceCrs);
      expect((await get(s1)).payload.target).toEqual([t1]);
    });

    it("never corrupts a link when two reverse edits race for the same source", async () => {
      const { targetsId, sourcesId } = await createPair("race", { multiple: true });
      const t1 = await createRecord(targetsId, { name: "T1" });
      const t2 = await createRecord(targetsId, { name: "T2" });
      const s1 = await createRecord(sourcesId, { name: "S1" });
      const outcomes = await Promise.allSettled([
        update(t1, { sources: [s1] }),
        update(t2, { sources: [s1] }),
      ]);
      // A loser must be told to retry, not fail some other way.
      for (const outcome of outcomes) {
        if (outcome.status === "rejected") {
          expect(outcome.reason).toMatchObject({ code: "CONFLICT" });
        }
      }
      expect(outcomes.some((outcome) => outcome.status === "fulfilled")).toBe(true);
      // Whatever landed, both sides agree and no link is duplicated or lost.
      const linked = (await get(s1)).payload.target ?? [];
      expect(new Set(linked).size).toBe(linked.length);
      expect(linked.length).toBeGreaterThan(0);
      for (const target of [t1, t2]) {
        const sources = (await get(target)).payload.sources ?? [];
        expect(sources.includes(s1)).toBe(linked.includes(target));
      }
    });

    it("keeps the two sides consistent for every record after a series of edits", async () => {
      const { targetsId, sourcesId } = await createPair("invariant", { multiple: true });
      const targets = [
        await createRecord(targetsId, { name: "A" }),
        await createRecord(targetsId, { name: "B" }),
      ];
      const sources = [
        await createRecord(sourcesId, { name: "1" }),
        await createRecord(sourcesId, { name: "2" }),
        await createRecord(sourcesId, { name: "3", target: [targets[0] as string] }),
      ];
      await update(targets[0] as string, { sources: [sources[0] as string, sources[2] as string] });
      await update(targets[1] as string, { sources: [sources[0] as string, sources[1] as string] });
      await update(sources[1] as string, { target: [targets[0] as string, targets[1] as string] });
      await update(targets[0] as string, { sources: [sources[1] as string] });
      for (const target of targets) {
        const listed = (await get(target)).payload.sources ?? [];
        for (const source of sources) {
          const forward = (await get(source)).payload.target ?? [];
          expect(listed.includes(source)).toBe(forward.includes(target));
        }
      }
    });
  });

  // Last: makes the Opportunities Base private.
  it("refuses a reverse edit when the caller cannot propose changes on the forward Base", async () => {
    const opps = await client.bases.get({ baseId: oppsId });
    await client.nodes.updateVisibility({ nodeId: opps.nodeId, visibility: "private" });
    await client.nodes.principals.add({
      nodeId: opps.nodeId,
      principalType: "user",
      principalId: "bob",
      role: "read",
    });
    const asBob = <T>(fn: () => Promise<T>) =>
      runWithBusabaseContext(
        {
          spaceId: LOCAL_SPACE_ID,
          actorId: "bob",
          isSpaceManager: false,
          permissionLevel: "changeRequest",
        },
        fn,
      );
    const current = await reverseOf(companyA);
    const crsBefore = (await client.records.listChangeRequests({ recordId: companyA })).length;
    await asBob(async () => {
      // Bob can see the reverse column...
      expect(
        (await client.records.get({ recordId: companyA })).headCommit.payload.opportunities,
      ).toEqual(current);
      // ...but cannot change it, and the main field change is not written either.
      await expect(
        client.records.changeRequest({
          operation: "update",
          recordId: companyA,
          fields: { name: "Bob was here", opportunities: [] },
          submittedBy: "bob",
        } as never),
      ).rejects.toMatchObject({ code: "FORBIDDEN", message: /two-way relation/ });
    });
    // Refused before anything was written for the main record.
    expect((await client.records.listChangeRequests({ recordId: companyA })).length).toBe(
      crsBefore,
    );
    await asBob(async () => {
      // An echo is still fine for him.
      const echoed = await client.records.changeRequest({
        operation: "update",
        recordId: companyA,
        fields: { opportunities: current },
      });
      expect(echoed.materialized).toBe(false);
    });
    expect((await payloadOf(companyA)).name).toBe("Alpha Mixed");
  });
});
