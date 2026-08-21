import { afterEach, describe, expect, it } from "vitest";
import { getBudaAcpUrl, getBudaOAuthOrigin } from "./buda-connection";

const originalOAuthOrigin = process.env.BUDA_OAUTH_ORIGIN;
const originalAcpUrl = process.env.BUDA_ACP_URL;

afterEach(() => {
  if (originalOAuthOrigin === undefined) delete process.env.BUDA_OAUTH_ORIGIN;
  else process.env.BUDA_OAUTH_ORIGIN = originalOAuthOrigin;
  if (originalAcpUrl === undefined) delete process.env.BUDA_ACP_URL;
  else process.env.BUDA_ACP_URL = originalAcpUrl;
});

describe("Buda connection endpoints", () => {
  it("uses development Buda for OAuth and ACP by default", () => {
    delete process.env.BUDA_OAUTH_ORIGIN;
    delete process.env.BUDA_ACP_URL;

    expect(getBudaOAuthOrigin()).toBe("https://dev.buda.im");
    expect(getBudaAcpUrl("agent-123")).toBe("wss://dev.buda.im/api/acp?agentId=agent-123");
  });

  it("derives the WebSocket endpoint from the configured OAuth origin", () => {
    process.env.BUDA_OAUTH_ORIGIN = "http://localhost:3040/";
    delete process.env.BUDA_ACP_URL;

    expect(getBudaOAuthOrigin()).toBe("http://localhost:3040");
    expect(getBudaAcpUrl("agent-123")).toBe("ws://localhost:3040/api/acp?agentId=agent-123");
  });

  it("keeps an explicit ACP endpoint override", () => {
    process.env.BUDA_ACP_URL = "wss://buda.example/custom/acp";

    expect(getBudaAcpUrl("agent-123")).toBe("wss://buda.example/custom/acp?agentId=agent-123");
  });
});
