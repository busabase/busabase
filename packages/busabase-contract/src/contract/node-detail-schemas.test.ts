import { describe, expect, it } from "vitest";
import { NODE_TYPES } from "../domains/registry";
import { busabaseContractRoutes } from "./busabase";
import {
  getNodeInputSchema,
  NODE_DETAIL_VARIANTS,
  NodeDetailVOSchema,
} from "./node-detail-schemas";

/**
 * `nodes.get` answers for EVERY node type, so its output union has to stay in
 * lockstep with the node-type registry. A missing variant is not a cosmetic gap:
 * the server dispatch fails closed on an unknown type, so the user-visible
 * result would be "this node cannot be opened at all".
 *
 * `satisfies Record<NodeType, unknown>` already catches this at compile time;
 * these assertions catch the runtime half (a variant whose discriminator
 * literal does not match the key it is filed under).
 */
describe("NodeDetailVO", () => {
  it("covers every registered node type exactly once", () => {
    const optionTypes = NodeDetailVOSchema.options.map(
      (option) => (option.shape.type as { value: string }).value,
    );
    expect(optionTypes.slice().sort()).toEqual([...NODE_TYPES].sort());
    expect(new Set(optionTypes).size).toBe(optionTypes.length);
  });

  it("files each variant under its own discriminator", () => {
    for (const [key, variant] of Object.entries(NODE_DETAIL_VARIANTS)) {
      expect((variant.shape.type as { value: string }).value).toBe(key);
    }
  });

  it("keeps each retired get's payload shape, just with a type added", () => {
    // A caller that already read `.body` / `.asset` / `.children` / `.files`
    // keeps working after narrowing on `type` — that is what makes this a
    // consolidation rather than a rewrite.
    expect(Object.keys(NODE_DETAIL_VARIANTS.folder.shape).sort()).toEqual([
      "children",
      "node",
      "type",
    ]);
    expect(Object.keys(NODE_DETAIL_VARIANTS.doc.shape).sort()).toEqual([
      "body",
      "node",
      "storagePrefix",
      "type",
    ]);
    expect(Object.keys(NODE_DETAIL_VARIANTS.file.shape).sort()).toEqual(["asset", "node", "type"]);
    for (const type of ["skill", "drive", "airapp"] as const) {
      expect(Object.keys(NODE_DETAIL_VARIANTS[type].shape).sort()).toEqual([
        "entryFile",
        "files",
        "node",
        "skippedGitignorePaths",
        "type",
        "version",
        "visibility",
      ]);
    }
  });

  it("gives the not-yet-typed node types the plain node row", () => {
    for (const type of ["base", "form"] as const) {
      expect(Object.keys(NODE_DETAIL_VARIANTS[type].shape).sort()).toEqual(["node", "type"]);
    }
  });

  it("gives whiteboard/workflow/html their storage-backed document", () => {
    // Content moved out of `node.metadata` into object storage (spec D2), so
    // the detail response carries it explicitly instead of leaving it to a
    // bare `{ node }` the client has no way to read.
    for (const type of ["whiteboard", "workflow", "html"] as const) {
      expect(Object.keys(NODE_DETAIL_VARIANTS[type].shape).sort()).toEqual([
        "document",
        "node",
        "type",
      ]);
    }
  });

  it("parses and discriminates a folder detail", () => {
    const parsed = NodeDetailVOSchema.parse({
      type: "folder",
      node: {
        id: "nod_1",
        parentId: null,
        type: "folder",
        slug: "docs",
        name: "Docs",
        description: "",
        metadata: {},
        position: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        baseId: null,
        children: [],
      },
      children: [],
    });
    expect(parsed.type).toBe("folder");
  });

  it("rejects a payload whose type is not a registered node type", () => {
    expect(() => NodeDetailVOSchema.parse({ type: "not-a-node-type", node: {} })).toThrow();
  });
});

describe("nodes.get input", () => {
  it("takes an id-or-slug plus an optional type hint", () => {
    expect(getNodeInputSchema.parse({ nodeId: "nod_1" })).toEqual({ nodeId: "nod_1" });
    expect(getNodeInputSchema.parse({ nodeId: "my-skill", type: "skill" })).toEqual({
      nodeId: "my-skill",
      type: "skill",
    });
  });

  it("rejects a type that is not a node type", () => {
    expect(() => getNodeInputSchema.parse({ nodeId: "x", type: "file-tree" })).toThrow();
  });
});

describe("retired node list/get routes", () => {
  // The contract's real type is a deep tree of oRPC builder types, so the
  // structural check below needs an `unknown` hop rather than a direct cast.
  const routes = busabaseContractRoutes as unknown as Record<string, Record<string, unknown>>;

  it("no longer exposes the four typed get/list pairs", () => {
    expect(routes.folders).toBeUndefined();
    expect(routes.docs?.get).toBeUndefined();
    expect(routes.docs?.list).toBeUndefined();
    expect(routes.files?.get).toBeUndefined();
    expect(routes.files?.list).toBeUndefined();
    expect(routes.fileTrees?.get).toBeUndefined();
    expect(routes.fileTrees?.list).toBeUndefined();
  });

  it("keeps the type-specific operations that are NOT node-narrowing", () => {
    // Consolidation removed the type-discovery step, not the domain surface.
    expect(routes.nodes?.readLines).toBeDefined();
    expect(routes.fileTrees?.listFiles).toBeDefined();
    expect(routes.fileTrees?.readFile).toBeDefined();
  });

  it("moved Doc's write routes (and whiteboard/workflow/html's, for the first time) into one unified content write", () => {
    // `updateBody` / `createChangeRequest` are gone from `docs`; both write
    // paths — plus whiteboard/workflow/html, which never had a reviewed write
    // at all — now go through `nodes.updateContent`.
    const nodesRoutes = routes.nodes as unknown as Record<string, unknown>;
    expect(routes.docs?.updateBody).toBeUndefined();
    expect(routes.docs?.createChangeRequest).toBeUndefined();
    expect(nodesRoutes?.updateContent).toBeDefined();
  });
});
