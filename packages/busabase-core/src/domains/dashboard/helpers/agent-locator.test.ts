import { describe, expect, it } from "vitest";
import { fmt } from "../../../i18n";
import { coreMessagesEn } from "../../../i18n/messages";
import { dashboardZhCN } from "../../../i18n/zh-CN";
import {
  buildLocatorPrompt,
  buildLocatorSegments,
  LOCATOR_EXAMPLES,
  locatorExampleKind,
} from "./agent-locator";
import {
  buildCreateNodePrompts,
  buildNodeAgentPrompts,
  type NodePromptContext,
  renderCreateTargetLine,
  renderNodeLocatorTarget,
} from "./node-agent-prompts";

const SETUP_URL =
  "https://busabase.example/SETUP_SKILL.md?edition=cloud&editionConfirmed=1&space=spc_acme";
const BASE: NodePromptContext = {
  nodeType: "base",
  nodeName: "Posts",
  nodeId: "nod_posts",
  spaceId: "spc_acme",
  spaceName: "Acme",
};

const locatorFor = (
  target: string,
  messages = coreMessagesEn,
  setupUrl: string | null = SETUP_URL,
) =>
  buildLocatorPrompt({
    target,
    setupUrl: setupUrl ?? undefined,
    targetSpaceId: "spc_acme",
    leadIn: messages.agentPrompts.connectionCheckLeadIn,
    connectionCheck: messages.agentPrompts.connectionCheck,
    fmt,
  });

describe("locator prompt", () => {
  it("is the node's target line plus the connection check", () => {
    const text = locatorFor(renderNodeLocatorTarget(BASE, "en"));
    expect(text).toBe(
      `Target: the Busabase Base "Posts" (nodeId: nod_posts), in space "Acme" (spaceId: spc_acme).\n\n` +
        `Before you begin, ${fmt(coreMessagesEn.agentPrompts.connectionCheck, {
          targetSpace: " (spc_acme)",
          setupUrl: SETUP_URL,
        })}`,
    );
  });

  it("uses exactly the target line the full prompts open with, in every scope", () => {
    for (const scope of [
      undefined,
      { kind: "record", recordId: "rec_1", recordTitle: "Launch plan" } as const,
      { kind: "field", fieldName: "Owner", fieldSlug: "owner" } as const,
    ]) {
      const context = { ...BASE, scope };
      const [first] = buildNodeAgentPrompts(context, "en", coreMessagesEn).scenarios;
      expect(first?.target).toBe(renderNodeLocatorTarget(context, "en"));
    }
  });

  it("names the one record for a record scope", () => {
    const text = locatorFor(
      renderNodeLocatorTarget(
        { ...BASE, scope: { kind: "record", recordId: "rec_1", recordTitle: "Launch plan" } },
        "en",
      ),
    );
    expect(text.split("\n\n")[0]).toBe(
      'Target: the Busabase Base "Posts" (nodeId: nod_posts), in space "Acme" (spaceId: spc_acme). Work on ONE record only: "Launch plan" (recordId: rec_1). Leave every other record alone.',
    );
    expect(text).toContain("busabase skill, the Busabase MCP or busabase-cli");
  });

  it("points a create flow at the folder to create under", () => {
    const context = { parentNodeId: "nod_folder", parentName: "Projects", spaceId: "spc_acme" };
    const target = renderCreateTargetLine(context, "en");
    expect(target).toBe(buildCreateNodePrompts(context, "en").scenarios[0]?.target);
    expect(
      locatorFor(target).startsWith(
        'Target: create something new in Busabase, inside the folder "Projects" (nodeId: nod_folder)',
      ),
    ).toBe(true);
  });

  it("renders in the active locale (zh-CN)", () => {
    const text = locatorFor(renderNodeLocatorTarget(BASE, "zh-CN"), dashboardZhCN);
    expect(
      text.startsWith("目标：Busabase 的 Base「Posts」（nodeId: nod_posts），位于空间「Acme」"),
    ).toBe(true);
    expect(text).toContain("开始前，先确认当前环境能通过 busabase 技能");
    expect(text).toContain(SETUP_URL);
  });

  it("drops the connection check rather than guess a setup URL", () => {
    expect(locatorFor("Target: x.", coreMessagesEn, null)).toBe("Target: x.");
  });

  it("puts an example request between the target and the connection check", () => {
    const segments = buildLocatorSegments({
      target: "Target: x.",
      request: "Summarize what's in this table",
      setupUrl: SETUP_URL,
      leadIn: coreMessagesEn.agentPrompts.connectionCheckLeadIn,
      connectionCheck: coreMessagesEn.agentPrompts.connectionCheck,
      fmt,
    });
    expect(segments.map((segment) => segment.kind)).toEqual(["target", "task", "connection"]);
    expect(segments[1]?.text).toBe("Summarize what's in this table");
  });

  it("offers two examples per kind in every locale", () => {
    expect(locatorExampleKind("base")).toBe("base");
    expect(locatorExampleKind("base", "record")).toBe("record");
    expect(locatorExampleKind("whiteboard")).toBe("other");
    for (const byLocale of Object.values(LOCATOR_EXAMPLES)) {
      expect(Object.keys(byLocale)).toHaveLength(10);
      for (const examples of Object.values(byLocale)) {
        expect(examples).toHaveLength(2);
        for (const example of examples) expect(example.trim()).not.toBe("");
      }
    }
  });
});
