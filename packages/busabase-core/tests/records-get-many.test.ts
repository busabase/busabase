/**
 * `records.getMany` — the dashboard's batched linked-record read. It must be a
 * pure batch of `records.get`: same rows, same ACL, same hydration (lookups,
 * reverse relations, people), just one query + one hydration pass. Hidden and
 * unknown ids are reported in `missingIds` instead of failing the batch.
 */
import { createRouterClient } from "@orpc/server";
import { RECORD_GET_MANY_MAX_IDS } from "busabase-contract/domains/base/contract/record-schemas";
import type { RecordVO } from "busabase-contract/types";
import { describe, expect, it } from "vitest";
import { LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import { busabaseRouter } from "../src/router";
import { seedScenario } from "./helpers/seed-scenario";

type RawClient = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

/** `dependencyReadAt` is the server's read-start clock, different on every read. */
const withoutReadClock = (record: RecordVO): RecordVO => ({
  ...record,
  ...(record.computedFields
    ? {
        computedFields: Object.fromEntries(
          Object.entries(record.computedFields).map(([slug, computed]) => [
            slug,
            { ...computed, dependencyReadAt: undefined },
          ]),
        ),
      }
    : {}),
});

const asManager = <T>(fn: () => Promise<T>) =>
  runWithBusabaseContext({ spaceId: LOCAL_SPACE_ID, actorId: "alice", isSpaceManager: true }, fn);

const asMember = <T>(fn: () => Promise<T>) =>
  runWithBusabaseContext(
    {
      spaceId: LOCAL_SPACE_ID,
      actorId: "bob",
      isSpaceManager: false,
      permissionLevel: "changeRequest",
      restrictedVisibility: false,
    },
    fn,
  );

describe("records.getMany", () => {
  it("batches records.get: input order, dedupe, missingIds for hidden/unknown ids, max 100", async () => {
    await seedScenario("records-get-many");
    const raw: RawClient = createRouterClient(busabaseRouter);

    const fixture = await asManager(async () => {
      const create = async (baseId: string, fields: Record<string, unknown>) => {
        const result = await raw.bases.createChangeRequest({ baseId, fields, autoMerge: true });
        if (!result.materialized) throw new Error("expected a materialized record");
        return result.id;
      };
      const companies = await raw.bases.create({
        slug: "gm-companies",
        name: "Companies",
        fields: [
          { slug: "name", name: "Name", type: "text" },
          { slug: "tier", name: "Tier", type: "number" },
        ],
        autoMerge: true,
      });
      if (!companies.materialized) throw new Error("expected a materialized base");
      const deals = await raw.bases.create({
        slug: "gm-deals",
        name: "Deals",
        fields: [
          { slug: "name", name: "Name", type: "text" },
          {
            slug: "company",
            name: "Company",
            type: "relation",
            options: { targetBaseId: companies.id, multiple: false },
          },
        ],
        autoMerge: true,
      });
      if (!deals.materialized) throw new Error("expected a materialized base");
      // A server-computed lookup, so the deep-equal below covers `computedFields`.
      await raw.bases.fieldChangeRequest({
        operation: "create",
        baseId: deals.id,
        slug: "company_tier",
        name: "Company tier",
        type: "lookup",
        options: { lookup: { relationFieldSlug: "company", targetFieldSlug: "tier" } },
        autoMerge: true,
      });
      const acme = await create(companies.id, { name: "Acme", tier: 1 });
      const globex = await create(companies.id, { name: "Globex", tier: 2 });
      const deal = await create(deals.id, { name: "Big deal", company: [acme] });
      // Archived records stay readable, exactly as through records.get.
      const archived = await create(companies.id, { name: "Gone", tier: 3 });
      await raw.records.changeRequest({ operation: "delete", recordId: archived, autoMerge: true });

      const secret = await raw.bases.create({
        slug: "gm-secret",
        name: "Secret",
        fields: [{ slug: "name", name: "Name", type: "text" }],
        autoMerge: true,
      });
      if (!secret.materialized) throw new Error("expected a materialized base");
      const hidden = await create(secret.id, { name: "Payroll" });
      await raw.nodes.updateVisibility({ nodeId: secret.nodeId, visibility: "private" });
      return { acme, globex, deal, archived, hidden };
    });

    // Manager: order follows the input, duplicates collapse, archived included.
    await asManager(async () => {
      const ids = [fixture.deal, fixture.globex, fixture.acme, fixture.deal, fixture.archived];
      const result = await raw.records.getMany({ recordIds: ids });
      expect(result.records.map((record) => record.id)).toEqual([
        fixture.deal,
        fixture.globex,
        fixture.acme,
        fixture.archived,
      ]);
      expect(result.missingIds).toEqual([]);
      expect(result.records.find((record) => record.id === fixture.archived)?.status).toBe(
        "archived",
      );
      // Each record is exactly what records.get returns for that id.
      for (const record of result.records) {
        expect(withoutReadClock(record)).toEqual(
          withoutReadClock(await raw.records.get({ recordId: record.id })),
        );
      }
      expect(
        result.records.find((record) => record.id === fixture.deal)?.computedFields?.company_tier,
      ).toMatchObject({ status: "ready" });
    });

    // Member without access to the private Base: its record is reported
    // missing (records.get would 404), alongside an id that never existed.
    await asMember(async () => {
      await expect(raw.records.get({ recordId: fixture.hidden })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      const result = await raw.records.getMany({
        recordIds: [fixture.hidden, fixture.acme, "rec_does_not_exist"],
      });
      expect(result.records.map((record) => record.id)).toEqual([fixture.acme]);
      expect(result.missingIds).toEqual([fixture.hidden, "rec_does_not_exist"]);
      expect(withoutReadClock(result.records[0] as RecordVO)).toEqual(
        withoutReadClock(await raw.records.get({ recordId: fixture.acme })),
      );
    });

    // Another space sees none of them.
    await runWithBusabaseContext(
      { spaceId: "another-space", actorId: "alice", isSpaceManager: true },
      async () => {
        const result = await raw.records.getMany({ recordIds: [fixture.acme] });
        expect(result).toEqual({ records: [], missingIds: [fixture.acme] });
      },
    );

    // Bounds are enforced by the contract.
    await asManager(async () => {
      await expect(raw.records.getMany({ recordIds: [] })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      const tooMany = Array.from({ length: RECORD_GET_MANY_MAX_IDS + 1 }, (_, i) => `rec_${i}`);
      await expect(raw.records.getMany({ recordIds: tooMany })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      const atLimit = Array.from({ length: RECORD_GET_MANY_MAX_IDS }, (_, i) => `rec_${i}`);
      expect((await raw.records.getMany({ recordIds: atLimit })).missingIds).toHaveLength(
        RECORD_GET_MANY_MAX_IDS,
      );
    });
  });
});
