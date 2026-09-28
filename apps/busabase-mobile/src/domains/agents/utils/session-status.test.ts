import type { AcpBlock } from "@acp-ui/core/reduce";
import { describe, expect, it } from "vitest";
import { agentSessionStatusLabel, deriveAgentSessionStatus } from "./session-status";

const t = {
  statusConnecting: "connecting…",
  statusIdle: "idle",
  statusBusy: "replying…",
  statusWaitingPermission: "waiting for your decision",
  statusEnded: "ended",
  statusFailed: "failed",
};

describe("agentSessionStatusLabel", () => {
  it("maps every persisted status to its own wording", () => {
    expect(agentSessionStatusLabel("busy", t)).toBe("replying…");
    expect(agentSessionStatusLabel("waiting_permission", t)).toBe("waiting for your decision");
  });
});

describe("deriveAgentSessionStatus", () => {
  const base = {
    sessionId: "s1",
    blocks: [] as AcpBlock[],
    sending: false,
    ended: false,
    error: null,
  };

  it("is connecting before a session id exists", () => {
    expect(deriveAgentSessionStatus({ ...base, sessionId: null })).toBe("connecting");
  });

  it("is failed once the port reports an error, even if the session id is set", () => {
    expect(deriveAgentSessionStatus({ ...base, error: "boom" })).toBe("failed");
  });

  it("is ended once the port says so", () => {
    expect(deriveAgentSessionStatus({ ...base, ended: true })).toBe("ended");
  });

  it("is waiting_permission when the last block is an unanswered permission request", () => {
    const blocks: AcpBlock[] = [
      { kind: "permission", id: "p1", title: "run rm -rf", options: [], resolution: "pending" },
    ];
    expect(deriveAgentSessionStatus({ ...base, blocks })).toBe("waiting_permission");
  });

  it("is busy while a prompt is in flight", () => {
    expect(deriveAgentSessionStatus({ ...base, sending: true })).toBe("busy");
  });

  it("falls back to idle", () => {
    expect(deriveAgentSessionStatus(base)).toBe("idle");
  });
});
