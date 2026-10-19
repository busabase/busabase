// @vitest-environment jsdom
import { EditorView } from "@codemirror/view";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BaseFieldVO, BaseVO, RecordVO } from "busabase-contract/types";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import type { FormulaFieldOptions } from "../helpers/formula-field";
import { FormulaFieldEditor } from "./formula-field-editor";
import { FormulaValue } from "./formula-value";

const field = (slug: string, name = slug, expression?: string): BaseFieldVO => ({
  id: `fld_${slug}`,
  baseId: "bas_formula",
  slug,
  name,
  type: expression ? "formula" : "number",
  required: false,
  position: 0,
  options: expression ? { formula: { expression } } : {},
});
const fields = [field("price", "单价"), field("quantity", "数量")];
const base: BaseVO = {
  id: "bas_formula",
  slug: "formula",
  name: "Orders",
  nodeId: "nod_formula",
  description: "",
  createdAt: "2026-10-13T00:00:00Z",
  reviewPolicy: { kind: "single", requiredApprovals: 1 },
  fields,
};
const record = (id: string, price: number, quantity: number): RecordVO => ({
  id,
  baseId: base.id,
  headCommitId: `commit_${id}`,
  parentRecordId: null,
  parentCommitId: null,
  status: "active",
  createdBy: "user",
  archivedAt: null,
  createdAt: "2026-10-13T00:00:00Z",
  updatedAt: "2026-10-13T01:00:00Z",
  base,
  headCommit: {
    id: `commit_${id}`,
    baseId: base.id,
    targetType: "base",
    nodeId: null,
    operationId: null,
    parentCommitId: null,
    payload: { price, quantity },
    operation: "record_create",
    message: "Test record",
    author: "user",
    createdAt: "2026-10-13T00:00:00Z",
  },
});

function editorView() {
  const node = screen.getByTestId("formula-expression").closest(".cm-editor");
  if (!node) throw new Error("CodeMirror did not mount");
  const view = EditorView.findFromDOM(node as HTMLElement);
  if (!view) throw new Error("CodeMirror view not found");
  return view;
}

function renderEditor({
  expression = "{price} * {quantity}",
  records = [record("rec_1", 12.5, 4), record("rec_2", 8, 3)],
  locale = "en",
  allFields = fields,
}: {
  expression?: string;
  records?: RecordVO[];
  locale?: "en" | "zh-CN";
  allFields?: BaseFieldVO[];
} = {}) {
  const validity = vi.fn();
  function Harness() {
    const [value, setValue] = useState<FormulaFieldOptions>({ expression });
    return (
      <CoreI18nProvider locale={locale}>
        <FormulaFieldEditor
          fields={allFields}
          slug="total"
          value={value}
          onChange={setValue}
          onValidityChange={validity}
          records={records}
        />
      </CoreI18nProvider>
    );
  }
  const result = render(<Harness />);
  return { ...result, validity };
}

afterEach(() => cleanup());

describe("formula field editor", () => {
  it("previews permission-scoped samples and changes display format without changing formula", async () => {
    const { validity } = renderEditor();
    expect(screen.getByTestId("formula-preview-result").textContent).toBe("50");
    expect(validity).toHaveBeenLastCalledWith(true);
    fireEvent.change(screen.getByTestId("formula-sample-record"), { target: { value: "rec_2" } });
    expect(screen.getByTestId("formula-preview-result").textContent).toBe("24");
    fireEvent.change(screen.getByTestId("formula-format"), { target: { value: "currency" } });
    fireEvent.change(screen.getByTestId("formula-currency"), { target: { value: "USD" } });
    expect(screen.getByTestId("formula-preview-result").textContent).toBe("$24.00");
    expect(editorView().state.doc.toString()).toBe("{price} * {quantity}");
  });

  it("inserts localized fields at the cursor and preserves stable slugs", async () => {
    renderEditor({ expression: "2 * ", locale: "zh-CN" });
    const view = editorView();
    act(() => view.dispatch({ selection: { anchor: 4 } }));
    fireEvent.click(screen.getByTestId("formula-insert-field-price"));
    expect(view.state.doc.toString()).toBe("2 * {price}");
    expect(screen.getByTestId("formula-preview-result").textContent).toBe("25");
    expect(screen.getByRole("button", { name: /单价/ })).toBeTruthy();
  });

  it("validates unknown functions and dependency cycles before submission", () => {
    const { validity } = renderEditor({ expression: "MISSING({price})" });
    expect(validity).toHaveBeenLastCalledWith(false);
    expect(screen.getByTestId("formula-validation").textContent).toMatch(/MISSING/);
    cleanup();
    renderEditor({
      expression: "{dependent}",
      allFields: [...fields, field("dependent", "Dependent", "{total} * 2")],
    });
    expect(screen.getByTestId("formula-validation").textContent).toMatch(/cycl/i);
  });

  it("supports empty-table constants and temporary source values without creating records", () => {
    renderEditor({ expression: "10 * 2", records: [] });
    expect(screen.getByTestId("formula-preview-result").textContent).toBe("20");
    cleanup();
    renderEditor({ records: [] });
    fireEvent.change(screen.getByLabelText("Sample value: 单价"), { target: { value: "9" } });
    fireEvent.change(screen.getByLabelText("Sample value: 数量"), { target: { value: "3" } });
    expect(screen.getByTestId("formula-preview-result").textContent).toBe("27");
  });

  it("provides keyboard function completion and keeps multiline editing available", async () => {
    renderEditor({ expression: "RO" });
    const view = editorView();
    act(() => view.dispatch({ selection: { anchor: 2 } }));
    fireEvent.keyDown(view.contentDOM, { key: " ", code: "Space", ctrlKey: true });
    await waitFor(() => expect(screen.getByRole("listbox")).toBeTruthy());
    fireEvent.keyDown(view.contentDOM, { key: "Enter", code: "Enter" });
    expect(view.state.doc.toString()).toBe("ROUND()");
    expect(view.state.selection.main.head).toBe(6);
    act(() =>
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: "ROUND(\n  {price},\n  2\n)" },
      }),
    );
    expect(screen.getByTestId("formula-preview-result").textContent).toBe("12.5");
  });

  it("keeps runtime calculation errors distinct from empty results", () => {
    renderEditor({ expression: "1 / 0" });
    expect(screen.getByTestId("formula-preview-result").textContent).toMatch(/Calculation error/);
    cleanup();
    renderEditor({ expression: "BLANK()" });
    expect(screen.getByTestId("formula-preview-result").textContent).toBe("Empty");
  });

  it("does not accept completion while a Chinese composition is in progress", () => {
    renderEditor({ expression: "RO", locale: "zh-CN" });
    const view = editorView();
    act(() => view.dispatch({ selection: { anchor: 2 } }));
    fireEvent.keyDown(view.contentDOM, { key: " ", code: "Space", ctrlKey: true });
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.compositionStart(view.contentDOM, { data: "zhong" });
    const candidateKey = new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      isComposing: true,
      keyCode: 229,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(view.contentDOM, candidateKey);
    expect(view.state.doc.toString()).toBe("RO");
    expect(candidateKey.defaultPrevented).toBe(false);
    fireEvent.compositionEnd(view.contentDOM, { data: "中" });
    // Composition is browser-owned; the committed transaction is delivered by
    // CodeMirror's input observer. Assert it survives our React-controlled loop.
    act(() =>
      view.dispatch({ changes: { from: 0, to: 2, insert: 'CONCATENATE("中文", "报价")' } }),
    );
    expect(view.state.doc.toString()).toBe('CONCATENATE("中文", "报价")');
    expect(screen.getByTestId("formula-preview-result").textContent).toBe("中文报价");
  });

  it("keeps a long multiline formula intact through editing and undo", () => {
    const terms = Array.from({ length: 100 }, (_, index) => index + 1);
    const expression = `SUM(\n${terms.join(",\n")}\n)`;
    renderEditor({ expression });
    expect(screen.getByTestId("formula-preview-result").textContent).toBe("5050");
    const view = editorView();
    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: " + 1" } }));
    expect(screen.getByTestId("formula-preview-result").textContent).toBe("5051");
    fireEvent.keyDown(view.contentDOM, { key: "z", code: "KeyZ", ctrlKey: true });
    expect(view.state.doc.toString()).toBe(expression);
    expect(screen.getByTestId("formula-preview-result").textContent).toBe("5050");
  });

  it("hides stale preview results on permission failure and allows sample retry", () => {
    const retry = vi.fn();
    const value = { expression: "{price} * {quantity}" };
    const renderProps = (error?: string) => (
      <CoreI18nProvider locale="en">
        <FormulaFieldEditor
          fields={fields}
          slug="total"
          value={value}
          onChange={vi.fn()}
          onValidityChange={vi.fn()}
          records={[record("rec_1", 12, 4)]}
          loadError={error}
          onRetry={retry}
        />
      </CoreI18nProvider>
    );
    const result = render(renderProps());
    expect(screen.getByTestId("formula-preview-result").textContent).toBe("48");
    result.rerender(renderProps("Forbidden"));
    expect(screen.getByTestId("formula-preview-result").textContent).toBe("Unavailable");
    expect(screen.queryByTestId("formula-sample-record")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("prevents field insertion and edits while saving, then restores editing", () => {
    const change = vi.fn();
    const props = (disabled: boolean) => (
      <CoreI18nProvider locale="en">
        <FormulaFieldEditor
          fields={fields}
          slug="total"
          value={{ expression: "1" }}
          onChange={change}
          onValidityChange={vi.fn()}
          records={[]}
          disabled={disabled}
        />
      </CoreI18nProvider>
    );
    const result = render(props(true));
    expect(screen.getByTestId("formula-expression").getAttribute("contenteditable")).toBe("false");
    fireEvent.click(screen.getByTestId("formula-insert-field-price"));
    expect(change).not.toHaveBeenCalled();
    result.rerender(props(false));
    expect(screen.getByTestId("formula-expression").getAttribute("contenteditable")).toBe("true");
    fireEvent.click(screen.getByTestId("formula-insert-field-price"));
    expect(change).toHaveBeenCalledOnce();
  });
});

describe("formula results", () => {
  it("formats the persisted result and explains null computation failures", () => {
    const total = field("total", "Total", "{price} / {quantity}");
    total.options.formula = {
      expression: "{price} / {quantity}",
      format: "currency",
      currency: "USD",
      precision: 2,
    };
    const row = record("rec_1", 12, 0);
    row.base = { ...base, fields: [...fields, total] };
    const result = render(
      <CoreI18nProvider locale="en">
        <FormulaValue field={total} value={24} record={row} />
      </CoreI18nProvider>,
    );
    expect(screen.getByTestId("formula-cell-value").textContent).toBe("$24.00");
    result.rerender(
      <CoreI18nProvider locale="en">
        <FormulaValue field={total} value={null} record={row} />
      </CoreI18nProvider>,
    );
    expect(screen.getByTestId("formula-cell-error").textContent).toBe("Calculation error");
    const recovered = record("rec_1", 12, 3);
    recovered.base = row.base;
    result.rerender(
      <CoreI18nProvider locale="en">
        <FormulaValue field={total} value={4} record={recovered} />
      </CoreI18nProvider>,
    );
    expect(screen.queryByTestId("formula-cell-error")).toBeNull();
    expect(screen.getByTestId("formula-cell-value").textContent).toBe("$4.00");
  });

  it("renders UTC date boundaries independently of the reader's local timezone", () => {
    const date = field("date", "Date", "NOW()");
    date.options.formula = { expression: "NOW()", format: "date" };
    const result = render(
      <CoreI18nProvider locale="en">
        <FormulaValue field={date} value="2026-10-13T23:59:59Z" />
      </CoreI18nProvider>,
    );
    expect(screen.getByTestId("formula-cell-value").textContent).toBe("10/13/2026");
    result.rerender(
      <CoreI18nProvider locale="en">
        <FormulaValue field={date} value="2026-10-14T00:00:00Z" />
      </CoreI18nProvider>,
    );
    expect(screen.getByTestId("formula-cell-value").textContent).toBe("10/14/2026");
    result.rerender(
      <CoreI18nProvider locale="en">
        <FormulaValue field={date} value="2026-10-14T00:30:00+08:00" />
      </CoreI18nProvider>,
    );
    expect(screen.getByTestId("formula-cell-value").textContent).toBe("10/13/2026");
  });
});
