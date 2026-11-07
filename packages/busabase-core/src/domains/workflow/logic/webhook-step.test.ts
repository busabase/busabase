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
});
