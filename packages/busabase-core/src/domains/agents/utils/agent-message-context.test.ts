/**
 * The rule the side panel's context chip promises: "your message will say which
 * node you mean". What it must NOT do is edit what the person wrote.
 */
import { describe, expect, it } from "vitest";
import type { LoadedNode } from "../../dashboard/node-detail-registry";
import { withNodeContext } from "./agent-message-context";

const node: LoadedNode = { id: "nod_visits", type: "base", name: "Visits", slug: "visits" };

describe("sending with the open node as context", () => {
  it("names the node above the message, leaving the message itself untouched", () => {
    const out = withNodeContext("add a row for today", node, "en", "spc_acme");

    const [target, blank, ...rest] = out.split("\n");
    expect(target).toContain('the Busabase Base "Visits"');
    expect(target).toContain("nod_visits");
    expect(target).toContain("spc_acme");
    // A blank line between, so the agent reads two statements rather than one
    // run-on — the same shape the built-in prompts use.
    expect(blank).toBe("");
    expect(rest.join("\n")).toBe("add a row for today");
  });

  it("changes nothing at all when there is no node — the dismissed and the Home cases", () => {
    expect(withNodeContext("hello", null, "en")).toBe("hello");
    expect(withNodeContext("hello", undefined, "en")).toBe("hello");
  });

  it("speaks the user's language, because they will read it back in the transcript", () => {
    const zh = withNodeContext("加一行", node, "zh-CN");
    expect(zh).toContain("目标：Busabase");
    expect(zh).toContain("「Visits」");
    expect(zh.endsWith("加一行")).toBe(true);
  });

  it("still names the node when no space is known, rather than dropping the line", () => {
    const out = withNodeContext("hi", node, "en");
    expect(out).toContain("nod_visits");
    expect(out).not.toContain("in space");
  });
});
