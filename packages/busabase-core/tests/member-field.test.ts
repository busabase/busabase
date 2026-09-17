import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithBusabaseContext } from "../src/context";
import {
  collectPeopleFieldIds,
  isPeopleFieldType,
  PEOPLE_FIELD_TYPES,
} from "../src/domains/base/field-types";
import {
  ConversionNotSupportedError,
  convertFieldValue,
  fromText,
  toText,
} from "../src/domains/base/utils/field-conversion";
import { getViewFieldPreviewText } from "../src/domains/base/utils/view-records";
import { busabaseRouter } from "../src/router";
import type { BaseFieldVO } from "../src/types";

/**
 * The `member` field type, end-to-end against a real PGLite database, plus the
 * pure pieces around it. Mirrors the test table in
 * `apps/busabase/content/spec/member-field.md` (T1, T3–T7, T9, T10).
 */

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const OWNER = "local-admin";
const REVIEWER = "local-editor";
const FORMER = "usr_left_the_space";

describe("member field — pure registry + conversion behaviour", () => {
  it("treats member / created_by / updated_by as the people-typed set", () => {
    expect([...PEOPLE_FIELD_TYPES].sort()).toEqual(["created_by", "member", "updated_by"]);
    expect(isPeopleFieldType("member")).toBe(true);
    expect(isPeopleFieldType("relation")).toBe(false);
  });

  it("collects ids from both the array and the single-member shapes", () => {
    const fields = [
      { slug: "owner", type: "member" as const },
      { slug: "reviewers", type: "member" as const },
      { slug: "created_by", type: "created_by" as const },
      { slug: "title", type: "text" as const },
    ];
    const ids = collectPeopleFieldIds(fields, {
      owner: OWNER, // options.multiple === false → a scalar
      reviewers: [REVIEWER, OWNER, "", 42], // dedupes and drops non-strings
      created_by: "agent",
      title: "not a person",
    });
    expect(ids).toEqual([OWNER, REVIEWER, "agent"]);
  });

  it("returns no ids for a base with no people-typed field", () => {
    expect(collectPeopleFieldIds([{ slug: "title", type: "text" }], { title: "x" })).toEqual([]);
  });

  // T10 — converting a member column away is refused, not silently emptied.
  it("refuses conversion in both directions, like relation", () => {
    expect(toText([OWNER], "member")).toBeNull();
    expect(() => fromText(OWNER, "member")).toThrow(ConversionNotSupportedError);
    expect(() => convertFieldValue([OWNER], "member", "text")).toThrow(ConversionNotSupportedError);
    expect(() => convertFieldValue("anything", "text", "member")).toThrow(
      ConversionNotSupportedError,
    );
  });

  // T6 — the filter compares ids on BOTH sides. A name on one side and an id on
  // the other is the bug that made multiselect filters never match.
  it("projects a member cell to its ids for the authoritative view filter", () => {
    const field = {
      id: "f1",
      baseId: "b1",
      slug: "reviewers",
      name: "Reviewers",
      type: "member",
      required: false,
      position: 0,
      options: {},
    } as BaseFieldVO;
    expect(getViewFieldPreviewText(field, [OWNER, REVIEWER])).toBe(`${OWNER}, ${REVIEWER}`);
    expect(getViewFieldPreviewText(field, OWNER)).toBe(OWNER);
    expect(getViewFieldPreviewText(field, undefined)).toBe("");
    // Both sides of the comparison run through this same function, so a filter
    // value written by the member picker (an id) matches the record's cell.
    expect(getViewFieldPreviewText(field, [OWNER, REVIEWER]).includes(OWNER)).toBe(true);
  });
});

describe("member field — end-to-end", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-member-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-member-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const base = await client.bases.create({
      slug: "assignments",
      name: "Assignments",
      fields: [
        { slug: "title", name: "Title", type: "text", required: true },
        // Default (`multiple` unset) mirrors relation: a list.
        { slug: "reviewers", name: "Reviewers", type: "member" },
        {
          slug: "owner",
          name: "Owner",
          type: "member",
          options: { multiple: false },
        },
        { slug: "created_by", name: "Author", type: "created_by" },
      ],
      autoMerge: true,
    });
    baseId = base.id;
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  const createRecord = async (fields: Record<string, unknown>, submittedBy = OWNER) => {
    const cr = await client.bases.createChangeRequest({
      baseId,
      fields,
      submittedBy,
      autoMerge: false,
    });
    await client.changeRequests.review({ changeRequestIds: [cr.id], verdict: "approved" });
    const merged = await client.changeRequests.merge({ changeRequestIds: [cr.id] });
    const result = merged.results[0];
    if (!result?.ok || !result.record) throw new Error("expected a created record");
    return result.record.id;
  };

  // T4 — a multi-member field stores an array.
  it("stores a list of member ids and round-trips it", async () => {
    const recordId = await createRecord({
      title: "Multi",
      reviewers: [REVIEWER, OWNER],
    });
    const record = await client.records.get({ recordId });
    expect(record.headCommit.payload.reviewers).toEqual([REVIEWER, OWNER]);
  });

  // T3 — a single-member field stores a scalar, not a one-element array.
  it("stores a single member as a scalar id", async () => {
    const recordId = await createRecord({ title: "Single", owner: OWNER });
    const record = await client.records.get({ recordId });
    expect(record.headCommit.payload.owner).toBe(OWNER);
  });

  // T1 / T9 — the read path resolves every people-typed CELL, not just the
  // record's own `createdBy` column.
  it("hydrates fieldUsers for member and created_by cells", async () => {
    const recordId = await createRecord({
      title: "Hydrated",
      owner: OWNER,
      reviewers: [REVIEWER],
    });
    const record = await client.records.get({ recordId });
    expect(Object.keys(record.fieldUsers ?? {}).sort()).toEqual([OWNER, REVIEWER].sort());
    // Local mode has no host resolver, so these carry the local labels rather
    // than a Cloud user row — the SHAPE is what this asserts.
    expect(record.fieldUsers?.[OWNER]?.id).toBe(OWNER);
    expect(record.fieldUsers?.[REVIEWER]?.id).toBe(REVIEWER);
  });

  it("gives each record only the people IT names", async () => {
    const mine = await createRecord({ title: "Mine", owner: OWNER });
    // A different owner, and a DIFFERENT submitter, so neither record could pass
    // this by accident if `fieldUsers` were the union over the whole page.
    const theirs = await createRecord({ title: "Theirs", owner: FORMER }, REVIEWER);
    const [a, b] = await Promise.all([
      client.records.get({ recordId: mine }),
      client.records.get({ recordId: theirs }),
    ]);
    // Each record names its own owner plus its own `created_by` submitter.
    expect(Object.keys(a.fieldUsers ?? {}).sort()).toEqual([OWNER]);
    expect(Object.keys(b.fieldUsers ?? {}).sort()).toEqual([FORMER, REVIEWER].sort());
    expect(b.fieldUsers?.[OWNER]).toBeUndefined();
  });

  // T5 — a person who left must not invalidate the record that names them.
  it("accepts an id that is not on the roster and keeps the rest of the record writable", async () => {
    const recordId = await createRecord({
      title: "Former member",
      owner: FORMER,
      reviewers: [FORMER, REVIEWER],
    });
    const record = await client.records.get({ recordId });
    expect(record.headCommit.payload.owner).toBe(FORMER);
    expect(record.headCommit.payload.title).toBe("Former member");
    // Still surfaced in fieldUsers so the client renders a chip (with a null
    // name) rather than an empty cell — "who did this work" survives them.
    expect(record.fieldUsers?.[FORMER]).toMatchObject({ id: FORMER });
  });

  // The one that nearly shipped: `field-ops.ts` gated conversions on its own
  // hardcoded ["relation","attachment"] list instead of asking the converter, so
  // `member` sailed through the gate and the merge's `catch { converted = null }`
  // — which cannot tell "bad value" from "never convertible" — nulled every
  // assignment and left the column as `text`. Silent, irreversible data loss.
  it("refuses to convert a member column away, and keeps its values", async () => {
    const recordId = await createRecord({ title: "Keep my owner", owner: OWNER });
    const base = (await client.bases.list({})).find((item) => item.id === baseId);
    const ownerField = base?.fields.find((field) => field.slug === "owner");

    await expect(
      client.bases.fieldChangeRequest({
        baseId,
        operation: "convert",
        fieldId: ownerField?.id ?? "",
        newType: "text",
        autoMerge: true,
      } as never),
    ).rejects.toThrow(/Cannot convert from "member"/);

    // The value and the column type both survived the refused conversion.
    const record = await client.records.get({ recordId });
    expect(record.headCommit.payload.owner).toBe(OWNER);
    const after = (await client.bases.list({})).find((item) => item.id === baseId);
    expect(after?.fields.find((field) => field.slug === "owner")?.type).toBe("member");
  });

  it("refuses to convert another column INTO member", async () => {
    const base = (await client.bases.list({})).find((item) => item.id === baseId);
    const titleField = base?.fields.find((field) => field.slug === "title");
    await expect(
      client.bases.fieldChangeRequest({
        baseId,
        operation: "convert",
        fieldId: titleField?.id ?? "",
        newType: "member",
        autoMerge: true,
      } as never),
    ).rejects.toThrow(/Cannot convert/);
  });

  // `options.multiple` is only a schema flag — nothing rewrites stored values
  // when it flips. A column holding three ids keeps holding three, and the next
  // save writes back only the first. The loss then looks like the fault of
  // whoever touched the record, not of whoever changed the schema.
  it("refuses a multi→single flip that would truncate existing cells", async () => {
    const recordId = await createRecord({
      title: "Three reviewers",
      reviewers: [OWNER, REVIEWER, "usr_third"],
    });
    const base = (await client.bases.list({})).find((item) => item.id === baseId);
    const reviewersField = base?.fields.find((field) => field.slug === "reviewers");

    await expect(
      client.bases.fieldChangeRequest({
        baseId,
        operation: "update",
        fieldId: reviewersField?.id ?? "",
        patch: { options: { multiple: false } },
        autoMerge: true,
      } as never),
    ).rejects.toThrow(/more than one value/);

    // Nothing was changed by the refused flip.
    const record = await client.records.get({ recordId });
    expect(record.headCommit.payload.reviewers).toEqual([OWNER, REVIEWER, "usr_third"]);
    const after = (await client.bases.list({})).find((item) => item.id === baseId);
    expect(after?.fields.find((f) => f.slug === "reviewers")?.options?.multiple).not.toBe(false);
  });

  it("allows the flip once no record holds more than one value", async () => {
    const base = (await client.bases.list({})).find((item) => item.id === baseId);
    // A separate single-value column proves the guard is about the DATA, not the
    // flag: this one has never held more than one id, so the flip goes through.
    const created = await client.bases.createField({
      baseId,
      slug: "single_reviewer",
      name: "Single reviewer",
      type: "member",
      required: false,
      options: {},
    });
    const field = created.fields.find((f) => f.slug === "single_reviewer");
    await createRecord({ title: "One reviewer", single_reviewer: [OWNER] });

    await expect(
      client.bases.fieldChangeRequest({
        baseId,
        operation: "update",
        fieldId: field?.id ?? "",
        patch: { options: { multiple: false } },
        autoMerge: true,
      } as never),
    ).resolves.toBeDefined();
    expect(base).toBeDefined();
  });

  it("rejects a member value that is not an id or a list of ids", async () => {
    await expect(createRecord({ title: "Bad", owner: { id: OWNER } })).rejects.toThrow(
      /member id/i,
    );
    await expect(createRecord({ title: "Bad", reviewers: [1, 2] })).rejects.toThrow(/member id/i);
  });

  it("leaves an unset member field absent rather than empty-arraying it", async () => {
    const recordId = await createRecord({ title: "Unassigned" });
    const record = await client.records.get({ recordId });
    expect(record.headCommit.payload.owner ?? null).toBeNull();
    expect(record.headCommit.payload.reviewers ?? null).toBeNull();
    // `fieldUsers` is not empty: `created_by` is itself a people-typed field, so
    // the submitter is resolved even when nothing was assigned to anyone.
    expect(Object.keys(record.fieldUsers ?? {})).toEqual([OWNER]);
  });

  // T6 / T7 — filtering by a picked person, and by assigned/unassigned.
  it("filters by member id and by emptiness", async () => {
    const assigned = await createRecord({ title: "Filter target", owner: REVIEWER });
    const byOwner = await client.records.listPage({
      baseId,
      filters: [{ fieldSlug: "owner", fieldType: "member", operator: "equals", value: REVIEWER }],
      pageSize: 50,
    });
    expect(byOwner.records.map((record) => record.id)).toContain(assigned);
    expect(byOwner.records.every((record) => record.headCommit.payload.owner === REVIEWER)).toBe(
      true,
    );

    const unassigned = await client.records.listPage({
      baseId,
      filters: [{ fieldSlug: "owner", fieldType: "member", operator: "is_empty" }],
      pageSize: 50,
    });
    expect(unassigned.records.every((record) => !record.headCommit.payload.owner)).toBe(true);
  });
});

describe("spaces.members — the picker's roster", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-roster-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-roster-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  it("falls back to the local human identities when no host provides a roster", async () => {
    const members = await client.spaces.members({});
    const ids = members.map((member) => member.id);
    expect(ids).toContain("local-admin");
    expect(ids).toContain("local-editor");
    // Actor identities, not people you assign work to.
    expect(ids).not.toContain("agent");
    expect(ids).not.toContain("producer");
    // One person, one entry: `local-user` is the same operator identity as
    // `local-admin`, so listing both put the same display name in twice.
    expect(ids).not.toContain("local-user");
    expect(new Set(ids).size).toBe(ids.length);
    expect(members.every((member) => typeof member.name === "string")).toBe(true);
  });

  it("uses the host's roster when one is injected, and returns it verbatim", async () => {
    const hosted = await runWithBusabaseContext(
      {
        listMembers: async () => [
          {
            id: "usr_1",
            name: "Ada Lovelace",
            email: "ada@example.com",
            image: null,
            role: "owner",
          },
          {
            id: "usr_2",
            name: "Alan Turing",
            email: "alan@example.com",
            image: null,
            role: "member",
          },
        ],
      },
      () => client.spaces.members({}),
    );
    expect(hosted.map((member) => member.id)).toEqual(["usr_1", "usr_2"]);
    expect(hosted[0]?.email).toBe("ada@example.com");
    // No local identities mixed in — a Cloud space's picker must show only its
    // real members.
    expect(hosted.some((member) => member.id.startsWith("local-"))).toBe(false);
  });
});
