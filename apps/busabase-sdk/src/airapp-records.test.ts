/**
 * The record helpers against a recording fake client. The property that matters
 * most is the one no template could get wrong once it used these: no write ever
 * carries `autoMerge`. Every write test asserts it on the exact input sent.
 */
import { describe, expect, it, vi } from "vitest";

import {
  type AirAppRecordsClient,
  airAppRecordFields,
  createAirAppRecords,
} from "./airapp-records";
import { airAppWriteMessage } from "./airapp-write-outcome";

const record = (id: string, fields: Record<string, unknown>, baseId = "bas_1") => ({
  id,
  baseId,
  headCommitId: `cmt_${id}`,
  parentRecordId: null,
  parentCommitId: null,
  status: "active" as const,
  createdBy: "usr_1",
  createdByUser: null,
  fieldUsers: {},
  archivedAt: null,
  createdAt: "2026-10-23T00:00:00.000Z",
  updatedAt: "2026-10-23T00:00:00.000Z",
  base: { id: baseId },
  headCommit: { id: `cmt_${id}`, payload: fields },
});

const pendingChangeRequest = (id: string, targetRecordId: string | null) => ({
  id,
  status: "in_review",
  materialized: false,
  operations: [{ targetRecordId, mergedRecordId: null }],
  primaryOperation: { targetRecordId, mergedRecordId: null },
});

const notFound = () =>
  Object.assign(new Error("Record not found"), { status: 404, code: "NOT_FOUND" });

const fakeClient = (overrides: {
  list?: (input: unknown) => unknown;
  get?: (input: unknown) => unknown;
  changeRequest?: (input: unknown) => unknown;
  createChangeRequest?: (input: unknown) => unknown;
}) => {
  const calls = {
    list: vi.fn(
      async (input: unknown) => overrides.list?.(input) ?? { records: [], nextCursor: null },
    ),
    get: vi.fn(async (input: unknown) => {
      if (!overrides.get) throw notFound();
      return overrides.get(input);
    }),
    changeRequest: vi.fn(async (input: unknown) => overrides.changeRequest?.(input)),
    createChangeRequest: vi.fn(async (input: unknown) => overrides.createChangeRequest?.(input)),
  };
  const client = {
    records: { list: calls.list, get: calls.get, changeRequest: calls.changeRequest },
    bases: { createChangeRequest: calls.createChangeRequest },
  } as unknown as AirAppRecordsClient;
  return { client, calls };
};

const sentInput = (mock: { mock: { calls: unknown[][] } }) =>
  mock.mock.calls[0][0] as Record<string, unknown>;

describe("readPage", () => {
  it("reads one page with the app's budget, and hands back the cursor", async () => {
    const { client, calls } = fakeClient({
      list: () => ({ records: [record("rec_1", { name: "Ada" })], nextCursor: "cur_2" }),
    });
    const page = await createAirAppRecords(client).readPage({ baseId: "bas_1", limit: 20 });
    expect(sentInput(calls.list)).toEqual({ baseId: "bas_1", limit: 20 });
    expect(page.nextCursor).toBe("cur_2");
    expect(page.records[0].id).toBe("rec_1");
    expect(page.records[0].headCommitId).toBe("cmt_rec_1");
    expect(page.records[0].fields).toEqual({ name: "Ada" });
    expect(calls.list).toHaveBeenCalledTimes(1);
  });

  it("defaults to the 50-record budget and omits a null cursor", async () => {
    const { client, calls } = fakeClient({});
    const page = await createAirAppRecords(client).readPage({ baseId: "bas_1", cursor: null });
    expect(sentInput(calls.list)).toEqual({ baseId: "bas_1", limit: 50 });
    expect(page).toEqual({ records: [], nextCursor: null });
  });

  it("passes the cursor, filters, value filters and sort through untouched", async () => {
    const { client, calls } = fakeClient({});
    const filters = [
      { fieldSlug: "status", fieldType: "text", operator: "equals" as const, value: "open" },
    ];
    const valueFilters = [{ fieldSlug: "score", operator: "gt" as const, value: 40 }];
    const sort = { fieldSlug: "due", fieldType: "date", direction: "asc" as const };
    await createAirAppRecords(client).readPage({
      baseId: "bas_1",
      limit: 10,
      cursor: "cur_9",
      filters,
      valueFilters,
      sort,
    });
    expect(sentInput(calls.list)).toEqual({
      baseId: "bas_1",
      limit: 10,
      cursor: "cur_9",
      filters,
      valueFilters,
      sort,
    });
  });

  it("keeps only this Base's rows from a pre-pagination server's bare array", async () => {
    // Those servers ignored `baseId` and answered with the whole space.
    const { client } = fakeClient({
      list: () => [record("rec_1", {}, "bas_1"), record("rec_x", {}, "bas_other")],
    });
    const page = await createAirAppRecords(client).readPage({ baseId: "bas_1" });
    expect(page.records.map((row) => row.id)).toEqual(["rec_1"]);
    expect(page.nextCursor).toBeNull();
  });
});

describe("findRecord", () => {
  it("matches one exact field value", async () => {
    const { client, calls } = fakeClient({ get: () => record("rec_7", { "contact-id": "c-7" }) });
    const found = await createAirAppRecords(client).findRecord({
      baseId: "bas_1",
      fieldSlug: "contact-id",
      valueText: "c-7",
    });
    expect(sentInput(calls.get)).toEqual({
      baseId: "bas_1",
      fieldSlug: "contact-id",
      valueText: "c-7",
    });
    expect(found?.fields).toEqual({ "contact-id": "c-7" });
  });

  it("is null on a 404, and for an empty value without asking", async () => {
    const { client, calls } = fakeClient({});
    const records = createAirAppRecords(client);
    expect(
      await records.findRecord({ baseId: "b", fieldSlug: "id", valueText: "nope" }),
    ).toBeNull();
    expect(await records.findRecord({ baseId: "b", fieldSlug: "id", valueText: "" })).toBeNull();
    expect(calls.get).toHaveBeenCalledTimes(1);
  });

  it("propagates every other failure", async () => {
    const denied = Object.assign(new Error("Forbidden"), { status: 403, code: "FORBIDDEN" });
    const { client } = fakeClient({
      get: () => {
        throw denied;
      },
    });
    await expect(
      createAirAppRecords(client).findRecord({ baseId: "b", fieldSlug: "id", valueText: "x" }),
    ).rejects.toBe(denied);
  });
});

describe("writes", () => {
  it("creates permission-aware: no autoMerge, the app named as submitter", async () => {
    const { client, calls } = fakeClient({
      createChangeRequest: () => ({ ...record("rec_new", {}), materialized: true }),
    });
    const result = await createAirAppRecords(client, { appId: "busa-crm" }).createRecord({
      baseId: "bas_1",
      fields: { name: "Ada" },
      message: "Add Ada",
    });
    const input = sentInput(calls.createChangeRequest);
    expect(input).toEqual({
      baseId: "bas_1",
      fields: { name: "Ada" },
      message: "Add Ada",
      submittedBy: "busa-crm",
    });
    expect("autoMerge" in input).toBe(false);
    expect(result).toMatchObject({ status: "saved", recordId: "rec_new" });
  });

  it("updates against the head it read, with no autoMerge", async () => {
    const { client, calls } = fakeClient({
      changeRequest: () => pendingChangeRequest("crq_1", "rec_1"),
    });
    const result = await createAirAppRecords(client, { appId: "busa-crm" }).updateRecord({
      recordId: "rec_1",
      baseCommitId: "cmt_rec_1",
      fields: { status: "won" },
      message: "Mark won",
    });
    const input = sentInput(calls.changeRequest);
    expect(input).toEqual({
      recordId: "rec_1",
      operation: "update",
      fields: { status: "won" },
      message: "Mark won",
      author: "busa-crm",
      baseCommitId: "cmt_rec_1",
    });
    expect("autoMerge" in input).toBe(false);
    expect(result).toMatchObject({ status: "queued", recordId: "rec_1", changeRequestId: "crq_1" });
  });

  it("leaves attribution to the server when no appId is given", async () => {
    const { client, calls } = fakeClient({
      createChangeRequest: () => ({ ...record("rec_new", {}), materialized: true }),
    });
    await createAirAppRecords(client).createRecord({ baseId: "bas_1", fields: { a: 1 } });
    expect(sentInput(calls.createChangeRequest)).toEqual({ baseId: "bas_1", fields: { a: 1 } });
  });
});

describe("upsert", () => {
  it("updates the matching record against its current head", async () => {
    const { client, calls } = fakeClient({
      get: () => record("rec_fu", { "followup-id": "fu-1", status: "draft" }),
      changeRequest: () => ({ ...record("rec_fu", { status: "approved" }), materialized: true }),
    });
    const result = await createAirAppRecords(client, { appId: "busa-crm" }).upsert({
      baseId: "bas_fu",
      fieldSlug: "followup-id",
      valueText: "fu-1",
      fields: { "followup-id": "fu-1", status: "approved" },
      message: "Approve fu-1",
    });
    expect(calls.createChangeRequest).not.toHaveBeenCalled();
    const input = sentInput(calls.changeRequest);
    expect(input).toMatchObject({
      recordId: "rec_fu",
      baseCommitId: "cmt_rec_fu",
      operation: "update",
    });
    expect("autoMerge" in input).toBe(false);
    expect(result).toMatchObject({ action: "update", status: "saved", recordId: "rec_fu" });
    expect(airAppWriteMessage(result, { locale: "en" })).toBe("Saved.");
  });

  it("creates when nothing matches, and reports a queued create honestly", async () => {
    const { client, calls } = fakeClient({
      createChangeRequest: () => pendingChangeRequest("crq_9", null),
    });
    const result = await createAirAppRecords(client, { appId: "busa-crm" }).upsert({
      baseId: "bas_fu",
      fieldSlug: "followup-id",
      valueText: "fu-2",
      fields: { status: "approved" },
      message: "Approve fu-2",
    });
    expect(calls.changeRequest).not.toHaveBeenCalled();
    const input = sentInput(calls.createChangeRequest);
    // The match field is filled in, so the next upsert finds this record instead
    // of creating another.
    expect(input.fields).toEqual({ status: "approved", "followup-id": "fu-2" });
    expect("autoMerge" in input).toBe(false);
    expect(result).toMatchObject({ action: "create", status: "queued", changeRequestId: "crq_9" });
    expect(result.recordId).toBeUndefined();
    expect(airAppWriteMessage(result, { locale: "zh-CN" })).toBe(
      "已提交审核。你在这里没有写权限，需要有写权限的人批准后才会生效。",
    );
  });

  it("keeps the caller's own value for the match field", async () => {
    const { client, calls } = fakeClient({
      createChangeRequest: () => ({ ...record("rec_n", {}), materialized: true }),
    });
    await createAirAppRecords(client).upsert({
      baseId: "b",
      fieldSlug: "id",
      valueText: "x-1",
      fields: { id: "x-1", name: "n" },
    });
    expect(sentInput(calls.createChangeRequest).fields).toEqual({ id: "x-1", name: "n" });
  });

  it("refuses an empty match value rather than creating an unfindable record", async () => {
    const { client, calls } = fakeClient({});
    await expect(
      createAirAppRecords(client).upsert({
        baseId: "b",
        fieldSlug: "id",
        valueText: "",
        fields: {},
      }),
    ).rejects.toThrow(/valueText for id is empty/);
    expect(calls.createChangeRequest).not.toHaveBeenCalled();
  });
});

describe("airAppRecordFields", () => {
  it("reads the head commit's payload, then the older spellings, else {}", () => {
    expect(airAppRecordFields({ headCommit: { payload: { a: 1 } } })).toEqual({ a: 1 });
    expect(airAppRecordFields({ headCommit: { fields: { b: 2 } } })).toEqual({ b: 2 });
    expect(airAppRecordFields({ fields: { c: 3 } })).toEqual({ c: 3 });
    expect(airAppRecordFields(null)).toEqual({});
    expect(airAppRecordFields({ headCommit: { payload: ["not", "a", "map"] } })).toEqual({});
  });
});
