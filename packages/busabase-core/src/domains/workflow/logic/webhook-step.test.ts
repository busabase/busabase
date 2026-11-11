import { describe, expect, it } from "vitest";
import { buildWorkflowWebhookHeaders } from "./webhook-step";

describe("buildWorkflowWebhookHeaders", () => {
  it("sends the step's headers on top of the defaults", () => {
    const headers = buildWorkflowWebhookHeaders([
      { name: "Authorization", value: "Bearer abc" },
      { name: "Content-Type", value: "application/vnd.api+json" },
    ]);
    expect(headers.authorization).toBe("Bearer abc");
    expect(headers["content-type"]).toBe("application/vnd.api+json");
    expect(headers["user-agent"]).toBe("Busabase-Workflow/1");
  });

  it("skips empty rows and headers the client sets itself", () => {
    const headers = buildWorkflowWebhookHeaders([
      { name: "  ", value: "ignored" },
      { name: "Host", value: "evil.example" },
      { name: "X-Busabase-Event", value: "spoofed" },
    ]);
    expect(Object.keys(headers).sort()).toEqual(["content-type", "user-agent", "x-busabase-event"]);
    expect(headers["x-busabase-event"]).toBe("workflow.step");
  });

  it("adds the signature header only when the step signs, and a step cannot set its own", () => {
    const signed = buildWorkflowWebhookHeaders(
      [{ name: "X-Busabase-Signature", value: "t=1,v1=forged" }],
      "t=1700000000,v1=abc",
    );
    expect(signed["x-busabase-signature"]).toBe("t=1700000000,v1=abc");
    // Without a secret the header is not sent at all, even if the step wrote one.
    const unsigned = buildWorkflowWebhookHeaders([
      { name: "X-Busabase-Signature", value: "t=1,v1=forged" },
    ]);
    expect(unsigned["x-busabase-signature"]).toBeUndefined();
  });
});
