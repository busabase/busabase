import type { AgentSessionEventVO } from "busabase-contract/domains/agents/types";
import { afterEach, describe, expect, it } from "vitest";
import { runWithBusabaseContext } from "../../../context";
import {
  cancelDemoAgentSession,
  closeDemoAgentSession,
  createDemoAgentSession,
  DEMO_AGENT_SLUG,
  demoAgentCatalogEntry,
  listDemoAgentSessions,
  promptDemoAgentSession,
  resetDemoAgentSessions,
  respondToDemoAgentPermission,
  subscribeDemoAgentSession,
} from "./demo-agent";

afterEach(resetDemoAgentSessions);

/** Drain the stream until `stop` says we've seen enough, then abort it. */
const collect = async (
  sessionId: string,
  stop: (events: AgentSessionEventVO[]) => boolean,
  timeoutMs = 5000,
): Promise<AgentSessionEventVO[]> => {
  const controller = new AbortController();
  const events: AgentSessionEventVO[] = [];
  const deadline = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for await (const event of subscribeDemoAgentSession(sessionId, -1, controller.signal)) {
      events.push(event);
      if (stop(events)) break;
    }
  } finally {
    clearTimeout(deadline);
    controller.abort();
  }
  return events;
};

const updates = (events: AgentSessionEventVO[]) =>
  events
    .filter((event) => event.kind === "acpUpdate")
    .map((event) => event.acpUpdate as Record<string, unknown>);

const textOf = (events: AgentSessionEventVO[], tag: string) =>
  updates(events)
    .filter((update) => update.sessionUpdate === tag)
    .map((update) => (update.content as { text?: string } | undefined)?.text ?? "")
    .join("");

describe("the demo catalog entry", () => {
  it("is available, and is honest about being a demo", () => {
    const entry = demoAgentCatalogEntry("en");

    expect(entry.available).toBe(true);
    expect(entry.slug).toBe(DEMO_AGENT_SLUG);
    // It must never read as one of the real agents — the point of adding it is
    // to demo the feature, not to imply Claude Code runs in the demo.
    expect(entry.name).not.toMatch(/Claude|Codex/i);
    expect(entry.name.toLowerCase()).toContain("demo");
  });

  it("speaks the demo's own language", () => {
    expect(demoAgentCatalogEntry("zh-CN").name).toContain("演示");
  });
});

describe("sessions", () => {
  it("creates a session and lists it — the thing the old demo refused to do", () => {
    const created = createDemoAgentSession(DEMO_AGENT_SLUG);

    expect(created.slug).toBe(DEMO_AGENT_SLUG);
    expect(listDemoAgentSessions().map((session) => session.id)).toEqual([created.id]);
  });

  it("still refuses a slug the demo has no fake for", () => {
    expect(() => createDemoAgentSession("claude-acp")).toThrow(/cannot be launched/i);
  });
});

describe("the scripted turn", () => {
  it("streams the reply in chunks, not one blob, through real acpUpdate shapes", async () => {
    const session = createDemoAgentSession(DEMO_AGENT_SLUG);
    promptDemoAgentSession(session.id, "What would you change here?");

    const events = await collect(session.id, (seen) =>
      seen.some((event) => event.kind === "permissionRequest"),
    );

    const chunks = updates(events).filter(
      (update) => update.sessionUpdate === "agent_message_chunk",
    );
    expect(chunks.length).toBeGreaterThan(1);
    // A tool call, announced then completed — the same pair a real agent emits.
    expect(updates(events).some((update) => update.sessionUpdate === "tool_call")).toBe(true);
    expect(updates(events).some((update) => update.sessionUpdate === "tool_call_update")).toBe(
      true,
    );
    // The user's own prompt is echoed back, so a late subscriber sees the turn.
    expect(
      updates(events).some(
        (update) =>
          update.sessionUpdate === "user_message" && update.text === "What would you change here?",
      ),
    ).toBe(true);
  });

  it("stops on an answerable permission card and waits", async () => {
    const session = createDemoAgentSession(DEMO_AGENT_SLUG);
    promptDemoAgentSession(session.id, "Tidy this up");

    const events = await collect(session.id, (seen) =>
      seen.some((event) => event.kind === "permissionRequest"),
    );

    const request = events.find((event) => event.kind === "permissionRequest")?.permissionRequest;
    expect(request?.options.map((option) => option.optionId)).toEqual(["allow", "reject"]);
    expect(listDemoAgentSessions()[0]?.status).toBe("waiting_permission");
  });

  it("continues the conversation once the visitor answers", async () => {
    const session = createDemoAgentSession(DEMO_AGENT_SLUG);
    promptDemoAgentSession(session.id, "Tidy this up");

    const upToCard = await collect(session.id, (seen) =>
      seen.some((event) => event.kind === "permissionRequest"),
    );
    const requestId = upToCard.find((event) => event.kind === "permissionRequest")
      ?.permissionRequest?.requestId as string;

    respondToDemoAgentPermission(session.id, requestId, "allow");

    const all = await collect(session.id, (seen) =>
      seen.some((event) => event.kind === "status" && event.status === "idle"),
    );
    expect(all.some((event) => event.kind === "permissionResolved")).toBe(true);
    const reply = textOf(all, "agent_message_chunk");
    expect(reply).toContain("Submitted");
  });

  // The demo store is in-memory, so nothing persists either way. The transcript
  // still must not CLAIM otherwise — "proposal awaiting review" is both true
  // and the better story.
  it("only ever claims to have proposed, never to have written", async () => {
    const session = createDemoAgentSession(DEMO_AGENT_SLUG);
    promptDemoAgentSession(session.id, "Tidy this up");
    const upToCard = await collect(session.id, (seen) =>
      seen.some((event) => event.kind === "permissionRequest"),
    );
    const requestId = upToCard.find((event) => event.kind === "permissionRequest")
      ?.permissionRequest?.requestId as string;
    respondToDemoAgentPermission(session.id, requestId, "allow");

    const all = await collect(session.id, (seen) =>
      seen.some((event) => event.kind === "status" && event.status === "idle"),
    );
    const reply = textOf(all, "agent_message_chunk");

    expect(reply).toMatch(/nothing has been written/i);
    expect(reply).not.toMatch(/\b(merged|saved|updated the|I have written)\b/i);
  });

  it("proposes nothing when the visitor declines", async () => {
    const session = createDemoAgentSession(DEMO_AGENT_SLUG);
    promptDemoAgentSession(session.id, "Tidy this up");
    const upToCard = await collect(session.id, (seen) =>
      seen.some((event) => event.kind === "permissionRequest"),
    );
    const requestId = upToCard.find((event) => event.kind === "permissionRequest")
      ?.permissionRequest?.requestId as string;
    respondToDemoAgentPermission(session.id, requestId, "reject");

    const all = await collect(session.id, (seen) =>
      seen.some((event) => event.kind === "status" && event.status === "idle"),
    );
    expect(textOf(all, "agent_message_chunk")).toMatch(/haven't proposed anything/i);
  });

  it("answers in the demo's locale", async () => {
    const session = await runWithBusabaseContext({ demoLocale: "zh-CN" }, async () =>
      createDemoAgentSession(DEMO_AGENT_SLUG),
    );
    promptDemoAgentSession(session.id, "帮我看看");

    const events = await collect(session.id, (seen) =>
      seen.some((event) => event.kind === "permissionRequest"),
    );

    expect(textOf(events, "agent_message_chunk")).toContain("变更请求");
  });

  it("rejects an option the card never offered", async () => {
    const session = createDemoAgentSession(DEMO_AGENT_SLUG);
    promptDemoAgentSession(session.id, "Tidy this up");
    const events = await collect(session.id, (seen) =>
      seen.some((event) => event.kind === "permissionRequest"),
    );
    const requestId = events.find((event) => event.kind === "permissionRequest")?.permissionRequest
      ?.requestId as string;

    expect(() => respondToDemoAgentPermission(session.id, requestId, "sudo")).toThrow(
      /not one of the offered options/i,
    );
    cancelDemoAgentSession(session.id);
  });

  it("does not leave the script parked forever when the session is closed", async () => {
    const session = createDemoAgentSession(DEMO_AGENT_SLUG);
    promptDemoAgentSession(session.id, "Tidy this up");
    await collect(session.id, (seen) => seen.some((event) => event.kind === "permissionRequest"));

    closeDemoAgentSession(session.id);

    expect(listDemoAgentSessions()).toEqual([]);
  });
});

describe("subscribing", () => {
  it("replays what a reconnecting client missed rather than showing a gap", async () => {
    const session = createDemoAgentSession(DEMO_AGENT_SLUG);
    promptDemoAgentSession(session.id, "Tidy this up");
    const first = await collect(session.id, (seen) =>
      seen.some((event) => event.kind === "permissionRequest"),
    );

    const replay = await collect(session.id, (seen) =>
      seen.some((event) => event.kind === "permissionRequest"),
    );

    expect(replay.map((event) => event.seq)).toEqual(first.map((event) => event.seq));
  });

  it("ends immediately for a session this process never had", async () => {
    const events = await collect("demo_sess_missing", () => true, 500);
    expect(events).toEqual([]);
  });
});

/**
 * Through the actual demo router, not just this module — that is what proves
 * the demo path is ungated (no actor, no workspace role) and that the contract
 * shapes line up, which is the whole reason the demo renders through the real
 * chat panel instead of a second one.
 */
describe("through the demo router", () => {
  it("offers the demo agent, starts a session and streams a turn — with no actor at all", async () => {
    const { createRouterClient } = await import("@orpc/server");
    const { busabaseDemoRouter } = await import("../../../router-demo");
    const client = createRouterClient(busabaseDemoRouter);

    const catalog = await client.agents.catalog();
    const launchable = catalog.filter((entry) => entry.available);
    expect(launchable.map((entry) => entry.slug)).toEqual([DEMO_AGENT_SLUG]);
    // The real agents still say, truthfully, that the demo cannot run them.
    for (const entry of catalog.filter((row) => row.slug !== DEMO_AGENT_SLUG)) {
      expect(entry.unavailableReason).toBeTruthy();
    }

    const created = await client.agents.sessions.create({ slug: DEMO_AGENT_SLUG });
    expect((await client.agents.sessions.list()).map((s) => s.id)).toContain(created.id);

    await client.agents.sessions.prompt({ sessionId: created.id, text: "What would you change?" });

    const controller = new AbortController();
    const seen: AgentSessionEventVO[] = [];
    const stream = await client.agents.sessions.subscribe(
      { sessionId: created.id, afterSeq: -1 },
      { signal: controller.signal },
    );
    for await (const event of stream) {
      seen.push(event);
      if (event.kind === "permissionRequest") break;
    }
    controller.abort();

    expect(seen.some((event) => event.kind === "permissionRequest")).toBe(true);
    cancelDemoAgentSession(created.id);
  });
});
