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
      airapp: "no",
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

  it("keeps AirApp closed until its isolated public runtime is available", () => {
    expect(publicAccessOf("airapp")).toBe("no");
    expect(isPubliclyReadableNodeType("airapp")).toBe(false);
  });
});
