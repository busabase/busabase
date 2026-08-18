import { describe, expect, it } from "vitest";
import {
  ALL_BASES_VALUE,
  buildWebhookCreateInput,
  buildWebhookUpdateInput,
  emptyWebhookForm,
} from "./webhook-form";

describe("webhook form mapping", () => {
  it("maps an all-base webhook without replacing an existing blank secret", () => {
    const input = buildWebhookCreateInput({
      ...emptyWebhookForm(),
      name: " Notify records ",
      targetUrl: " https://example.com/hook ",
      secret: "",
      baseId: ALL_BASES_VALUE,
    });

    expect(input).toEqual({
      name: "Notify records",
      eventType: "record.created",
      baseId: null,
      enabled: true,
      actionKind: "webhook",
      config: { targetUrl: "https://example.com/hook" },
    });
  });

  it("maps function settings and preserves the rule id for updates", () => {
    const input = buildWebhookUpdateInput(
      {
        ...emptyWebhookForm(),
        actionKind: "run_function",
        name: "Run policy",
        code: "module.exports = async () => true",
        timeoutMs: 3500,
      },
      "rule-1",
    );

    expect(input).toMatchObject({
      id: "rule-1",
      actionKind: "run_function",
      config: { code: "module.exports = async () => true", timeoutMs: 3500 },
    });
  });
});
