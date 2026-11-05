import type { AgentSessionCommandReceiptVO } from "busabase-contract/domains/agents/types";
import { describe, expect, it } from "vitest";
import {
  createAgentPromptIdentityTracker,
  isAgentSessionAccessError,
  isSupervisedPromptBlocked,
  pendingAgentPromptCommands,
} from "./agent-session-reliability";

describe("supervised prompt retry identity", () => {
  it("distinguishes explicit access errors from recoverable storage and transport failures", () => {
    expect(isAgentSessionAccessError({ code: "FORBIDDEN" })).toBe(true);
    expect(isAgentSessionAccessError({ status: 401 })).toBe(true);
    expect(isAgentSessionAccessError({ code: "NOT_FOUND" })).toBe(true);
    expect(isAgentSessionAccessError({ code: "INTERNAL_SERVER_ERROR", status: 500 })).toBe(false);
    expect(isAgentSessionAccessError(new Error("Network unavailable"))).toBe(false);
  });
  it("retains one identity for a failed draft retry and retires it after acceptance", () => {
    let sequence = 0;
    const tracker = createAgentPromptIdentityTracker(() => `cmd_fixture_${++sequence}`);
    const first = tracker.forAttempt("session-a", { text: "Same words", attachments: [] });
    expect(tracker.forAttempt("session-a", { attachments: [], text: "Same words" })).toBe(first);
    tracker.accepted("another_command");
    expect(tracker.forAttempt("session-a", { text: "Same words", attachments: [] })).toBe(first);
    tracker.accepted(first);
    expect(tracker.forAttempt("session-a", { text: "Same words", attachments: [] })).not.toBe(
      first,
    );
  });

  it("treats a changed attachment, context or session as a new intent", () => {
    let sequence = 0;
    const tracker = createAgentPromptIdentityTracker(() => `cmd_fixture_${++sequence}`);
    const first = tracker.forAttempt("session-a", {
      text: "Read it",
      attachments: [{ data: "A" }],
    });
    const changedFile = tracker.forAttempt("session-a", {
      text: "Read it",
      attachments: [{ data: "B" }],
    });
    const changedContext = tracker.forAttempt("session-a", {
      text: "Read it",
      contextReferences: [{ nodeId: "page-b" }],
    });
    const changedSession = tracker.forAttempt("session-b", {
      text: "Read it",
      contextReferences: [{ nodeId: "page-b" }],
    });
    expect(new Set([first, changedFile, changedContext, changedSession]).size).toBe(4);
  });
});

describe("supervised durable pending presentation", () => {
  const command = (
    commandId: string,
    state: AgentSessionCommandReceiptVO["state"],
  ): AgentSessionCommandReceiptVO => ({
    commandId,
    kind: "prompt",
    state,
    payload: { text: "same text" },
    createdAt: "2026-11-03T00:00:00Z",
    expiresAt: "2026-11-04T00:00:00Z",
  });
  it("deduplicates by committed identity, preserving distinct identical messages", () => {
    expect(
      pendingAgentPromptCommands(
        [
          command("cmd_accepted_one", "queued"),
          command("cmd_accepted_two", "unknown"),
          command("cmd_completed_three", "completed"),
          command("cmd_rejected_four", "rejected"),
        ],
        new Set(["cmd_accepted_one"]),
      ),
    ).toEqual([command("cmd_accepted_two", "unknown"), command("cmd_rejected_four", "rejected")]);
  });
  it("keeps accepted-but-unsent rejected intent visible until its matching user journal row exists", () => {
    const rejected = {
      ...command("cmd_saved_unsent", "rejected"),
      payload: { text: "Saved rejected message", attachments: [{ filename: "retained-note.txt" }] },
      errorCode: "CONNECTION_BINDING_CHANGED",
    };
    expect(pendingAgentPromptCommands([rejected], new Set())).toEqual([rejected]);
    expect(pendingAgentPromptCommands([rejected], new Set([rejected.commandId]))).toEqual([]);
  });
  it("blocks ambiguous or incomplete supervised conversations without changing legacy eligibility", () => {
    expect(isSupervisedPromptBlocked(undefined)).toBe(false);
    expect(
      isSupervisedPromptBlocked({
        connection: "connected",
        execution: "idle",
        synchronization: "synced",
      }),
    ).toBe(false);
    expect(
      isSupervisedPromptBlocked({
        connection: "connected",
        execution: "unknown",
        synchronization: "synced",
      }),
    ).toBe(true);
    expect(
      isSupervisedPromptBlocked({
        connection: "connected",
        execution: "idle",
        synchronization: "gap",
      }),
    ).toBe(true);
    expect(
      isSupervisedPromptBlocked({
        connection: "connected",
        execution: "terminal",
        synchronization: "synced",
      }),
    ).toBe(true);
  });
});
