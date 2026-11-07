// @vitest-environment jsdom
// The Find records step's settings: a Base, one of its Views, how many, and
// whether the next steps run once per record.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { WORKFLOW_FIND_RECORDS_ACTION } from "busabase-contract/domains/workflow/run";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { coreMessagesByLocale } from "../../../i18n/catalog";
import {
  WorkflowActionSettings,
  type WorkflowFindRecordsSettings,
} from "./workflow-action-settings";

const messages = coreMessagesByLocale.en;

const orpc = {
  bases: {
    list: {
      queryOptions: () => ({
        queryKey: ["bases", "list"],
        queryFn: async () => [
          { id: "base-tasks", name: "Tasks", fields: [] },
          { id: "base-leads", name: "Leads", fields: [] },
        ],
      }),
    },
    listViews: {
      queryOptions: ({ input }: { input: { baseId: string } }) => ({
        queryKey: ["bases", "listViews", input.baseId],
        queryFn: async () =>
          input.baseId === "base-tasks"
            ? [
                { id: "viw_all", name: "Grid view" },
                { id: "viw_overdue", name: "Overdue" },
              ]
            : [],
      }),
    },
  },
} as unknown as BusabaseQueryUtils;

const renderSettings = (
  baseId: string,
  find: WorkflowFindRecordsSettings,
  onChange: (patch: Record<string, unknown>) => void,
) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <CoreI18nProvider locale="en">
        <WorkflowActionSettings
          actionName={WORKFLOW_FIND_RECORDS_ACTION}
          baseId={baseId}
          fields={{}}
          find={find}
          onChange={onChange}
          orpc={orpc}
          stepId="find"
          targetRecordId=""
        />
      </CoreI18nProvider>
    </QueryClientProvider>,
  );

const empty: WorkflowFindRecordsSettings = { viewId: "", limit: null, forEach: false };

afterEach(cleanup);

describe("find records settings", () => {
  it("offers Find records as an action, with what it does", () => {
    const { container } = renderSettings("", empty, vi.fn());
    const action = container.querySelector<HTMLSelectElement>("[data-workflow-action-name]");
    expect(action?.value).toBe(WORKFLOW_FIND_RECORDS_ACTION);
    expect(action?.selectedOptions[0]?.text).toBe(messages.richNodes.actionFindRecords);
    expect(container.textContent).toContain(messages.richNodes.findRecordsHint);
    // No fields to set and no single record to target.
    expect(container.querySelector("[data-workflow-action-fields]")).toBeNull();
    expect(container.querySelector("[data-workflow-action-target]")).toBeNull();
  });

  it("asks for a Base before its Views, and a new Base starts from all records", async () => {
    const onChange = vi.fn();
    const { container } = renderSettings("", empty, onChange);
    const view = container.querySelector<HTMLSelectElement>("[data-workflow-find-view]");
    expect(view?.disabled).toBe(true);

    const base = await waitFor(() => {
      const element = container.querySelector<HTMLSelectElement>("[data-workflow-trigger-base]");
      if (!element || element.options.length < 3) throw new Error("bases not loaded");
      return element;
    });
    fireEvent.change(base, { target: { value: "base-tasks" } });
    expect(onChange).toHaveBeenCalledWith({ baseId: "base-tasks", viewId: "" });
  });

  it("lists the chosen Base's Views", async () => {
    const onChange = vi.fn();
    const { container } = renderSettings("base-tasks", empty, onChange);
    const view = await waitFor(() => {
      const element = container.querySelector<HTMLSelectElement>("[data-workflow-find-view]");
      if (!element || element.options.length < 3) throw new Error("views not loaded");
      return element;
    });
    expect([...view.options].map((option) => [option.value, option.text])).toEqual([
      ["", messages.richNodes.findRecordsAllRecords],
      ["viw_all", "Grid view"],
      ["viw_overdue", "Overdue"],
    ]);
    fireEvent.change(view, { target: { value: "viw_overdue" } });
    expect(onChange).toHaveBeenCalledWith({ viewId: "viw_overdue" });
  });

  it("keeps the limit within 1 to 200, and empty means the default", () => {
    const onChange = vi.fn();
    const { container } = renderSettings("base-tasks", empty, onChange);
    const limit = container.querySelector<HTMLInputElement>("[data-workflow-find-limit]");
    if (!limit) throw new Error("no limit input");
    expect(limit.placeholder).toBe("50");
    fireEvent.change(limit, { target: { value: "500" } });
    expect(onChange).toHaveBeenLastCalledWith({ limit: 200 });
    fireEvent.change(limit, { target: { value: "20" } });
    expect(onChange).toHaveBeenLastCalledWith({ limit: 20 });
  });

  it("clears a limit back to the default", () => {
    const onChange = vi.fn();
    const { container } = renderSettings("base-tasks", { ...empty, limit: 20 }, onChange);
    const limit = container.querySelector<HTMLInputElement>("[data-workflow-find-limit]");
    if (!limit) throw new Error("no limit input");
    expect(limit.value).toBe("20");
    fireEvent.change(limit, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith({ limit: null });
  });

  it("turns on one run per record", () => {
    const onChange = vi.fn();
    const { container } = renderSettings("base-tasks", empty, onChange);
    const each = container.querySelector<HTMLInputElement>("[data-workflow-find-each]");
    if (!each) throw new Error("no checkbox");
    expect(container.textContent).toContain(messages.richNodes.findRecordsForEachHint);
    fireEvent.click(each);
    expect(onChange).toHaveBeenCalledWith({ forEach: true });
  });
});
