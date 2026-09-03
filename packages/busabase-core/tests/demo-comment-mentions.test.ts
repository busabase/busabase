import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { DEMO_AGENT_SLUG, resetDemoAgentSessions } from "../src/domains/agents/logic/demo-agent";
import { busabaseDemoRouter } from "../src/router-demo";

/**
 * Demo mode must not be a degraded copy of this feature.
 *
 * The OSS demo ships a scripted agent precisely so an `@` mention there starts
 * a real, watchable session rather than showing a chip that does nothing — the
 * exact failure this feature exists to end. If demo silently downgraded to
 * "chip only", the most-seen surface of the product would still be telling the
 * lie the rest of the change removes.
 */
describe("demo mode — comment @ mentions", () => {
  const client = createRouterClient(busabaseDemoRouter);

  it("validates spans in demo just like the real server", async () => {
    await expect(
      client.comments.create({
        subjectType: "change_request",
        subjectId: "crq_seed",
        body: "short",
        mentions: [{ type: "member", id: "local-editor", start: 0, end: 999 }],
      }),
    ).rejects.toThrow();
  });

  it("tags a member without inventing a session", async () => {
    resetDemoAgentSessions();
    const comment = await client.comments.create({
      subjectType: "change_request",
      subjectId: "crq_seed",
      body: "@Alice can you look?",
      mentions: [{ type: "member", id: "local-editor", start: 0, end: 6 }],
    });
    expect(comment.mentions).toHaveLength(1);
    expect(comment.mentions[0]?.dispatchStatus).toBe("not_applicable");
    expect(await client.agents.sessions.list()).toHaveLength(0);
  });

  it("really starts the scripted agent when one is mentioned", async () => {
    resetDemoAgentSessions();
    const comment = await client.comments.create({
      subjectType: "change_request",
      subjectId: "crq_seed",
      body: "@Demo Agent please double-check the benchmark line.",
      mentions: [{ type: "agent", id: DEMO_AGENT_SLUG, start: 0, end: 11 }],
    });

    const mention = comment.mentions[0];
    expect(mention?.dispatchStatus).toBe("linked");
    expect(mention?.sessionId).toBeTruthy();

    // A session the user can actually open, not a status string.
    const sessions = await client.agents.sessions.list();
    expect(sessions.map((session) => session.id)).toContain(mention?.sessionId);
  });

  it("marks an unknown agent failed instead of pretending it started", async () => {
    resetDemoAgentSessions();
    const comment = await client.comments.create({
      subjectType: "change_request",
      subjectId: "crq_seed",
      body: "@Ghost do something",
      mentions: [{ type: "agent", id: "not-a-demo-agent", start: 0, end: 6 }],
    });
    expect(comment.mentions[0]?.dispatchStatus).toBe("failed");
    expect(comment.mentions[0]?.error).toBeTruthy();
    expect(await client.agents.sessions.list()).toHaveLength(0);
  });

  it("seeds a comment thread that already shows a real agent mention chip", async () => {
    const seeded = await client.comments.list({
      subjectType: "change_request",
      subjectId: "crq_seed",
    });
    const withMention = seeded.find((comment) => comment.mentions.length > 0);
    expect(withMention).toBeDefined();
    const mention = withMention?.mentions[0];
    expect(mention?.type).toBe("agent");
    expect(mention?.targetId).toBe(DEMO_AGENT_SLUG);
    // The span must cover real text in the body, or the chip renders on the
    // wrong characters — the failure mode hand-counted offsets produce.
    expect(withMention?.body.slice(mention?.start ?? 0, mention?.end ?? 0)).toContain("@");
  });
});
