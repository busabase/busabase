// @vitest-environment jsdom
import { EditorView } from "@codemirror/view";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { BaseFieldVO, BaseVO } from "busabase-contract/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { formulaFieldDraftKey, readFormulaFieldDraft } from "../helpers/formula-field";
import { SubmitPermissionProvider } from "./split-submit-button";

// Leave dialogs, submit permissions, the field editor and save callbacks real.
// Stub unrelated large surfaces and transport only; this suite asserts the
// field-settings interaction rather than the table/rendering dependencies.
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

const field = (slug: string, expression?: string): BaseFieldVO => ({
  id: `fld_${slug}`,
  baseId: "bas_settings",
  name: slug,
  slug,
  type: expression ? "formula" : "number",
  position: 0,
  required: false,
  options: expression ? { formula: { expression } } : {},
});
const base: BaseVO = {
  id: "bas_settings",
  nodeId: "nod_settings",
  name: "Orders",
  slug: "orders",
  description: "",
  createdAt: "2026-10-13T00:00:00Z",
  reviewPolicy: { kind: "single", requiredApprovals: 1 },
  fields: [field("price"), field("subtotal", "{price} * 2"), field("total", "{subtotal} + 10")],
};
const queryOptions = () => ({});
const orpc = {
  records: { list: { queryOptions }, count: { queryOptions } },
  bases: {
    get: { queryOptions },
    previewFieldConversion: { queryOptions },
    listViews: { queryOptions },
  },
} as unknown as BusabaseQueryUtils;
const draftKey = formulaFieldDraftKey("space:viewer", base.id);

function renderSetup(
  permission: "manage" | "read" | "changeRequest" = "manage",
  onCreateField = vi.fn().mockResolvedValue(undefined),
  onUpdateField = vi.fn().mockResolvedValue(undefined),
  originViewId?: string,
) {
  const element = (level = permission) => (
    <CoreI18nProvider locale="en">
      <SubmitPermissionProvider permissionLevel={level}>
        <BaseSetupView
          base={base}
          bases={[base]}
          draftScope="space:viewer"
          originViewId={originViewId}
          orpc={orpc}
          onCreateField={onCreateField}
          onUpdateField={onUpdateField}
        />
      </SubmitPermissionProvider>
    </CoreI18nProvider>
  );
  const result = render(element());
  return {
    ...result,
    onCreateField,
    onUpdateField,
    setPermission: (level: typeof permission) => result.rerender(element(level)),
  };
}

function setExpression(expression: string) {
  const host = screen.getByTestId("formula-expression").closest(".cm-editor");
  const editor = host ? EditorView.findFromDOM(host as HTMLElement) : null;
  if (!editor) throw new Error("Formula editor missing");
  act(() =>
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: expression } }),
  );
}

function openNewFormula() {
  fireEvent.click(screen.getByRole("button", { name: /Add Field/i }));
  const modal = screen.getByRole("dialog");
  fireEvent.change(within(modal).getByLabelText("Name"), { target: { value: "Amount" } });
  fireEvent.change(within(modal).getByRole("combobox"), { target: { value: "formula" } });
  setExpression("{price} * 3");
  return modal;
}

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("formula field settings recovery and permissions", () => {
  it("retains the originating view when a field is submitted for review", async () => {
    const result = renderSetup("changeRequest", undefined, undefined, "viw_curated");
    openNewFormula();
    fireEvent.click(screen.getByRole("button", { name: "Add Field Request" }));
    await waitFor(() => expect(result.onCreateField).toHaveBeenCalledOnce());
    expect(result.onCreateField.mock.calls[0]?.[1]).toMatchObject({ originViewId: "viw_curated" });
  });

  it("requires confirmation to discard changes and keeps the draft when discard is refused", () => {
    renderSetup();
    openNewFormula();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(confirm).toHaveBeenCalledWith("Discard unsaved formula changes?");
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(readFormulaFieldDraft(draftKey)?.formula.expression).toBe("{price} * 3");
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(readFormulaFieldDraft(draftKey)).toBeNull();
  });

  it("retains expression and draft after save rejection and clears them only after retry succeeds", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("Permission denied"))
      .mockResolvedValue(undefined);
    renderSetup("manage", save);
    openNewFormula();
    expect(
      within(screen.getByRole("dialog")).queryByRole("checkbox", { name: "Required" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add Field Now" }));
    await waitFor(() => expect(screen.getByText("Permission denied")).toBeTruthy());
    expect(screen.getByTestId("formula-expression").textContent).toBe("{price} * 3");
    expect(readFormulaFieldDraft(draftKey)?.formula.expression).toBe("{price} * 3");
    fireEvent.click(screen.getByRole("button", { name: "Add Field Now" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(save).toHaveBeenLastCalledWith(
      base,
      expect.objectContaining({
        required: false,
        options: { formula: { expression: "{price} * 3" } },
      }),
      { mergeImmediately: true },
    );
    expect(readFormulaFieldDraft(draftKey)).toBeNull();
  });

  it("removes write actions when the viewer becomes read-only without losing their expression", () => {
    const result = renderSetup();
    openNewFormula();
    expect(screen.getByRole("button", { name: "Add Field Now" })).toBeTruthy();
    result.setPermission("read");
    expect(screen.queryByRole("button", { name: "Add Field Now" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add Field Request" })).toBeNull();
    expect(screen.getByTestId("formula-expression").textContent).toBe("{price} * 3");
    expect(result.onCreateField).not.toHaveBeenCalled();
  });

  it("a proposer submits the configured formula for review without an immediate-merge option", async () => {
    const result = renderSetup("changeRequest");
    openNewFormula();
    expect(screen.queryByRole("button", { name: "Add Field Now" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add Field Request" }));
    await waitFor(() => expect(result.onCreateField).toHaveBeenCalledOnce());
    expect(result.onCreateField.mock.calls[0]?.[2]).toBeUndefined();
    expect(result.onCreateField.mock.calls[0]?.[1]).toMatchObject({
      type: "formula",
      required: false,
      options: { formula: { expression: "{price} * 3" } },
    });
  });

  it("warns about downstream changes and aborts safely when confirmation is declined", async () => {
    const result = renderSetup();
    fireEvent.click(screen.getByRole("button", { name: "Rename subtotal" }));
    setExpression("{price} * 4");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Save now" }));
    expect(confirm).toHaveBeenCalledWith(
      "Updating this formula will also recalculate: total. Continue?",
    );
    expect(result.onUpdateField).not.toHaveBeenCalled();
    expect(screen.getByTestId("formula-expression").textContent).toBe("{price} * 4");
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Save now" }));
    await waitFor(() => expect(result.onUpdateField).toHaveBeenCalledOnce());
    expect(result.onUpdateField).toHaveBeenCalledWith(
      base,
      "fld_subtotal",
      { formula: { expression: "{price} * 4" } },
      { mergeImmediately: true },
    );
    expect(readFormulaFieldDraft(draftKey)).toBeNull();
  });

  it("includes a changed field name when saving an updated formula", async () => {
    const result = renderSetup();
    fireEvent.click(screen.getByRole("button", { name: "Rename subtotal" }));
    fireEvent.change(within(screen.getByRole("dialog")).getByLabelText("Name"), {
      target: { value: "Line subtotal" },
    });
    setExpression("{price} * 4");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Save now" }));
    await waitFor(() => expect(result.onUpdateField).toHaveBeenCalledOnce());
    expect(result.onUpdateField).toHaveBeenCalledWith(
      base,
      "fld_subtotal",
      { name: "Line subtotal", formula: { expression: "{price} * 4" } },
      { mergeImmediately: true },
    );
  });

  it("restores a new-field draft after remount with its name, slug and display format", () => {
    const result = renderSetup();
    openNewFormula();
    fireEvent.change(screen.getByTestId("formula-format"), { target: { value: "currency" } });
    fireEvent.change(screen.getByTestId("formula-currency"), { target: { value: "CNY" } });
    result.unmount();
    renderSetup();
    const modal = screen.getByRole("dialog");
    expect(within(modal).getByLabelText("Name").getAttribute("value")).toBe("Amount");
    expect(within(modal).getByLabelText("Slug").getAttribute("value")).toBe("amount");
    expect(screen.getByTestId("formula-expression").textContent).toBe("{price} * 3");
    expect((screen.getByTestId("formula-format") as HTMLSelectElement).value).toBe("currency");
    expect((screen.getByTestId("formula-currency") as HTMLSelectElement).value).toBe("CNY");
    expect(screen.getByText("Unsaved formula draft restored.")).toBeTruthy();
  });

  it("locks the editor and submit button during an outstanding save", async () => {
    let finish: (() => void) | undefined;
    const save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    renderSetup("manage", save);
    openNewFormula();
    fireEvent.click(screen.getByRole("button", { name: "Add Field Now" }));
    expect(screen.getByTestId("formula-expression").getAttribute("contenteditable")).toBe("false");
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: "Adding..." }));
    expect(save).toHaveBeenCalledOnce();
    await act(async () => finish?.());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
