import type { NodeVO } from "busabase-contract/types";
import { describe, expect, it } from "vitest";
import {
  buildPermissionNodeIndex,
  findInheritedPrivateNode,
  resolveNodePermissionAccess,
  toMutablePrincipalType,
} from "./node-permissions";

const node = (
  id: string,
  options: {
    children?: NodeVO[];
    explicitVisibility?: NodeVO["explicitVisibility"];
    name?: string;
    parentId?: string | null;
  } = {},
): NodeVO =>
  ({
    id,
    parentId: options.parentId ?? null,
    name: options.name ?? id,
    explicitVisibility: options.explicitVisibility ?? null,
    children: options.children ?? [],
  }) as NodeVO;

describe("node permission access", () => {
  const leaf = node("leaf", { parentId: "middle" });
  const middle = node("middle", {
    parentId: "root",
    explicitVisibility: "workspace",
    children: [leaf],
  });
  const tree = [
    node("root", {
      name: "Private root",
      explicitVisibility: "private",
      children: [middle],
    }),
  ];

  it("flattens descendants and finds the nearest explicit private ancestor", () => {
    const index = buildPermissionNodeIndex(tree);
    expect([...index.keys()]).toEqual(["root", "middle", "leaf"]);
    expect(findInheritedPrivateNode("leaf", index)?.name).toBe("Private root");
    expect(findInheritedPrivateNode("root", index)).toBeUndefined();
  });

  it("keeps inherited privacy effective despite a child's workspace override", () => {
    expect(
      resolveNodePermissionAccess({
        node: middle,
        nodes: tree,
        visibilityOverride: undefined,
      }),
    ).toMatchObject({
      storedVisibility: "workspace",
      explicitVisibility: "workspace",
      inheritedPrivateFrom: "Private root",
      isPrivate: false,
      isInherited: true,
      isLimited: true,
    });
  });

  it("distinguishes local private, restricted-space, and open inherited access", () => {
    expect(
      resolveNodePermissionAccess({
        node: leaf,
        nodes: tree,
        visibilityOverride: "private",
      }),
    ).toMatchObject({ isPrivate: true, isInherited: false, isLimited: true });

    const openNode = node("open");
    expect(
      resolveNodePermissionAccess({
        node: openNode,
        nodes: [openNode],
        spaceVisibilityMode: "restricted",
        visibilityOverride: undefined,
      }),
    ).toMatchObject({
      isPrivate: false,
      isInherited: false,
      isRestrictedSpace: true,
      isLimited: true,
    });
    expect(
      resolveNodePermissionAccess({
        node: openNode,
        nodes: [openNode],
        spaceVisibilityMode: "open",
        visibilityOverride: undefined,
      }).isLimited,
    ).toBe(false);
  });

  it("uses null as an optimistic inherit override instead of the stored private value", () => {
    const privateNode = node("private", { explicitVisibility: "private" });
    expect(
      resolveNodePermissionAccess({
        node: privateNode,
        nodes: [privateNode],
        visibilityOverride: null,
      }),
    ).toMatchObject({
      storedVisibility: "private",
      explicitVisibility: null,
      isPrivate: false,
      isLimited: false,
    });
  });

  it("narrows legacy team grants to the mutable user endpoint shape", () => {
    expect(toMutablePrincipalType("team")).toBe("user");
    expect(toMutablePrincipalType("user")).toBe("user");
    expect(toMutablePrincipalType("space")).toBe("space");
  });
});
