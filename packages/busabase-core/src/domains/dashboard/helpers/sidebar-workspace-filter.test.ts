import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isWorkspaceFilterKey,
  nodeTypesForWorkspaceFilter,
  readStoredWorkspaceFilter,
  WORKSPACE_FILTERS,
  writeStoredWorkspaceFilter,
} from "./sidebar-workspace-filter";

/**
 * The tests run under vitest's `node` environment, so there is no `window` at
 * all by default — which is itself one of the cases the helper has to survive
 * (SSR). Each test that needs storage installs its own fake, so nothing leaks
 * between them.
 */
const stubSessionStorage = (storage: Partial<Storage>): void => {
  vi.stubGlobal("window", { sessionStorage: storage });
};

const inMemorySessionStorage = (): Partial<Storage> => {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("nodeTypesForWorkspaceFilter", () => {
  it("maps the two type filters onto their `nodes.list({ types })` argument", () => {
    expect(nodeTypesForWorkspaceFilter("airapp")).toEqual(["airapp"]);
    expect(nodeTypesForWorkspaceFilter("skill")).toEqual(["skill"]);
  });

  // `null` must mean "do not fetch THIS way" — a caller reading it as "no type
  // narrowing" would fire a full untyped `nodes.list` behind the tree, and a
  // caller reading it as "nothing to fetch" would leave `shared` empty forever
  // (it has its own endpoint, `nodes.share.list`).
  it("returns null for every filter that is not a `nodes.list({ types })` query", () => {
    expect(nodeTypesForWorkspaceFilter("workspace")).toBeNull();
    expect(nodeTypesForWorkspaceFilter("recent")).toBeNull();
    expect(nodeTypesForWorkspaceFilter("shared")).toBeNull();
  });
});

describe("WORKSPACE_FILTERS", () => {
  // The order IS the menu. `workspace` first (default + way back), then the
  // two "which slice of my stuff" options, then the two object classes.
  it("lists the menu in its rendered order", () => {
    expect(WORKSPACE_FILTERS).toEqual(["workspace", "recent", "shared", "airapp", "skill"]);
  });
});

describe("isWorkspaceFilterKey", () => {
  it("accepts every key the menu renders", () => {
    for (const key of WORKSPACE_FILTERS) expect(isWorkspaceFilterKey(key)).toBe(true);
  });

  it("accepts the shared filter, which is neither a node type nor a cache read", () => {
    expect(isWorkspaceFilterKey("shared")).toBe(true);
  });

  it("rejects anything else, including a retired-looking node type", () => {
    expect(isWorkspaceFilterKey("doc")).toBe(false);
    expect(isWorkspaceFilterKey(null)).toBe(false);
    expect(isWorkspaceFilterKey(undefined)).toBe(false);
    expect(isWorkspaceFilterKey(3)).toBe(false);
  });
});

describe("sidebar workspace filter persistence", () => {
  it("defaults to the workspace tree when nothing has been stored", () => {
    stubSessionStorage(inMemorySessionStorage());

    expect(readStoredWorkspaceFilter()).toBe("workspace");
  });

  it("round-trips a written filter", () => {
    stubSessionStorage(inMemorySessionStorage());

    writeStoredWorkspaceFilter("skill");

    expect(readStoredWorkspaceFilter()).toBe("skill");
  });

  it("round-trips the shared filter too", () => {
    stubSessionStorage(inMemorySessionStorage());

    writeStoredWorkspaceFilter("shared");

    expect(readStoredWorkspaceFilter()).toBe("shared");
  });

  // A value left by an older build (or hand-edited) must not select a mode the
  // UI has no menu entry for — that would show an empty group with no way back.
  it("falls back to the workspace tree for a corrupt or unknown stored value", () => {
    stubSessionStorage({
      getItem: () => "favourites-v0",
      setItem: () => undefined,
    });

    expect(readStoredWorkspaceFilter()).toBe("workspace");
  });

  it("degrades to the workspace tree when storage throws instead of propagating", () => {
    stubSessionStorage({
      getItem: () => {
        throw new Error("storage disabled");
      },
      setItem: () => {
        throw new Error("storage disabled");
      },
    });

    expect(readStoredWorkspaceFilter()).toBe("workspace");
    expect(() => writeStoredWorkspaceFilter("airapp")).not.toThrow();
  });

  // SSR: the module is imported by a component that server-renders, where
  // `window` does not exist at all.
  it("degrades to the workspace tree when there is no window at all", () => {
    expect(readStoredWorkspaceFilter()).toBe("workspace");
    expect(() => writeStoredWorkspaceFilter("recent")).not.toThrow();
  });
});
