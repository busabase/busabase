// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import type { ChoiceDraft } from "../helpers/select-choices";
import { SelectChoicesEditor } from "./select-choices-editor";

afterEach(cleanup);

const seed: ChoiceDraft[] = [
  { id: "todo", name: "Todo", color: "slate" },
  { id: "done", name: "Done", color: "emerald" },
];

// The dialogs own the drafts; this harness does the same and exposes them.
function Harness({
  initial = seed,
  locale = "en",
  removedNames,
}: {
  initial?: ChoiceDraft[];
  locale?: string;
  removedNames?: string[];
}) {
  const [drafts, setDrafts] = useState(initial);
  return (
    <CoreI18nProvider locale={locale}>
      <SelectChoicesEditor drafts={drafts} onChange={setDrafts} removedNames={removedNames} />
      <output data-testid="drafts">{JSON.stringify(drafts)}</output>
    </CoreI18nProvider>
  );
}

const current = (): ChoiceDraft[] => JSON.parse(screen.getByTestId("drafts").textContent ?? "[]");
const nameInputs = () => screen.getAllByRole("textbox", { name: "Choice name" });

describe("SelectChoicesEditor", () => {
  it("shows the empty hint and adds a focused blank row", () => {
    render(<Harness initial={[]} />);
    expect(screen.getByText(/No choices yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add choice" }));
    const [input] = nameInputs();
    expect(input).toBeTruthy();
    expect(document.activeElement).toBe(input);
    expect(current()).toEqual([{ id: expect.stringMatching(/^opt_/), name: "", color: "blue" }]);
  });

  it("renames in place and keeps the choice id", () => {
    render(<Harness />);
    fireEvent.change(nameInputs()[0] as HTMLElement, { target: { value: "Backlog" } });
    expect(current()[0]).toEqual({ id: "todo", name: "Backlog", color: "slate" });
  });

  it("reorders and removes by the labelled buttons", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Move choice “Done” up" }));
    expect(current().map((draft) => draft.id)).toEqual(["done", "todo"]);
    fireEvent.click(screen.getByRole("button", { name: "Remove choice “Todo”" }));
    expect(current().map((draft) => draft.id)).toEqual(["done"]);
  });

  it("disables moves past either end", () => {
    render(<Harness />);
    expect(
      (screen.getByRole("button", { name: "Move choice “Todo” up" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Move choice “Done” down" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("Enter on a filled last row starts the next one; on a blank row it does nothing", () => {
    render(<Harness />);
    fireEvent.keyDown(nameInputs()[1] as HTMLElement, { key: "Enter" });
    expect(current()).toHaveLength(3);
    expect(document.activeElement).toBe(nameInputs()[2]);
    fireEvent.keyDown(nameInputs()[2] as HTMLElement, { key: "Enter" });
    expect(current()).toHaveLength(3);
  });

  it("warns about choices the edit would remove", () => {
    render(<Harness removedNames={["Active"]} />);
    expect(screen.getByText(/^Removing: Active\./).getAttribute("role")).toBe("status");
  });

  it("renders in zh-CN", () => {
    render(<Harness locale="zh-CN" />);
    expect(screen.getByRole("button", { name: "添加选项" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "删除选项「Todo」" })).toBeTruthy();
    expect(screen.getAllByRole("textbox", { name: "选项名称" })).toHaveLength(2);
  });
});
