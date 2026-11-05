import { describe, expect, it } from "vitest";
import { compareSessionsByRecency } from "./session-recency";

const ended = "2026-11-03T04:11:57.576Z";

describe("compareSessionsByRecency", () => {
  it("puts the newest conversation first when ending them tied their activity", () => {
    // The order a table may hand back: older conversations first.
    const sessions = [
      { id: "ags_c", createdAt: "2026-11-03T04:10:00.000Z", lastActivityAt: ended },
      { id: "ags_a", createdAt: "2026-11-03T04:11:40.000Z", lastActivityAt: ended },
      { id: "ags_b", createdAt: "2026-11-03T04:10:30.000Z", lastActivityAt: ended },
    ];
    expect([...sessions].sort(compareSessionsByRecency).map((s) => s.id)).toEqual([
      "ags_a",
      "ags_b",
      "ags_c",
    ]);
  });

  it("still orders by activity first", () => {
    const sessions = [
      {
        id: "ags_new",
        createdAt: "2026-11-03T04:11:00.000Z",
        lastActivityAt: "2026-11-03T04:11:01Z",
      },
      {
        id: "ags_old",
        createdAt: "2026-11-03T04:00:00.000Z",
        lastActivityAt: "2026-11-03T04:12:00Z",
      },
    ];
    expect([...sessions].sort(compareSessionsByRecency).map((s) => s.id)).toEqual([
      "ags_old",
      "ags_new",
    ]);
  });

  it("is a total order: identical times fall back to the id", () => {
    const at = "2026-11-03T04:11:00.000Z";
    const sessions = [
      { id: "ags_1", createdAt: at, lastActivityAt: at },
      { id: "ags_2", createdAt: at, lastActivityAt: at },
    ];
    expect([...sessions].sort(compareSessionsByRecency).map((s) => s.id)).toEqual([
      "ags_2",
      "ags_1",
    ]);
    expect(
      [...sessions]
        .reverse()
        .sort(compareSessionsByRecency)
        .map((s) => s.id),
    ).toEqual(["ags_2", "ags_1"]);
  });
});
