import { describe, expect, it } from "vitest";
import {
  combineRecordCollectionStatus,
  type RecordCollectionStatus,
} from "./record-collection-status";

const loaded = (total: number, scope = "current"): RecordCollectionStatus => ({
  scope,
  total,
  isFetching: false,
  isError: false,
});

describe("record collection status", () => {
  it("propagates lower bounds without labeling their sum as an exact count", () => {
    expect(
      combineRecordCollectionStatus("current", ["a", "b"], {
        a: { ...loaded(20), totalCapped: true },
        b: loaded(7),
      }),
    ).toMatchObject({ total: 27, totalCapped: true, isFetching: false });
  });
  it("does not present a partial or previous search's column total as the whole board", () => {
    expect(combineRecordCollectionStatus("current", ["a", "b"], { a: loaded(30) })).toMatchObject({
      total: undefined,
      isFetching: true,
      isError: false,
    });
    expect(
      combineRecordCollectionStatus("current", ["a", "b"], {
        a: loaded(30),
        b: loaded(50, "previous"),
      }),
    ).toMatchObject({ total: undefined, isFetching: true });
    expect(
      combineRecordCollectionStatus("current", ["a", "b"], {
        a: loaded(30),
        b: loaded(10),
        hidden: loaded(100),
      }),
    ).toEqual({ scope: "current", total: 40, isFetching: false, isError: false });
  });

  it("keeps a failed column distinct from a complete zero-match board", () => {
    expect(
      combineRecordCollectionStatus("current", ["a", "b"], {
        a: loaded(0),
        b: { ...loaded(20), isError: true },
      }),
    ).toMatchObject({ total: undefined, isFetching: false, isError: true });
    expect(
      combineRecordCollectionStatus("current", ["a", "b"], {
        a: loaded(0),
        b: loaded(0),
      }),
    ).toMatchObject({ total: 0, isFetching: false, isError: false });
  });
});
