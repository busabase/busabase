import { describe, expect, it } from "vitest";
import {
  ALL_BASES_VALUE,
  buildWebhookCreateInput,
  buildWebhookUpdateInput,
  emptyWebhookForm,
  getWebhookTestFireMessage,
  webhookRuleToForm,
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

  it("describes every test-fire outcome without losing the server detail", () => {
    expect(getWebhookTestFireMessage({ status: "success", detail: null })).toBe(
      "Test delivery succeeded.",
    );
    expect(getWebhookTestFireMessage({ status: "failed", detail: "HTTP 503" })).toBe(
      "Test delivery failed: HTTP 503.",
    );
    expect(getWebhookTestFireMessage({ status: "failed", detail: null })).toBe(
      "Test delivery failed.",
    );
    expect(getWebhookTestFireMessage({ status: "skipped", detail: "disabled" })).toBe(
      "Test delivery skipped.",
    );
  });

  it("opens an existing HTTP rule without exposing or clearing its configured secret", () => {
    expect(
      webhookRuleToForm({
        id: "rule-1",
        spaceId: "space-1",
        baseId: "base-1",
        name: "Notify claims",
        eventType: "record.created",
        actionKind: "webhook",
        config: { targetUrl: "https://example.com/hook", hasSecret: true },
        enabled: false,
        createdBy: "user-1",
        createdAt: "2026-08-18T00:00:00.000Z",
        updatedAt: "2026-08-18T00:00:00.000Z",
        lastTriggeredAt: null,
        lastStatus: null,
      }),
    ).toMatchObject({
      id: "rule-1",
      baseId: "base-1",
      name: "Notify claims",
      targetUrl: "https://example.com/hook",
      secret: "",
      hasSecret: true,
      enabled: false,
    });
  });
});
