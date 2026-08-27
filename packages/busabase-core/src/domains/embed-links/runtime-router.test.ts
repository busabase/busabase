import { describe, expect, it } from "vitest";
import { isAirAppEmbedReadableInput, isAirAppEmbedReadableProcedure } from "./runtime-router";

describe("AirApp embed data policy", () => {
  it.each([
    ["nodes.list"],
    ["nodes.get"],
    ["bases.list"],
    ["records.list"],
    ["nodes.readLines"],
    ["fileTrees.readFile"],
    ["assets.download"],
  ])("allows the explicit read procedure %s", (path) => {
    expect(isAirAppEmbedReadableProcedure(path.split("."), "GET")).toBe(true);
    expect(isAirAppEmbedReadableProcedure(["core", ...path.split(".")], "GET")).toBe(true);
  });

  it.each([
    ["airapps.runLocal", "POST"],
    // Retired routes: they are not procedures any more, and must not creep back
    // onto the allowlist as aliases either.
    ["docs.get", "GET"],
    ["docs.list", "GET"],
    ["files.get", "GET"],
    ["files.list", "GET"],
    ["folders.get", "GET"],
    ["folders.list", "GET"],
    ["fileTrees.get", "GET"],
    ["fileTrees.list", "GET"],
    ["vault.list", "GET"],
    ["systemAdmin.list", "GET"],
    ["apiKeys.list", "GET"],
    ["embedLinks.list", "GET"],
    ["nodes.createChangeRequest", "POST"],
    ["records.changeRequest", "POST"],
    ["grep", "POST"],
    ["live.subscribe", undefined],
  ])("denies non-data or mutating procedure %s", (path, method) => {
    expect(isAirAppEmbedReadableProcedure(path.split("."), method)).toBe(false);
  });

  it("fails closed if a readable path has mutating route metadata", () => {
    expect(isAirAppEmbedReadableProcedure(["records", "list"], "POST")).toBe(false);
  });

  // Skills/Drives/AirApps share `/file-trees` now, so the "an AirApp may not read
  // another AirApp's source" boundary moved from the namespace to `type`.
  it.each([["skill"], ["drive"]])("allows file-tree reads of type %s", (type) => {
    expect(isAirAppEmbedReadableInput(["fileTrees", "listFiles"], { nodeId: "nod_1", type })).toBe(
      true,
    );
    expect(
      isAirAppEmbedReadableInput(["core", "fileTrees", "listFiles"], { nodeId: "nod_1", type }),
    ).toBe(true);
  });

  it.each([
    ["airapp", { nodeId: "nod_1", type: "airapp" }],
    ["no type at all", { nodeId: "nod_1" }],
    ["an untyped list", {}],
  ])("refuses file-tree reads for %s", (_label, input) => {
    expect(isAirAppEmbedReadableInput(["fileTrees", "listFiles"], input)).toBe(false);
  });

  /**
   * `fileTrees.get` was folded into `nodes.get`, which serves EVERY node type.
   * The AirApp boundary has to survive that merge on the unified route, or an
   * embedded AirApp could read another AirApp's file list through
   * `GET /nodes/{nodeId}` instead of `GET /file-trees/{nodeId}`.
   */
  it.each([["skill"], ["drive"]])("allows nodes.get for file-tree type %s", (type) => {
    expect(isAirAppEmbedReadableInput(["nodes", "get"], { nodeId: "nod_1", type })).toBe(true);
    expect(isAirAppEmbedReadableInput(["core", "nodes", "get"], { nodeId: "nod_1", type })).toBe(
      true,
    );
  });

  it.each([
    ["an AirApp", { nodeId: "nod_1", type: "airapp" }],
    // An un-hinted id could resolve to an AirApp, and this runs before the
    // handler — there is nothing here that could tell the two apart.
    ["an un-hinted node id", { nodeId: "nod_1" }],
    // This gate runs BEFORE the contract's zod parse, so it sees whatever the
    // transport decoded. A repeated query param (`?type=doc&type=airapp`)
    // arrives as an array, not a string — it must fail closed rather than be
    // read as its first (innocent-looking) element.
    ["a repeated `type` query param", { nodeId: "nod_1", type: ["doc", "airapp"] }],
    ["a non-string `type`", { nodeId: "nod_1", type: { toString: (): string => "skill" } }],
  ])("refuses nodes.get for %s", (_label, input) => {
    expect(isAirAppEmbedReadableInput(["nodes", "get"], input)).toBe(false);
    expect(isAirAppEmbedReadableInput(["core", "nodes", "get"], input)).toBe(false);
  });

  it.each([["doc"], ["folder"], ["file"], ["base"]])(
    "still allows nodes.get for the non-file-tree type %s",
    (type) => {
      // The gate is about AirApp source, not about narrowing an embed's data
      // reads: Docs, folders, Files and Base nodes were readable before and stay
      // readable through the unified route.
      expect(isAirAppEmbedReadableInput(["nodes", "get"], { nodeId: "nod_1", type })).toBe(true);
    },
  );

  it("leaves non-file-tree procedures to the path allowlist alone", () => {
    expect(isAirAppEmbedReadableInput(["records", "list"], {})).toBe(true);
    expect(isAirAppEmbedReadableInput(["nodes", "list"], { types: ["airapp"] })).toBe(true);
  });
});
