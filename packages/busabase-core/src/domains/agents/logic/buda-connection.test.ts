import { afterEach, describe, expect, it } from "vitest";
import { getBudaAcpUrl, getBudaOAuthOrigin, getBudaSessionSlug } from "./buda-connection";

const originalOAuthOrigin = process.env.BUDA_OAUTH_ORIGIN;
const originalAcpUrl = process.env.BUDA_ACP_URL;
const originalEdition = process.env.BUSABASE_BUILD_EDITION;

afterEach(() => {
  if (originalOAuthOrigin === undefined) delete process.env.BUDA_OAUTH_ORIGIN;
  else process.env.BUDA_OAUTH_ORIGIN = originalOAuthOrigin;
  if (originalAcpUrl === undefined) delete process.env.BUDA_ACP_URL;
  else process.env.BUDA_ACP_URL = originalAcpUrl;
  if (originalEdition === undefined) delete process.env.BUSABASE_BUILD_EDITION;
  else process.env.BUSABASE_BUILD_EDITION = originalEdition;
});

describe("Buda connection endpoints", () => {
  it("creates an agent-specific session slug", () => {
    expect(getBudaSessionSlug("agent/123")).toBe("buda:agent%2F123");
  });

  it.each([undefined, "cloud", "self-hosted"])("uses production Buda for edition %s", (edition) => {
    if (edition === undefined) delete process.env.BUSABASE_BUILD_EDITION;
    else process.env.BUSABASE_BUILD_EDITION = edition;
    delete process.env.BUDA_OAUTH_ORIGIN;
    delete process.env.BUDA_ACP_URL;

    expect(getBudaOAuthOrigin()).toBe("https://buda.im");
    expect(getBudaAcpUrl("agent-123")).toBe("wss://buda.im/api/acp?agentId=agent-123");
  });

  it("uses the production default when the origin override is blank", () => {
    process.env.BUDA_OAUTH_ORIGIN = "   ";

    expect(getBudaOAuthOrigin()).toBe("https://buda.im");
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
