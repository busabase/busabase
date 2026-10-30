// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { BaseVO } from "busabase-contract/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { SubmitPermissionProvider } from "./split-submit-button";

// Keep the actual field dialog and submit state; unrelated workbench panels do
// not participate in configuring a relation or retrying the same command.
vi.mock("./base-table", () => ({
  BusaBaseTable: () => null,
  applyViewConfigToRecords: (records: unknown) => records,
}));
vi.mock("../../form/components/forms-for-base-panel", () => ({ FormsForBasePanel: () => null }));
vi.mock("./node-settings-dialog", () => ({ NodeSettingsDialog: () => null }));
vi.mock("./node-actions-menu", () => ({ NodeActionsMenu: () => null }));
vi.mock("./node-agent-prompts-button", () => ({ NodeAgentPromptsButton: () => null }));
vi.mock("wouter", () => ({ useSearch: () => "" }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: { records: [] }, isFetching: false, error: null, refetch: vi.fn() }),
}));
const { BaseSetupView } = await import("./base-views");

const base = {
  id: "bas_a",
  nodeId: "nod_a",
  slug: "a",
  name: "A",
  description: "",
  createdAt: "2026-10-26T00:00:00Z",
  reviewPolicy: { kind: "single", requiredApprovals: 1 },
  fields: [{ id: "fld_title", slug: "title", name: "Title", type: "text", options: {} }],
} as BaseVO;
const target = { ...base, id: "bas_b", nodeId: "nod_b", slug: "b", name: "B" };
const queryOptions = () => ({});
const orpc = {
  records: { list: { queryOptions }, count: { queryOptions } },
  bases: {
    get: { queryOptions },
    previewFieldConversion: { queryOptions },
    listViews: { queryOptions },
  },
} as unknown as BusabaseQueryUtils;

function setup(save = vi.fn().mockResolvedValue(undefined)) {
  render(
    <CoreI18nProvider locale="en">
      <SubmitPermissionProvider permissionLevel="manage">
        <BaseSetupView base={base} bases={[base, target]} orpc={orpc} onCreateField={save} />
      </SubmitPermissionProvider>
    </CoreI18nProvider>,
  );
  return save;
}

function openRelation(name = "Reviewer") {
  fireEvent.click(screen.getByRole("button", { name: /Add Field/i }));
  const modal = screen.getByRole("dialog");
  fireEvent.change(within(modal).getByLabelText("Name"), { target: { value: name } });
  fireEvent.change(within(modal).getByRole("combobox"), { target: { value: "relation" } });
  fireEvent.change(within(modal).getByLabelText("Target Base"), { target: { value: target.id } });
  return modal;
}

afterEach(cleanup);

describe("relation field commands", () => {
  it("submits the selected reverse field as part of one command", async () => {
    const save = setup();
    openRelation();
    fireEvent.click(screen.getByRole("button", { name: "Add Field Now" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(
      base,
      expect.objectContaining({
        type: "relation",
        options: { targetBaseId: target.id, multiple: true },
      }),
      { mergeImmediately: true, reverse: { name: "A" }, requestId: expect.any(String) },
    );
  });

  it("keeps the same command key on retry, replaces it after editing, and clears it for a new field", async () => {
    const save = setup(
      vi
        .fn()
        .mockRejectedValueOnce(new Error("Offline"))
        .mockRejectedValueOnce(new Error("Offline again"))
        .mockResolvedValue(undefined),
    );
    const modal = openRelation();
    fireEvent.click(
      within(modal).getByRole("checkbox", { name: /Create a corresponding two-way/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Add Field Now" }));
    await screen.findByText("Offline");
    const firstId = save.mock.calls[0]?.[2].requestId;
    expect(save.mock.calls[0]?.[2].reverse).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Add Field Now" }));
    await screen.findByText("Offline again");
    expect(save.mock.calls[1]?.[2].requestId).toBe(firstId);
    fireEvent.change(within(modal).getByLabelText("Name"), { target: { value: "Approver" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Field Now" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(save.mock.calls[2]?.[2].requestId).not.toBe(firstId);
    openRelation("Reviewer");
    fireEvent.click(screen.getByRole("button", { name: "Add Field Now" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(save.mock.calls[3]?.[2].requestId).not.toBe(save.mock.calls[2]?.[2].requestId);
  });
});
