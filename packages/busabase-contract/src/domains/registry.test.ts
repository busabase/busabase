import { describe, expect, it } from "vitest";
import { isPubliclyReadableNodeType, listNodeTypes, publicAccessOf } from "./registry";

describe("node public sharing capabilities", () => {
  it("requires every built-in node type to declare its public behavior", () => {
    expect(
      listNodeTypes()
        .filter((definition) => definition.capabilities.publicAccess === undefined)
        .map((definition) => definition.type),
    ).toEqual([]);
  });

  it("explicitly covers every built-in node type", () => {
    expect(
      Object.fromEntries(
        listNodeTypes().map((definition) => [definition.type, publicAccessOf(definition.type)]),
      ),
    ).toEqual({
      folder: "detail",
      base: "detail",
      skill: "no",
      drive: "no",
      airapp: "runtime",
      file: "detail",
      doc: "detail",
      form: "submit",
      whiteboard: "detail",
      workflow: "detail",
      html: "no",
    });
  });

  it("fails closed for an unknown plugin type", () => {
    expect(publicAccessOf("brand-new-plugin-type")).toBe("no");
    expect(isPubliclyReadableNodeType("brand-new-plugin-type")).toBe(false);
  });

  // Was "keeps AirApp closed until its isolated public runtime is available"
  // — a deliberate guard added by PR #6751 (2026-08-28) back when a public
  // AirApp link resolved through the generic `AirAppDetailView`, whose
  // anonymous `nodes.get` correctly refuses type `airapp`, producing a dead
  // link. #6648 (2026-09-04) built the isolated runtime this test's own name
  // was waiting for (`resolvePublicAirAppRuntime`, `PublicAirAppView`, the
  // data bridge) but never came back to update `publicAccess` or this test,
  // so the flag — and this assertion — stayed frozen at "no" for three weeks
  // after the thing it was gating became available.
  //
  // Rewritten, not deleted: deleting it would drop coverage for exactly the
  // failure mode #6751's review caught. It now guards BOTH halves of the
  // real invariant instead — verified against the live runtime in
  // the Busabase Cloud app's public-airapp-share e2e spec, not just
  // asserted here:
  //   1. `publicAccessOf("airapp")` is `"runtime"` — a public AirApp link
  //      resolves through the relay (`resolvePublicView()` in the dashboard
  //      page → `resolvePublicAirAppRuntime` → `PublicAirAppView`), not
  //      through the generic detail path.
  //   2. `isPubliclyReadableNodeType("airapp")` stays `false` regardless —
  //      "runtime" is deliberately NOT "detail"/"submit", so the anonymous
  //      `nodes.get({ type: "airapp" })` path must keep refusing it. This is
  //      the property that actually prevents AirApp source from leaking
  //      through the generic read path; it does not change with this fix,
  //      and reintroducing "no" is not the only way to break it — treating
  //      "runtime" as publicly readable here would too.
  it("resolves AirApp through the isolated runtime relay, never through the generic anonymous read path", () => {
    expect(publicAccessOf("airapp")).toBe("runtime");
    expect(isPubliclyReadableNodeType("airapp")).toBe(false);
  });
});
