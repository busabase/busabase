import { describe, expect, it } from "vitest";
import { matchSearchSpaces } from "./search-spaces";

const spaces = [
  { id: "s1", name: "Personal" },
  { id: "s2", name: "Qiming Ventures Demo" },
  { id: "s3", name: "Acme Demo" },
  { id: "s4", name: "Demo Lab" },
  { id: "s5", name: "启明创投" },
];

describe("matchSearchSpaces", () => {
  it("finds nothing without a query, so most people never see the section", () => {
    expect(matchSearchSpaces(spaces, "s1", "")).toEqual([]);
    expect(matchSearchSpaces(spaces, "s1", "   ")).toEqual([]);
  });

  it("matches names case-insensitively, prefix matches first, and skips the active space", () => {
    expect(matchSearchSpaces(spaces, "s3", "DEMO").map((space) => space.id)).toEqual(["s4", "s2"]);
    expect(matchSearchSpaces(spaces, "s1", "启明").map((space) => space.id)).toEqual(["s5"]);
  });

  it("stops at the limit", () => {
    expect(matchSearchSpaces(spaces, undefined, "e", 2)).toHaveLength(2);
  });
});
