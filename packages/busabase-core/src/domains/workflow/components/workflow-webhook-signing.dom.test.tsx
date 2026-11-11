// @vitest-environment jsdom
// The "Sign requests" switch on a Webhook step: on makes a secret to copy,
// the secret can be changed, and off removes it.
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { coreMessagesByLocale } from "../../../i18n/catalog";
import { WorkflowWebhookSigning } from "./workflow-webhook-signing";

const copy = coreMessagesByLocale.en.richNodes;

const renderSigning = (value: string, onChange = vi.fn()) =>
  render(
    <CoreI18nProvider locale="en">
      <WorkflowWebhookSigning onChange={onChange} value={value} />
    </CoreI18nProvider>,
  );

afterEach(cleanup);

describe("Webhook step signing", () => {
  it("shows only the switch, and what turning it on does, while the step does not sign", () => {
    const { container } = renderSigning("");
    const sign = container.querySelector<HTMLInputElement>("[data-workflow-webhook-sign]");
    expect(sign?.checked).toBe(false);
    expect(container.querySelector("[data-workflow-webhook-secret]")).toBeNull();
    expect(container.textContent).toContain(copy.webhookSignOffHint);
  });

  it("makes a secret when switched on", () => {
    const onChange = vi.fn();
    const { container } = renderSigning("", onChange);
    fireEvent.click(container.querySelector("[data-workflow-webhook-sign]") as HTMLInputElement);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]).toMatch(/^whsec_[A-Za-z0-9_-]{32}$/);
  });

  it("shows the secret with how to check it, changes it on request, and removes it when switched off", () => {
    const onChange = vi.fn();
    const { container } = renderSigning("whsec_current_secret_abcdefghijklmnop", onChange);
    const secret = container.querySelector<HTMLInputElement>("[data-workflow-webhook-secret]");
    expect(secret?.value).toBe("whsec_current_secret_abcdefghijklmnop");
    expect(secret?.readOnly).toBe(true);
    expect(container.textContent).toContain("X-Busabase-Signature");
    expect(container.textContent).toContain(copy.webhookSigningHint);

    fireEvent.click(
      container.querySelector("[data-workflow-webhook-secret-regenerate]") as HTMLButtonElement,
    );
    const changed = onChange.mock.calls.at(-1)?.[0] as string;
    expect(changed).toMatch(/^whsec_/);
    expect(changed).not.toBe("whsec_current_secret_abcdefghijklmnop");

    fireEvent.click(container.querySelector("[data-workflow-webhook-sign]") as HTMLInputElement);
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("copies the secret", async () => {
    const writeText = vi.fn(async (_text: string) => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const { container } = renderSigning("whsec_current_secret_abcdefghijklmnop");
    fireEvent.click(
      container.querySelector("[data-workflow-webhook-secret-copy]") as HTMLButtonElement,
    );
    expect(writeText).toHaveBeenCalledWith("whsec_current_secret_abcdefghijklmnop");
    await waitFor(() =>
      expect(container.querySelector("[data-workflow-webhook-secret-copied]")).not.toBeNull(),
    );
  });
});
