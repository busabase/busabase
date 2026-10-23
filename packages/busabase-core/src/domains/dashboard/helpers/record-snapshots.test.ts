import type { RecordVO } from "busabase-contract/types";
import { describe, expect, it } from "vitest";
import { mergeRecordSnapshots } from "./record-snapshots";

const record = (value: number, updatedAt = "2026-10-12T01:00:00.000Z") =>
  ({ id: "source", updatedAt, headCommit: { payload: { total: value } } }) as unknown as RecordVO;

describe("record snapshots", () => {
  const derived = (value: number, version: string, readAt: number) => ({
    ...record(value),
    computedFields: {
      total: {
        status: "ready" as const,
        value,
        sources: [],
        dependencyVersion: version,
        dependencyReadAt: readAt,
      },
    },
  });

  it("rejects an older slow detail read even when it arrives after a fresh list", () => {
    const old = { record: derived(3, "z-old", 100), fetchedAt: 300 };
    const fresh = { record: derived(7, "a-new", 200), fetchedAt: 250 };
    expect(mergeRecordSnapshots([old, fresh])).toEqual([fresh.record]);
    expect(mergeRecordSnapshots([fresh, old])).toEqual([fresh.record]);
  });

  it("falls back to cache time for equal hashes or equal read times", () => {
    for (const [version, readAt] of [
      ["same", 50],
      ["different", 100],
    ] as const) {
      const first = derived(3, "same", 100);
      const last = derived(7, version, readAt);
      expect(
        mergeRecordSnapshots([
          { record: first, fetchedAt: 100 },
          { record: last, fetchedAt: 200 },
        ]),
      ).toEqual([last]);
    }
  });

  it("falls back when field read times conflict or legacy metadata is missing", () => {
    const first = derived(3, "v1", 100);
    const last = derived(7, "v2", 200);
    Object.assign(first.computedFields, {
      extra: { ...first.computedFields.total, dependencyReadAt: 300 },
    });
    Object.assign(last.computedFields, {
      extra: { ...last.computedFields.total, dependencyReadAt: 150 },
    });
    expect(
      mergeRecordSnapshots([
        { record: first, fetchedAt: 100 },
        { record: last, fetchedAt: 200 },
      ]),
    ).toEqual([last]);
    const legacy = record(1);
    expect(
      mergeRecordSnapshots([
        { record: last, fetchedAt: 100 },
        { record: legacy, fetchedAt: 200 },
      ]),
    ).toEqual([legacy]);
  });

  it("uses the newly fetched lookup without a source commit change", () => {
    const before = record(3);
    const after = record(7);
    expect(
      mergeRecordSnapshots([
        { record: before, fetchedAt: 100 },
        { record: after, fetchedAt: 200 },
      ]),
    ).toEqual([after]);
  });

  it("compares head commits before cache arrival when update timestamps tie", () => {
    const old = {
      ...record(3),
      headCommit: { ...record(3).headCommit, createdAt: "2026-10-10T00:00:00.000Z" },
    };
    const fresh = {
      ...record(7),
      headCommit: { ...record(7).headCommit, createdAt: "2026-10-11T00:00:00.000Z" },
    };
    const snapshots = [
      { record: old, fetchedAt: 300 },
      { record: fresh, fetchedAt: 200 },
    ];
    expect(mergeRecordSnapshots(snapshots)).toEqual([fresh]);
    expect(mergeRecordSnapshots([...snapshots].reverse())).toEqual([fresh]);
  });

  it("keeps a newer head commit even if the older commit has a later dependency read", () => {
    const old = {
      ...derived(3, "old", 300),
      headCommit: { ...record(3).headCommit, createdAt: "2026-10-10T00:00:00.000Z" },
    };
    const fresh = {
      ...derived(7, "new", 200),
      headCommit: { ...record(7).headCommit, createdAt: "2026-10-11T00:00:00.000Z" },
    };
    const snapshots = [
      { record: old, fetchedAt: 300 },
      { record: fresh, fetchedAt: 200 },
    ];
    expect(mergeRecordSnapshots(snapshots)).toEqual([fresh]);
    expect(mergeRecordSnapshots([...snapshots].reverse())).toEqual([fresh]);
  });

  it("keeps a newer source commit even if an older snapshot arrives later", () => {
    const newer = record(7, "2026-10-12T02:00:00.000Z");
    expect(
      mergeRecordSnapshots([
        { record: newer, fetchedAt: 100 },
        { record: record(3), fetchedAt: 200 },
      ]),
    ).toEqual([newer]);
  });

  it("does not let a seeded detail snapshot overwrite a fetched list", () => {
    const fetched = record(7);
    expect(
      mergeRecordSnapshots([
        { record: record(3), fetchedAt: 0 },
        { record: fetched, fetchedAt: 100 },
      ]),
    ).toEqual([fetched]);
  });

  it("deduplicates records while preserving first-seen order and ignoring missing queries", () => {
    const source = record(3);
    const other = { ...source, id: "other" };
    expect(
      mergeRecordSnapshots([
        { record: undefined, fetchedAt: 0 },
        { record: source, fetchedAt: 1 },
        { record: other, fetchedAt: 1 },
        { record: source, fetchedAt: 2 },
      ]),
    ).toEqual([source, other]);
  });
});
