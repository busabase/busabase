import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeBudaAcpEndpoint } from "./buda-acp-connection";

beforeEach(() => {
  vi.stubEnv("BUDA_ACP_URL", "");
  vi.stubEnv("BUDA_OAUTH_ORIGIN", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("Buda ACP endpoint trust", () => {
  it.each(["wss://buda.im/api/acp", "wss://dev.buda.im/api/acp"])(
    "normalizes the official endpoint and keeps an explicit agent selection: %s",
    (endpoint) => {
      expect(normalizeBudaAcpEndpoint(` ${endpoint} `, "agent / 1")).toBe(
        `${endpoint}?agentId=agent+%2F+1`,
      );
      expect(normalizeBudaAcpEndpoint(`${endpoint}?agentId=agent-1`, "agent-1")).toBe(
        `${endpoint}?agentId=agent-1`,
      );
    },
  );
  it("accepts exactly the configured deployment endpoint, including explicit local fixtures", () => {
    vi.stubEnv("BUDA_ACP_URL", "ws://127.0.0.1:17654/custom-acp");
    expect(normalizeBudaAcpEndpoint("ws://127.0.0.1:17654/custom-acp", "agent-1")).toBe(
      "ws://127.0.0.1:17654/custom-acp?agentId=agent-1",
    );
    expect(() => normalizeBudaAcpEndpoint("ws://127.0.0.1:17655/custom-acp", "agent-1")).toThrow();
  });
  it("keeps both official endpoints trusted when a deployment endpoint is configured", () => {
    vi.stubEnv("BUDA_ACP_URL", "wss://custom.example/custom-acp");
    vi.stubEnv("BUDA_OAUTH_ORIGIN", "https://custom.example");
    for (const endpoint of ["wss://buda.im/api/acp", "wss://dev.buda.im/api/acp"]) {
      expect(normalizeBudaAcpEndpoint(endpoint, "agent-1")).toBe(`${endpoint}?agentId=agent-1`);
    }
  });
  it.each([
    "https://buda.im/api/acp",
    "ws://buda.im/api/acp",
    "wss://buda.im.evil.example/api/acp",
    "wss://evil.example/api/acp",
    "wss://user:secret@buda.im/api/acp",
    "wss://buda.im/api/acp#fragment",
    "wss://buda.im:8443/api/acp",
    "wss://buda.im/api/other",
    "wss://buda.im/api/acp?token=secret",
    "wss://buda.im/api/acp?agentId=other",
    "wss://buda.im/api/acp?agentId=agent-1&agentId=agent-1",
    "https://dev.buda.im/api/acp",
    "http://dev.buda.im/api/acp",
    "ws://dev.buda.im/api/acp",
    "wss://dev-buda.im/api/acp",
    "wss://dev.buda.im.evil.example/api/acp",
    "wss://user:secret@dev.buda.im/api/acp",
    "wss://dev.buda.im/api/acp#fragment",
    "wss://dev.buda.im:8443/api/acp",
    "wss://dev.buda.im/api/other",
    "wss://dev.buda.im/api/acp/extra",
    "wss://dev.buda.im/api/acp?token=secret",
    "wss://dev.buda.im/api/acp?agentId=other",
    "wss://dev.buda.im/api/acp?agentId=agent-1&agentId=agent-1",
    "ws://127.0.0.1:15439/api/acp",
    "ws://169.254.169.254/api/acp",
  ])("rejects untrusted or ambiguous destinations: %s", (endpoint) => {
    expect(() => normalizeBudaAcpEndpoint(endpoint, "agent-1")).toThrow();
  });
});
