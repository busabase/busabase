// @vitest-environment jsdom
// The trigger, webhook, and approval controls added for basic use: a field
// filter that offers a select field's choices, a schedule with its next run,
// request headers, and picking approvers from the space's members.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { coreMessagesByLocale } from "../../../i18n/catalog";
import { WorkflowApproverPicker } from "./workflow-approver-picker";
import { WorkflowScheduleSettings } from "./workflow-schedule-settings";
import { WorkflowTriggerFieldFilter } from "./workflow-trigger-field-filter";
import { WorkflowWebhookHeaders } from "./workflow-webhook-headers";

const messages = coreMessagesByLocale.en;

const orpc = {
  bases: {
    list: {
      queryOptions: () => ({
        queryKey: ["bases", "list"],
        queryFn: async () => [
          {
            id: "base-tasks",
            name: "Tasks",
            fields: [
              { id: "f1", slug: "title", name: "Title", type: "text", options: {} },
              {
                id: "f2",
                slug: "status",
                name: "Status",
                type: "select",
                options: {
                  choices: [
                    { id: "opt_draft", name: "Draft" },
                    { id: "opt_ready", name: "Ready" },
                  ],
                },
              },
            ],
          },
        ],
      }),
    },
  },
  spaces: {
    members: {
      queryOptions: () => ({
        queryKey: ["spaces", "members"],
        queryFn: async () => [
          { id: "u1", name: "Alice", email: "alice@example.com", image: null },
          { id: "u2", name: "Ben", email: "ben@example.com", image: null },
          { id: "u3", name: "No email", email: null, image: null },
        ],
      }),
    },
  },
} as unknown as BusabaseQueryUtils;

const wrap = (children: ReactNode) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CoreI18nProvider locale="en">{children}</CoreI18nProvider>
    </QueryClientProvider>,
  );
};

const select = (container: HTMLElement, attribute: string) =>
  container.querySelector<HTMLSelectElement>(`[${attribute}]`);

afterEach(cleanup);

describe("field filter", () => {
  it("asks for a Base first, since any Base has no fields to pick", () => {
    const { container } = wrap(
      <WorkflowTriggerFieldFilter
        baseId=""
        onChange={vi.fn()}
        orpc={orpc}
        value={{ fieldSlug: "", toValue: "" }}
      />,
    );
    expect(container.textContent).toContain(messages.richNodes.triggerFieldNeedsBase);
    expect(select(container, "data-workflow-trigger-field")).toBeNull();
  });

  it("lists the Base's fields, and a select field's choices as the value", async () => {
    const onChange = vi.fn();
    const { container, rerender } = wrap(
      <WorkflowTriggerFieldFilter
        baseId="base-tasks"
        onChange={onChange}
        orpc={orpc}
        value={{ fieldSlug: "", toValue: "" }}
      />,
    );
    const field = await waitFor(() => {
      const element = select(container, "data-workflow-trigger-field");
      if (!element || element.options.length < 3) throw new Error("fields not loaded");
      return element;
    });
    expect([...field.options].map((option) => option.text)).toEqual([
      messages.richNodes.anyField,
      "Title",
      "Status",
    ]);
    fireEvent.change(field, { target: { value: "status" } });
    expect(onChange).toHaveBeenCalledWith({ fieldSlug: "status", toValue: "" });

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <CoreI18nProvider locale="en">
          <WorkflowTriggerFieldFilter
            baseId="base-tasks"
            onChange={onChange}
            orpc={orpc}
            value={{ fieldSlug: "status", toValue: "" }}
          />
        </CoreI18nProvider>
      </QueryClientProvider>,
    );
    const to = await waitFor(() => {
      const element = select(container, "data-workflow-trigger-to-value");
      if (!element || element.options.length < 3) throw new Error("choices not loaded");
      return element;
    });
    expect([...to.options].map((option) => [option.value, option.text])).toEqual([
      ["", messages.richNodes.anyValue],
      ["opt_draft", "Draft"],
      ["opt_ready", "Ready"],
    ]);
    fireEvent.change(to, { target: { value: "opt_ready" } });
    expect(onChange).toHaveBeenLastCalledWith({ fieldSlug: "status", toValue: "opt_ready" });
  });
});

describe("schedule", () => {
  it("shows the next run, asks for Event mode, and offers a weekday for weekly", () => {
    const onChange = vi.fn();
    const { container } = wrap(
      <WorkflowScheduleSettings
        armed={false}
        onChange={onChange}
        value={{ unit: "days", every: 1, at: "09:00", weekday: 1, timezone: "UTC" }}
      />,
    );
    expect(container.querySelector("[data-workflow-schedule-next]")?.textContent).toMatch(
      /^Next run: /,
    );
    expect(container.querySelector("[data-workflow-schedule-unarmed]")?.textContent).toBe(
      messages.richNodes.scheduleNeedsEvent,
    );
    expect(select(container, "data-workflow-schedule-weekday")).toBeNull();
    fireEvent.change(select(container, "data-workflow-schedule-unit") as HTMLSelectElement, {
      target: { value: "minutes" },
    });
    // Minutes start at the 15-minute floor, and the zone is the editor's own.
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ unit: "minutes", every: 15, timezone: expect.any(String) }),
    );
  });

  it("offers the weekday for a weekly schedule and hides the warning in Event mode", () => {
    const { container } = wrap(
      <WorkflowScheduleSettings
        armed
        onChange={vi.fn()}
        value={{ unit: "weeks", every: 1, at: "09:00", weekday: 1, timezone: "UTC" }}
      />,
    );
    const weekday = select(container, "data-workflow-schedule-weekday");
    expect(weekday?.options).toHaveLength(7);
    expect(weekday?.value).toBe("1");
    expect(container.querySelector("[data-workflow-schedule-unarmed]")).toBeNull();
  });
});

describe("webhook headers", () => {
  it("adds, edits, and removes header rows", () => {
    const onChange = vi.fn();
    const { container, rerender } = wrap(<WorkflowWebhookHeaders onChange={onChange} value={[]} />);
    fireEvent.click(container.querySelector("[data-workflow-webhook-header-add]") as HTMLElement);
    expect(onChange).toHaveBeenLastCalledWith([{ name: "", value: "" }]);

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <CoreI18nProvider locale="en">
          <WorkflowWebhookHeaders onChange={onChange} value={[{ name: "", value: "" }]} />
        </CoreI18nProvider>
      </QueryClientProvider>,
    );
    fireEvent.change(
      container.querySelector("[data-workflow-webhook-header-name]") as HTMLInputElement,
      { target: { value: "Authorization" } },
    );
    expect(onChange).toHaveBeenLastCalledWith([{ name: "Authorization", value: "" }]);
    fireEvent.click(
      container.querySelector(
        `[aria-label="${messages.richNodes.removeWebhookHeader}"]`,
      ) as HTMLElement,
    );
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});

describe("approver picker", () => {
  it("appends a member's email and leaves out members already named", async () => {
    const onChange = vi.fn();
    const { container } = wrap(
      <WorkflowApproverPicker onChange={onChange} orpc={orpc} value="alice@example.com" />,
    );
    const picker = await waitFor(() => {
      const element = select(container, "data-workflow-approver-picker");
      if (!element) throw new Error("members not loaded");
      return element;
    });
    // Alice is already named; the member without an email cannot be one.
    expect([...picker.options].map((option) => option.value)).toEqual(["", "ben@example.com"]);
    fireEvent.change(picker, { target: { value: "ben@example.com" } });
    expect(onChange).toHaveBeenCalledWith("alice@example.com, ben@example.com");
  });
});
