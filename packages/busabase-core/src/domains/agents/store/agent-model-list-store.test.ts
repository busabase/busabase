// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  agentModelCatalogScope,
  toAgentModelCatalogEntry,
  useAgentModelListStore,
} from "./agent-model-list-store";

const key = "busabase-agents-model-list.v1";
const scope = agentModelCatalogScope("https://host", "space", "actor", "buda");
const entry = {
  configId: "model",
  name: "Model",
  options: [{ value: "auto", name: "Auto" }],
  updatedAt: "2026-10-08T00:00:00.000Z",
};

beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  useAgentModelListStore.setState({ catalogs: {}, catalogsHydrated: false });
});

describe("Agent model list persistence", () => {
  it("hydrates the catalog from storage without reviving a session selection", async () => {
    window.localStorage.setItem(
      key,
      JSON.stringify({
        state: { catalogs: { [scope]: { ...entry, currentValue: "old-session-choice" } } },
        version: 0,
      }),
    );
    await useAgentModelListStore.persist.rehydrate();
    expect(useAgentModelListStore.getState().getCatalog(scope)).toEqual(entry);
    expect(useAgentModelListStore.getState().catalogsHydrated).toBe(true);
  });

  it("persists updates for the next page load", () => {
    useAgentModelListStore.getState().setCatalog(scope, entry);
    const saved = JSON.parse(window.localStorage.getItem(key) ?? "{}");
    expect(saved.state.catalogs[scope]).toEqual(entry);
  });

  it("rehydrates per-model thinking defaults without reviving the previous session's model selection", async () => {
    const thinking = {
      id: "effort",
      name: "Thinking",
      currentValue: "medium",
      options: [
        { value: "medium", name: "Medium" },
        { value: "high", name: "High" },
      ],
    };
    const model = {
      id: "model",
      name: "Model",
      currentValue: "reasoner",
      options: [{ value: "reasoner", name: "Reasoner", thinking }],
    };
    const catalog = toAgentModelCatalogEntry(model, entry.updatedAt);
    useAgentModelListStore.getState().setCatalog(scope, catalog);
    const saved = window.localStorage.getItem(key);
    expect(saved).not.toBeNull();
    useAgentModelListStore.setState({ catalogs: {} });
    window.localStorage.setItem(key, saved ?? "");
    await useAgentModelListStore.persist.rehydrate();
    expect(useAgentModelListStore.getState().getCatalog(scope)).toEqual(catalog);
    expect(useAgentModelListStore.getState().getCatalog(scope)).not.toHaveProperty("currentValue");
    expect(catalog.options[0]?.thinking?.currentValue).toBe("medium");
  });

  it.each([
    { id: "effort", name: "Thinking", currentValue: true, options: [] },
    {
      id: "effort",
      name: "Thinking",
      currentValue: "missing",
      options: [{ value: "high", name: "High" }],
    },
  ])("drops malformed thinking metadata without discarding the model catalog", async (thinking) => {
    window.localStorage.setItem(
      key,
      JSON.stringify({
        state: {
          catalogs: { [scope]: { ...entry, options: [{ ...entry.options[0], thinking }] } },
        },
        version: 0,
      }),
    );
    await useAgentModelListStore.persist.rehydrate();
    expect(useAgentModelListStore.getState().getCatalog(scope)).toEqual(entry);
  });

  it("isolates host, workspace, actor and Agent, including separator characters", () => {
    useAgentModelListStore.getState().setCatalog(scope, entry);
    for (const other of [
      agentModelCatalogScope("https://other", "space", "actor", "buda"),
      agentModelCatalogScope("https://host", "other", "actor", "buda"),
      agentModelCatalogScope("https://host", "space", "other", "buda"),
      agentModelCatalogScope("https://host", "space", "actor", "other"),
    ])
      expect(useAgentModelListStore.getState().getCatalog(other)).toBeUndefined();
    expect(agentModelCatalogScope("h", "a:b", "c", "d")).not.toBe(
      agentModelCatalogScope("h", "a", "b:c", "d"),
    );
  });

  it("treats malformed storage as an empty hydrated cache", async () => {
    window.localStorage.setItem(key, "not-json");
    await useAgentModelListStore.persist.rehydrate();
    expect(useAgentModelListStore.getState().catalogs).toEqual({});
    expect(useAgentModelListStore.getState().catalogsHydrated).toBe(true);
  });

  it("keeps an in-memory confirmation over an older persisted snapshot", async () => {
    useAgentModelListStore.getState().setCatalog(scope, entry);
    window.localStorage.setItem(
      key,
      JSON.stringify({ state: { catalogs: { [scope]: { ...entry, name: "Stale" } } }, version: 0 }),
    );
    await useAgentModelListStore.persist.rehydrate();
    expect(useAgentModelListStore.getState().getCatalog(scope)).toEqual(entry);
  });

  it("keeps unsupported distinct from unknown and does not deduplicate changed options by timestamp", () => {
    useAgentModelListStore.getState().setCatalog(scope, entry);
    useAgentModelListStore.getState().setCatalog(scope, { ...entry, options: [] });
    expect(useAgentModelListStore.getState().getCatalog(scope)).toEqual({ ...entry, options: [] });
    const unsupported = { configId: null, updatedAt: entry.updatedAt };
    useAgentModelListStore.getState().setCatalog(scope, unsupported);
    expect(useAgentModelListStore.getState().getCatalog(scope)).toEqual(unsupported);
    expect(useAgentModelListStore.getState().getCatalog("unknown")).toBeUndefined();
  });
});
