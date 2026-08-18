import { NODE_TYPES } from "busabase-contract/domains";
import { describe, expect, it } from "vitest";
import "../src/logic/builtin-node-runtimes";
import { getNodeRuntime, registeredNodeRuntimeTypes } from "../src/logic/node-runtime";

/**
 * `GET /nodes/{nodeId}` used to dispatch through a table inside
 * `logic/node-detail.ts` naming all eleven node types. That table was one of the
 * ten kernel files a new node type had to edit
 * (spec: node-type-plugin-architecture.md); each type now registers its own
 * behaviour and the kernel only looks it up.
 *
 * These tests pin the two properties that refactor must not have quietly
 * traded away.
 */
describe("node runtime registry", () => {
  it("covers every registered node type — a type cannot ship with no detail behaviour", () => {
    // The failure this prevents is silent-by-construction: an unregistered type
    // does not fail to build, it 501s the first time somebody opens one. The
    // rich-node types shipped with an empty `operations: []` for exactly this
    // reason — nobody remembered the kernel table existed.
    //
    // SCOPE, measured rather than assumed: this catches a type that registers
    // nothing ANYWHERE (verified — deleting a `registerNodeRuntime` call turns
    // this red, naming the type). It does NOT catch a type merely missing from
    // the `builtin-node-runtimes` barrel: deleting a barrel line leaves this
    // green, because other modules (`cr-lifecycle` imports rich-node's merge
    // handler, `router` imports its content handler) pull the same module in
    // transitively. Barrel completeness is not observable in-process; the barrel
    // earns its keep by giving consumers ONE thing to import, not by being
    // testable here.
    const missing = NODE_TYPES.filter((type) => {
      const runtime = getNodeRuntime(type);
      return !runtime?.hydrateDetail && !runtime?.genericDetail;
    });
    expect(missing).toEqual([]);
  });

  it("routes each type to the behaviour its own domain registered", () => {
    // Types whose detail is a richer shape than the bare node row must have a
    // real hydrator, not the generic fallback. If a future refactor made
    // `genericDetail` the implicit default, this is what would catch it: these
    // would silently satisfy the coverage test above while returning a VO
    // missing `body` / `document` / `files`.
    for (const type of ["doc", "file", "skill", "drive", "airapp", "folder"] as const) {
      expect(getNodeRuntime(type)?.hydrateDetail, `${type} must hydrate`).toBeTypeOf("function");
    }
    for (const type of ["whiteboard", "workflow", "html"] as const) {
      expect(getNodeRuntime(type)?.hydrateDetail, `${type} must hydrate`).toBeTypeOf("function");
    }
    // …and the two whose detail genuinely IS the node row opt in explicitly.
    for (const type of ["base", "form"] as const) {
      expect(getNodeRuntime(type)?.genericDetail, `${type} opts into generic`).toBe(true);
      expect(getNodeRuntime(type)?.hydrateDetail).toBeUndefined();
    }
  });

  it("fails closed for a type nobody registered", () => {
    // The property the replaced table documented: an unknown type throws rather
    // than returning a partial or mis-discriminated VO. Registering nothing must
    // not silently mean "generic is fine".
    expect(getNodeRuntime("definitely-not-a-registered-type")).toBeUndefined();
  });

  it("registers no behaviour for a type the contract does not declare", () => {
    // Guards the other direction: a stale registration left behind after a type
    // is removed would make the kernel serve a type the contract cannot describe,
    // and `nodes.get`'s output validation would fail at runtime instead.
    const declared = new Set<string>(NODE_TYPES);
    expect(registeredNodeRuntimeTypes().filter((type) => !declared.has(type))).toEqual([]);
  });
});
