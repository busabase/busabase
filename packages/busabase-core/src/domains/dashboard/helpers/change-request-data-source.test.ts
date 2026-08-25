import { describe, expect, it } from "vitest";
import { shouldQueryGlobalChangeRequests } from "./change-request-data-source";

describe("ChangeRequest route data source", () => {
  it.each(["/", "/home"])("uses the global cursor list on %s", (path) => {
    expect(shouldQueryGlobalChangeRequests(path)).toBe(true);
  });

  it.each(["/inbox", "/inbox/cr-1", "/inbox/cr-1/op-1", "/activity", "/base/tasks"])(
    "does not keep the global list active on %s",
    (path) => {
      expect(shouldQueryGlobalChangeRequests(path)).toBe(false);
    },
  );
});
