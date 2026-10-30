import { afterEach, describe, expect, it, vi } from "vitest";
import type { NodePrompt } from "./node-agent-prompts";
import type { PromptSection } from "./prompt-sections";
import {
  partitionRecentPrompts,
  pickRecentPrompts,
  pushRecentPromptKey,
  readRecentPromptKeys,
  recentPromptsStorageKey,
  writeRecentPromptKeys,
} from "./recent-prompts";

const prompt = (key: string, source: NodePrompt["source"] = "built-in-scenario"): NodePrompt => ({
  key,
  tier: source === "capability" ? "capability" : "scenario",
  source,
  label: key,
  group: "Content",
  body: key,
});

describe("recently used prompts", () => {
  it("keeps the most recent first, de-duplicated and capped at two", () => {
    expect(pushRecentPromptKey([], "a")).toEqual(["a"]);
    expect(pushRecentPromptKey(["a"], "b")).toEqual(["b", "a"]);
    expect(pushRecentPromptKey(["b", "a"], "c")).toEqual(["c", "b"]);
    expect(pushRecentPromptKey(["c", "b"], "b")).toEqual(["b", "c"]);
  });

  it("picks recent prompts in recency order and skips keys that no longer exist", () => {
    const prompts = [prompt("a"), prompt("b"), prompt("c")];
    expect(pickRecentPrompts(prompts, ["c", "gone", "a"]).map((p) => p.key)).toEqual(["c", "a"]);
  });

  it("moves recent prompts out of their sections so each prompt is listed once", () => {
    const sections: PromptSection[] = [
      { name: "Custom", source: "custom-scenario", items: [prompt("custom:x", "custom-scenario")] },
      { name: "Built-in", source: "built-in-scenario", items: [prompt("a"), prompt("b")] },
      { name: "Records", source: "capability", items: [prompt("record_create", "capability")] },
    ];
    const { recent, sections: rest } = partitionRecentPrompts(sections, ["record_create", "a"]);
    expect(recent.map((p) => p.key)).toEqual(["record_create", "a"]);
    expect(rest.map((section) => section.name)).toEqual(["Custom", "Built-in"]);
    expect(rest.flatMap((section) => section.items.map((p) => p.key))).toEqual(["custom:x", "b"]);
  });

  it("keeps the custom section (and its Add prompt slot) even when its prompts moved up", () => {
    const sections: PromptSection[] = [
      { name: "Custom", source: "custom-scenario", items: [prompt("custom:x", "custom-scenario")] },
      { name: "Built-in", source: "built-in-scenario", items: [prompt("a")] },
    ];
    const { sections: rest } = partitionRecentPrompts(sections, ["custom:x"]);
    expect(rest[0]).toMatchObject({ source: "custom-scenario", items: [] });
  });

  it("is a no-op with nothing remembered", () => {
    const sections: PromptSection[] = [
      { name: "Built-in", source: "built-in-scenario", items: [prompt("a")] },
    ];
    expect(partitionRecentPrompts(sections, [])).toEqual({ recent: [], sections });
  });

  it("keys storage by node type and scope kind, with its own key for the create flow", () => {
    expect(recentPromptsStorageKey({ kind: "node", nodeType: "base" })).toBe(
      "busabase:agent-prompts:recent:base:node",
    );
    expect(recentPromptsStorageKey({ kind: "node", nodeType: "base", scopeKind: "record" })).toBe(
      "busabase:agent-prompts:recent:base:record",
    );
    expect(recentPromptsStorageKey({ kind: "create" })).toBe(
      "busabase:agent-prompts:recent:create",
    );
  });
});

describe("recently used storage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("degrades silently when storage throws or holds garbage", () => {
    const store = new Map<string, string>([
      ["k", "{not json"],
      ["n", JSON.stringify([1, 2])],
    ]);
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
      },
    });
    expect(readRecentPromptKeys("k")).toEqual([]);
    expect(readRecentPromptKeys("n")).toEqual([]);
    expect(() => writeRecentPromptKeys("k", ["a"])).not.toThrow();
  });

  it("round-trips through storage", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
      },
    });
    writeRecentPromptKeys("k", ["b", "a", "z"]);
    expect(readRecentPromptKeys("k")).toEqual(["b", "a"]);
  });
});
