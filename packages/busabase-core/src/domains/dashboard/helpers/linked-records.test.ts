import type { RecordVO } from "busabase-contract/types";
import { describe, expect, it, vi } from "vitest";
import { getLinkedRecordIds } from "./field";
import {
  chunkRecordIds,
  fetchRecordsByIds,
  isMissingProcedureError,
  LINKED_RECORDS_CHUNK_SIZE,
} from "./linked-records";

const record = (id: string) => ({ id }) as RecordVO;
const notFound = () => Object.assign(new Error("Not Found"), { code: "NOT_FOUND", status: 404 });

describe("chunkRecordIds", () => {
  it("dedupes, sorts and splits at the getMany bound", () => {
    expect(LINKED_RECORDS_CHUNK_SIZE).toBe(100);
    const ids = Array.from({ length: 205 }, (_, i) => `rec_${String(i).padStart(3, "0")}`);
    const chunks = chunkRecordIds([...ids].reverse().concat(ids.slice(0, 10), ""));
    expect(chunks.map((chunk) => chunk.length)).toEqual([100, 100, 5]);
    expect(chunks.flat()).toEqual(ids);
    // Same set in another order → identical chunks (stable query keys).
    expect(chunkRecordIds(ids)).toEqual(chunks);
  });
});

describe("fetchRecordsByIds", () => {
  it("uses one batched read when the server has records.getMany", async () => {
    const getMany = vi.fn(async (ids: string[]) => ({ records: ids.map(record), missingIds: [] }));
    const getOne = vi.fn();
    expect(await fetchRecordsByIds({ getMany, getOne }, ["a", "b"])).toEqual({
      records: [record("a"), record("b")],
      missingIds: [],
    });
    expect(getMany).toHaveBeenCalledOnce();
    expect(getOne).not.toHaveBeenCalled();
  });

  it("falls back to per-id records.get on a server without records.getMany", async () => {
    const getMany = vi.fn(async () => {
      throw notFound();
    });
    const getOne = vi.fn(async (id: string) => {
      if (id === "gone") throw notFound();
      return record(id);
    });
    expect(await fetchRecordsByIds({ getMany, getOne }, ["a", "gone", "b"])).toEqual({
      records: [record("a"), record("b")],
      missingIds: ["gone"],
    });
    expect(getOne.mock.calls.map(([id]) => id)).toEqual(["a", "gone", "b"]);
  });

  it("does not fall back on other failures, and fails the chunk on a non-404 per-id error", async () => {
    const forbidden = Object.assign(new Error("nope"), { code: "FORBIDDEN", status: 403 });
    const getOne = vi.fn(async (id: string) => record(id));
    await expect(
      fetchRecordsByIds(
        {
          getMany: async () => {
            throw forbidden;
          },
          getOne,
        },
        ["a"],
      ),
    ).rejects.toBe(forbidden);
    expect(getOne).not.toHaveBeenCalled();

    await expect(
      fetchRecordsByIds(
        {
          getMany: async () => {
            throw notFound();
          },
          getOne: async () => {
            throw forbidden;
          },
        },
        ["a"],
      ),
    ).rejects.toBe(forbidden);
  });

  it("classifies only NOT_FOUND / 404 as a missing procedure", () => {
    expect(isMissingProcedureError(notFound())).toBe(true);
    expect(isMissingProcedureError({ status: 404 })).toBe(true);
    expect(isMissingProcedureError(new Error("Record not found: 404"))).toBe(false);
    expect(isMissingProcedureError({ code: "BAD_REQUEST", status: 400 })).toBe(false);
  });
});

describe("getLinkedRecordIds", () => {
  it("adds ids a Lookup-of-a-relation renders, one level deep, skipping hidden targets", () => {
    const relationTarget = (targetBaseId: string) => ({
      slug: "owner",
      type: "relation",
      options: { targetBaseId },
    });
    const source = {
      base: {
        fields: [{ slug: "company", type: "relation", options: { targetBaseId: "companies" } }],
      },
      headCommit: { payload: { company: ["acme"] } },
      computedFields: {
        owners: {
          status: "ready",
          value: [["alice"], ["bob"]],
          targetField: relationTarget("people"),
          sources: [
            { recordId: "acme", title: "Acme", value: ["alice"], headCommitId: "c1" },
            { recordId: "globex", title: "Globex", value: ["bob", "alice"], headCommitId: "c2" },
          ],
          dependencyVersion: "v",
        },
        secret: {
          status: "ready",
          value: ["payroll"],
          targetField: relationTarget("private"),
          sources: [],
          dependencyVersion: "v",
        },
        tier: {
          status: "ready",
          value: 3,
          targetField: { slug: "tier", type: "number", options: {} },
          sources: [],
          dependencyVersion: "v",
        },
      },
    } as unknown as RecordVO;
    expect(getLinkedRecordIds([source], new Set(["companies", "people"]))).toEqual([
      "acme",
      "alice",
      "bob",
    ]);
  });
});
