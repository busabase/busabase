import type { RecordVO } from "busabase-contract/types";
import { describe, expect, it } from "vitest";
import { mergeFreshRecords } from "./merge-records";

const record = (id: string, updatedAt: string, createdAt = updatedAt) =>
  ({ id, updatedAt, headCommit: { createdAt } }) as RecordVO;
describe("mergeFreshRecords", () => {
  it("a newer list record supersedes stale detail without changing row order", () => {
    const old = record("a", "2026-10-10T00:00:00Z");
    const fresh = record("a", "2026-10-12T00:00:00Z");
    const other = record("b", "2026-10-11T00:00:00Z");
    expect(mergeFreshRecords([old, undefined, other, fresh])).toEqual([fresh, other]);
  });
  it("a genuinely newer detail wins over older list data", () => {
    const fresh = record("a", "2026-10-12T00:00:00Z");
    expect(mergeFreshRecords([fresh, record("a", "2026-10-10T00:00:00Z")])).toEqual([fresh]);
  });
  it("compares head commits when update timestamps tie", () => {
    const old = record("a", "2026-10-12T00:00:00Z", "2026-10-10T00:00:00Z");
    const fresh = record("a", old.updatedAt, "2026-10-11T00:00:00Z");
    expect(mergeFreshRecords([old, fresh])).toEqual([fresh]);
  });
});
