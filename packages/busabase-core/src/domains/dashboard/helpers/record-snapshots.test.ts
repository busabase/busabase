import type { RecordVO } from "busabase-contract/types";
import { describe, expect, it } from "vitest";
import {
  LIST_OMITTED_FIELD_VALUE,
  LIST_OMITTED_LONG_TEXT_VALUE,
} from "../utils/list-payload-preview";
import {
  hasOmittedListValues,
  isFullReadBehind,
  mergeRecordSnapshots,
  overlayFreshListFields,
  resolveActiveRecord,
} from "./record-snapshots";

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

  it("keeps full detail fields while overlaying fresh list lookup values", () => {
    const detail = {
      ...derived(26, "old", 100),
      headCommitId: "head-1",
      headCommit: {
        ...record(26).headCommit,
        payload: { body: "complete body", sum: 26 },
      },
    };
    const list = {
      ...derived(32, "new", 200),
      headCommitId: "head-1",
      headCommit: {
        ...record(32).headCommit,
        payload: {
          body: "[long text omitted from the list view - open the change request to view]",
          sum: 32,
        },
      },
    };

    expect(overlayFreshListFields(detail, list)).toMatchObject({
      headCommitId: "head-1",
      computedFields: list.computedFields,
      headCommit: { payload: { body: "complete body", sum: 32 } },
    });
  });

  it("does not mix a list row from a different record version into detail", () => {
    const detail = derived(26, "old", 100);
    const list = { ...derived(32, "new", 200), headCommitId: "head-2" };

    expect(overlayFreshListFields(detail, list)).toBe(detail);
  });

  describe("resolveActiveRecord", () => {
    const row = (payload: Record<string, unknown>, computedFields?: RecordVO["computedFields"]) =>
      ({
        id: "source",
        headCommitId: "head",
        updatedAt: "2026-10-12T01:00:00.000Z",
        computedFields,
        headCommit: { payload },
      }) as unknown as RecordVO;
    const omittedRow = row({ title: "Report", body: LIST_OMITTED_LONG_TEXT_VALUE });
    const fullRow = row({ title: "Report", body: "complete" });

    it("holds back a row with omission markers until the full read arrives", () => {
      expect(
        resolveActiveRecord({ fullRecord: null, listedRecord: omittedRow, requiresFullRead: true }),
      ).toBeNull();
      expect(
        resolveActiveRecord({
          fullRecord: fullRow,
          listedRecord: omittedRow,
          requiresFullRead: true,
        })?.headCommit.payload.body,
      ).toBe("complete");
    });

    it("holds back a row whose only omission is inside a computed source", () => {
      const listed = row({ title: "Report" }, {
        total: {
          status: "ready",
          value: 2,
          sources: [{ recordId: "a", title: "A", value: LIST_OMITTED_FIELD_VALUE }],
        },
      } as unknown as RecordVO["computedFields"]);
      expect(hasOmittedListValues(listed)).toBe(true);
      expect(
        resolveActiveRecord({ fullRecord: null, listedRecord: listed, requiresFullRead: true }),
      ).toBeNull();
    });

    it("renders a complete row straight away, and any row off the compact path", () => {
      const complete = row({ title: "Short" });
      expect(
        resolveActiveRecord({ fullRecord: null, listedRecord: complete, requiresFullRead: true }),
      ).toBe(complete);
      expect(
        resolveActiveRecord({
          fullRecord: null,
          listedRecord: omittedRow,
          requiresFullRead: false,
        }),
      ).toBe(omittedRow);
      expect(
        resolveActiveRecord({ fullRecord: null, listedRecord: null, requiresFullRead: true }),
      ).toBeNull();
    });
  });

  describe("overlayFreshListFields computed values", () => {
    const computed = (value: unknown, sourceValue: unknown) => ({
      status: "ready" as const,
      value,
      sources: [{ recordId: "a", title: "A", value: sourceValue }],
    });
    const withComputed = (
      total: ReturnType<typeof computed>,
      fieldUsers?: RecordVO["fieldUsers"],
    ) =>
      ({
        id: "source",
        headCommitId: "head",
        updatedAt: "2026-10-12T01:00:00.000Z",
        computedFields: { total },
        fieldUsers,
        headCommit: { payload: {} },
      }) as unknown as RecordVO;

    it("keeps the detail value when the list only has an omission marker", () => {
      const detail = withComputed(computed("full text", "full text"));
      const list = withComputed(
        computed(LIST_OMITTED_LONG_TEXT_VALUE, LIST_OMITTED_LONG_TEXT_VALUE),
      );
      expect(overlayFreshListFields(detail, list).computedFields?.total?.value).toBe("full text");
    });

    it("takes a fresh list value but keeps full sources behind an omitted one", () => {
      const detail = withComputed(computed(1, "full source"));
      const list = withComputed(computed(2, LIST_OMITTED_LONG_TEXT_VALUE));
      const total = overlayFreshListFields(detail, list).computedFields?.total;
      expect(total?.value).toBe(2);
      expect(total?.sources[0]?.value).toBe("full source");
    });

    it("still takes a wholly fresh list value", () => {
      const detail = withComputed(computed(1, 1));
      const list = withComputed(computed(2, 2));
      expect(overlayFreshListFields(detail, list).computedFields?.total?.value).toBe(2);
    });

    it("merges field users so people behind omitted values still resolve", () => {
      const alice = { id: "alice" } as NonNullable<RecordVO["fieldUsers"]>[string];
      const bob = { id: "bob" } as NonNullable<RecordVO["fieldUsers"]>[string];
      const merged = overlayFreshListFields(
        withComputed(computed(1, 1), { alice }),
        withComputed(computed(1, 1), { bob }),
      );
      expect(merged.fieldUsers).toEqual({ alice, bob });
    });
  });

  describe("full reads never replace a later commit", () => {
    const version = (
      commit: string,
      updatedAt: string,
      payload: Record<string, unknown>,
      computedFields?: RecordVO["computedFields"],
    ) =>
      ({
        id: "source",
        headCommitId: commit,
        updatedAt,
        computedFields,
        headCommit: { createdAt: updatedAt, payload },
      }) as unknown as RecordVO;
    const oldFull = version("a", "2026-10-12T01:00:00.000Z", { name: "Old name", body: "old" });
    const newRow = version("b", "2026-10-12T02:00:00.000Z", { name: "Latest name", body: "new" });
    const newCompactRow = version("b", "2026-10-12T02:00:00.000Z", {
      name: "Latest name",
      body: LIST_OMITTED_LONG_TEXT_VALUE,
    });

    it("keeps a complete later row when an older detail lands after it", () => {
      expect(
        resolveActiveRecord({ fullRecord: oldFull, listedRecord: newRow, requiresFullRead: true }),
      ).toBe(newRow);
    });

    it("waits rather than falling back when the later commit is only compact", () => {
      expect(
        resolveActiveRecord({
          fullRecord: oldFull,
          listedRecord: newCompactRow,
          requiresFullRead: true,
        }),
      ).toBeNull();
    });

    it("keeps what is already on screen, so a mounted editor and its draft survive", () => {
      expect(
        resolveActiveRecord({
          fullRecord: oldFull,
          listedRecord: newCompactRow,
          requiresFullRead: true,
          shownRecord: oldFull,
        }),
      ).toBe(oldFull);
    });

    it("gives up waiting once a re-read has run and still returned the older commit", () => {
      expect(
        resolveActiveRecord({
          fullRecord: oldFull,
          listedRecord: newCompactRow,
          requiresFullRead: true,
          fullReadSettled: true,
        }),
      ).toBe(oldFull);
    });

    it("keeps a newer detail over an older list row", () => {
      const newFull = version("b", "2026-10-12T02:00:00.000Z", {
        name: "Latest name",
        body: "new",
      });
      const oldRow = version("a", "2026-10-12T01:00:00.000Z", { name: "Old name" });
      expect(
        resolveActiveRecord({ fullRecord: newFull, listedRecord: oldRow, requiresFullRead: true })
          ?.headCommit.payload.name,
      ).toBe("Latest name");
      expect(isFullReadBehind(newFull, oldRow)).toBe(false);
    });

    it("asks for a re-read only when the list knows something the detail cannot show", () => {
      expect(isFullReadBehind(oldFull, newRow)).toBe(true);
      expect(isFullReadBehind(oldFull, newCompactRow)).toBe(true);
      expect(isFullReadBehind(oldFull, oldFull)).toBe(false);
      expect(isFullReadBehind(null, newRow)).toBe(false);

      const lookup = (value: unknown, dependencyVersion: string) =>
        ({
          total: { status: "ready", value, sources: [], dependencyVersion },
        }) as unknown as RecordVO["computedFields"];
      const at = "2026-10-12T01:00:00.000Z";
      const detail = version("a", at, {}, lookup("full", "v1"));
      expect(
        isFullReadBehind(detail, version("a", at, {}, lookup(LIST_OMITTED_FIELD_VALUE, "v2"))),
      ).toBe(true);
      expect(
        isFullReadBehind(detail, version("a", at, {}, lookup(LIST_OMITTED_FIELD_VALUE, "v1"))),
      ).toBe(false);
      expect(isFullReadBehind(detail, version("a", at, {}, lookup(2, "v2")))).toBe(false);
    });
  });
});
