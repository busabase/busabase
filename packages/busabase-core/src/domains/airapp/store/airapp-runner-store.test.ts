import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJSONStorage, type StateStorage } from "zustand/middleware";
import { createAirAppRunnerSelectionStorage, useAirAppRunnerStore } from "./airapp-runner-store";

const values = new Map<string, string>();
const memoryStorage: StateStorage = {
  getItem: (name) => values.get(name) ?? null,
  setItem: (name, value) => values.set(name, value),
  removeItem: (name) => values.delete(name),
};

const originalStorage = useAirAppRunnerStore.persist.getOptions().storage;

beforeEach(() => {
  useAirAppRunnerStore.persist.setOptions({ storage: createJSONStorage(() => memoryStorage) });
  useAirAppRunnerStore.setState({ entries: {}, lastEffectiveKinds: {}, selectionsHydrated: false });
  values.clear();
});

afterEach(() => {
  useAirAppRunnerStore.setState({ entries: {}, lastEffectiveKinds: {}, selectionsHydrated: false });
  values.clear();
  useAirAppRunnerStore.persist.setOptions({ storage: originalStorage });
  vi.unstubAllGlobals();
});

describe("AirApp runner cost memory", () => {
  it("restores what each node last cost, so a reload does not re-provision on sight", async () => {
    useAirAppRunnerStore.getState().recordEffectiveRunnerKind("node-pinned", "remote");

    const [[storageKey, snapshot]] = [...values.entries()];
    // Only "what happened" is persisted. "What was asked for" lives on the node
    // (`settings.airappEngine`) so it reaches every browser, not just this one.
    expect(JSON.parse(snapshot ?? "null").state).toEqual({
      lastEffectiveKinds: { "node-pinned": "remote" },
    });

    useAirAppRunnerStore.setState({ lastEffectiveKinds: {} });
    if (snapshot) values.set(storageKey ?? "", snapshot);
    await useAirAppRunnerStore.persist.rehydrate();

    // The debounce still knows this node provisions a machine.
    expect(useAirAppRunnerStore.getState().getEffectiveRunnerKind("node-pinned")).toBe("remote");
  });

  it("assumes the cheapest engine for a node that has never run", () => {
    expect(useAirAppRunnerStore.getState().getEffectiveRunnerKind("node-never-run")).toBe(
      "browser",
    );
  });

  /**
   * The engine choice used to live here, per browser, which is why a person who
   * set an engine on one machine did not have it on another. It now lives on the
   * node. This asserts the store never becomes that second home again: a run
   * records what it did and nothing else, so there is no slot for a preference
   * to be silently written back into.
   */
  it("persists no engine preference of its own", () => {
    useAirAppRunnerStore.getState().recordEffectiveRunnerKind("node-1", "remote");

    const [[, snapshot]] = [...values.entries()];
    expect(Object.keys(JSON.parse(snapshot ?? "null").state)).toEqual(["lastEffectiveKinds"]);
  });

  it("ignores a pre-move selection left behind in the same storage key", async () => {
    // One real write first, so the test uses the store's own storage key rather
    // than a copy of it that could drift.
    useAirAppRunnerStore.getState().recordEffectiveRunnerKind("seed", "browser");
    const [storageKey] = values.keys();
    useAirAppRunnerStore.setState({ lastEffectiveKinds: {} });
    values.set(
      storageKey ?? "",
      JSON.stringify({
        state: {
          // Written by a build from before the choice moved onto the node.
          selectedKinds: { "node-a": "remote" },
          lastEffectiveKinds: { "node-b": "remote" },
        },
        version: 0,
      }),
    );
    await useAirAppRunnerStore.persist.rehydrate();

    // Not merely `undefined` — the key must not be revived onto the store at
    // all, which is what a `merge` that still copied it through would do.
    expect(Object.hasOwn(useAirAppRunnerStore.getState(), "selectedKinds")).toBe(false);
    // The half that is still meaningful is still read.
    expect(useAirAppRunnerStore.getState().getEffectiveRunnerKind("node-b")).toBe("remote");
  });

  it("ignores corrupt JSON and filters unknown persisted engine values", async () => {
    useAirAppRunnerStore.getState().recordEffectiveRunnerKind("known", "remote");
    const [storageKey] = values.keys();

    useAirAppRunnerStore.setState({ lastEffectiveKinds: {} });
    values.set(storageKey ?? "", "not-json");
    await useAirAppRunnerStore.persist.rehydrate();
    expect(useAirAppRunnerStore.getState().getEffectiveRunnerKind("known")).toBe("browser");
    expect(useAirAppRunnerStore.getState().selectionsHydrated).toBe(true);

    values.set(
      storageKey ?? "",
      JSON.stringify({
        state: {
          lastEffectiveKinds: {
            browserLegacy: "nodepod",
            remoteLegacy: "sandock",
            localLegacy: "local-node",
            current: "remote",
            removed: "srt",
            invalid: "remote-root",
          },
        },
        version: 0,
      }),
    );
    await useAirAppRunnerStore.persist.rehydrate();

    expect(useAirAppRunnerStore.getState().lastEffectiveKinds).toEqual({
      browserLegacy: "browser",
      remoteLegacy: "remote",
      localLegacy: "local",
      current: "remote",
    });
  });

  it("keeps the picker usable when browser storage is corrupt or inaccessible", () => {
    const getItem = vi.fn<(name: string) => string | null>(() => {
      throw new Error("storage blocked");
    });
    const localStorage = {
      getItem,
      setItem: vi.fn(() => {
        throw new Error("storage blocked");
      }),
      removeItem: vi.fn(() => {
        throw new Error("storage blocked");
      }),
    };
    vi.stubGlobal("window", { localStorage });
    const blockedStorage = createAirAppRunnerSelectionStorage();

    expect(blockedStorage.getItem("selection")).toBeNull();
    expect(() => blockedStorage.setItem("selection", "value")).not.toThrow();
    expect(() => blockedStorage.removeItem("selection")).not.toThrow();

    getItem.mockImplementation(() => "not-json");
    expect(blockedStorage.getItem("selection")).toBeNull();
  });
});
