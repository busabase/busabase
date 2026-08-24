import { describe, expect, it } from "vitest";
import {
  describeAcpEndpoint,
  describeAcpError,
  redactAcpDiagnosticText,
} from "./acp-connection-diagnostics";

describe("ACP connection diagnostics", () => {
  it("preserves structured ACP details as the user-facing message", () => {
    const error = Object.assign(new Error("Internal error"), {
      name: "RequestError",
      code: -32603,
      data: {
        details:
          "Unauthorized: connect with `Authorization: Bearer sk_...` and an accessible agent.",
      },
    });

    expect(describeAcpError(error)).toEqual({
      message: "Unauthorized: connect with `Authorization: Bearer sk_...` and an accessible agent.",
      errorName: "RequestError",
      errorCode: -32603,
      errorDetails:
        "Unauthorized: connect with `Authorization: Bearer sk_...` and an accessible agent.",
    });
  });

  it("redacts credentials from diagnostic text", () => {
    const secret = "sk_abcdefghijklmnopqrstuvwxyz123456==";
    const value = redactAcpDiagnosticText(
      `Authorization: Bearer ${secret}; access_token=bso_abcdefghijklmnopqrstuvwxyz123456==`,
    );

    expect(value).not.toContain(secret);
    expect(value).not.toContain("bso_abcdefghijklmnopqrstuvwxyz123456==");
    expect(value).toContain("Bearer [REDACTED]");
  });

  it("removes endpoint query parameters and hashes the agent id", () => {
    const diagnostics = describeAcpEndpoint(
      "wss://buda.example/api/acp?agentId=agent-secret&access_token=secret",
    );

    expect(diagnostics.endpoint).toBe("wss://buda.example/api/acp");
    expect(diagnostics.agentRef).toMatch(/^[a-f0-9]{12}$/);
    expect(JSON.stringify(diagnostics)).not.toContain("agent-secret");
    expect(JSON.stringify(diagnostics)).not.toContain("access_token");
  });
});
