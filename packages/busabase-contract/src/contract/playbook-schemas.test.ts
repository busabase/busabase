import { describe, expect, it } from "vitest";
import {
  formatPlaybookRef,
  PlaybookAttributionVOSchema,
  parsePlaybookRef,
} from "./playbook-schemas";

describe("playbook ref (x-busabase-playbook)", () => {
  it("parses a skill and a prompt, keeping colons inside a prompt key", () => {
    expect(parsePlaybookRef("skill:nod_1")).toEqual({ kind: "skill", nodeId: "nod_1", key: null });
    expect(parsePlaybookRef(" prompt:nod_1:log-visit ")).toEqual({
      kind: "prompt",
      nodeId: "nod_1",
      key: "log-visit",
    });
    expect(parsePlaybookRef("prompt:nod_1:a:b")).toEqual({
      kind: "prompt",
      nodeId: "nod_1",
      key: "a:b",
    });
  });

  it.each([
    [null],
    [""],
    ["skill"],
    ["skill:"],
    ["prompt:nod_1"],
    ["prompt:nod_1:"],
    ["skill:nod_1:extra"],
    ["recipe:nod_1"],
    [":nod_1"],
    [`skill:${"x".repeat(600)}`],
  ])("rejects %j", (value) => {
    expect(parsePlaybookRef(value)).toBeNull();
  });

  it("round-trips through formatPlaybookRef", () => {
    for (const value of ["skill:nod_1", "prompt:nod_1:log-visit"]) {
      const ref = parsePlaybookRef(value);
      expect(ref && formatPlaybookRef(ref)).toBe(value);
    }
  });

  it("accepts the hidden (not accessible) attribution shape", () => {
    expect(
      PlaybookAttributionVOSchema.parse({
        kind: "skill",
        accessible: false,
        nodeId: null,
        key: null,
        nodeType: null,
        nodeSlug: null,
        label: null,
      }).accessible,
    ).toBe(false);
  });
});
