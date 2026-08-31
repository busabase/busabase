import type { ChangeRequestVO, OperationVO } from "busabase-contract/types";
import { describe, expect, it } from "vitest";
import { coreMessagesEn } from "../../../i18n";
import {
  buildPayloadDraft,
  isChangeRequestRevisable,
  parsePayloadDraftValue,
  payloadEditorKindFor,
  payloadValueToDraft,
  resolvePayloadDraft,
} from "./operation-revise";

const timestamp = "2026-08-28T08:00:00.000Z";

const makeOperation = (payload: Record<string, unknown>): OperationVO =>
  ({
    id: "opr_1",
    changeRequestId: "crq_1",
    baseId: "bas_1",
    targetType: "base",
    nodeId: "nod_1",
    operation: "record_update",
    status: "pending",
    targetRecordId: "rec_1",
    targetViewId: null,
    filePath: null,
    sourceRecordId: null,
    sourceCommitId: null,
    baseCommitId: "cmt_before",
    headCommitId: "cmt_after",
    deleteMode: "archive",
    mergedRecordId: null,
    mergedViewId: null,
    position: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    baseFields: null,
    headCommit: {
      id: "cmt_after",
      baseId: "bas_1",
      targetType: "base",
      nodeId: "nod_1",
      operationId: "opr_1",
      parentCommitId: "cmt_before",
      payload,
      operation: "record_update",
      message: "Update",
      author: "agent_1",
      createdAt: timestamp,
    },
  }) as unknown as OperationVO;

const makeChangeRequest = (status: string): ChangeRequestVO =>
  ({
    id: "crq_1",
    status,
    base: { id: "bas_1", fields: [] },
    operations: [],
    reviews: [],
  }) as unknown as ChangeRequestVO;

describe("isChangeRequestRevisable", () => {
  it.each(["in_review", "changes_requested", "conflict"])("allows %s", (status) => {
    expect(isChangeRequestRevisable(makeChangeRequest(status))).toBe(true);
  });

  it.each(["approved", "rejected", "merged", "closed"])("refuses %s", (status) => {
    expect(isChangeRequestRevisable(makeChangeRequest(status))).toBe(false);
  });
});

describe("payloadEditorKindFor", () => {
  it("routes each value shape to its control", () => {
    expect(payloadEditorKindFor(true)).toBe("boolean");
    expect(payloadEditorKindFor(42)).toBe("number");
    expect(payloadEditorKindFor("short")).toBe("text");
    expect(payloadEditorKindFor("a".repeat(80))).toBe("longText");
    expect(payloadEditorKindFor("line\nbreak")).toBe("longText");
    expect(payloadEditorKindFor({ nested: 1 })).toBe("json");
    expect(payloadEditorKindFor(["a"])).toBe("json");
    expect(payloadEditorKindFor(null)).toBe("json");
  });
});

describe("payload draft round-trip", () => {
  it.each([
    ["text", "hello"],
    ["longText", "a".repeat(80)],
    ["number", 42],
    ["boolean", true],
    ["boolean", false],
    ["json", { nested: ["a", 1] }],
    ["json", ["x", "y"]],
    ["json", null],
  ] as const)("preserves %s values through draft → parse", (_label, value) => {
    const kind = payloadEditorKindFor(value);
    const raw = payloadValueToDraft(value, kind);
    const parsed = parsePayloadDraftValue(raw, kind);

    expect(parsed.error).toBeNull();
    expect(parsed.value).toEqual(value);
  });

  it("reports invalid JSON and invalid numbers instead of coercing them", () => {
    expect(parsePayloadDraftValue("{oops", "json").error).toBe("invalidJson");
    expect(parsePayloadDraftValue("12a", "number").error).toBe("invalidNumber");
    expect(parsePayloadDraftValue("", "number").error).toBe("invalidNumber");
    // An empty string is a legitimate text value, not an error.
    expect(parsePayloadDraftValue("", "text")).toEqual({ error: null, value: "" });
  });
});

describe("buildPayloadDraft", () => {
  it("seeds EVERY payload key, not just the ones the diff highlights", () => {
    // `reviseOperation` replaces the commit payload wholesale, so a draft seeded
    // from the (change-filtered) diff would silently drop untouched keys.
    const operation = makeOperation({ company: "After Ltd", tier: "gold", seats: 3 });
    const entries = buildPayloadDraft(makeChangeRequest("in_review"), operation, coreMessagesEn);

    expect(entries.map((entry) => entry.slug).sort()).toEqual(["company", "seats", "tier"]);
  });

  it("drops undefined payload values", () => {
    const operation = makeOperation({ company: "After Ltd", dropped: undefined });
    const entries = buildPayloadDraft(makeChangeRequest("in_review"), operation, coreMessagesEn);

    expect(entries.map((entry) => entry.slug)).toEqual(["company"]);
  });

  it("round-trips an untouched draft back to the original payload", () => {
    const payload = { company: "After Ltd", seats: 3, active: true, tags: ["a", "b"] };
    const operation = makeOperation(payload);
    const entries = buildPayloadDraft(makeChangeRequest("in_review"), operation, coreMessagesEn);

    const { errors, fields } = resolvePayloadDraft(entries);

    expect(errors).toEqual({});
    expect(fields).toEqual(payload);
  });
});

describe("resolvePayloadDraft", () => {
  it("collects per-field errors and omits only the broken fields", () => {
    const { errors, fields } = resolvePayloadDraft([
      { kind: "text", label: "Company", raw: "After Ltd", slug: "company" },
      { kind: "number", label: "Seats", raw: "not-a-number", slug: "seats" },
      { kind: "json", label: "Tags", raw: "[broken", slug: "tags" },
    ]);

    expect(errors).toEqual({ seats: "invalidNumber", tags: "invalidJson" });
    expect(fields).toEqual({ company: "After Ltd" });
  });
});
