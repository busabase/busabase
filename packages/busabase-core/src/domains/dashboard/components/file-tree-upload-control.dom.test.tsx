// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { FileTreeUploadControl } from "./file-tree-file-actions";

Object.assign(globalThis, { React });

afterEach(cleanup);

const REPLACE_LABEL = "Replace files with the same name";

const renderControl = (onSubmit = vi.fn()) => {
  const view = render(
    <CoreI18nProvider locale="en">
      <FileTreeUploadControl
        availableFolders={["docs"]}
        defaultFolder="docs"
        existingPaths={new Set(["docs/quote.pdf"])}
        onSubmit={onSubmit}
      />
    </CoreI18nProvider>,
  );
  const input = view.container.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error("file input not rendered");
  return { input, onSubmit };
};

const pickFiles = (input: HTMLInputElement, names: string[]) => {
  const files = names.map((name) => new File(["bytes"], name, { type: "application/pdf" }));
  fireEvent.change(input, { target: { files } });
  return files;
};

const uploadNowButton = () => screen.getByRole("button", { name: "Upload now" });

describe("FileTreeUploadControl replace option", () => {
  it("blocks a same-path upload until replacement is chosen", () => {
    const { input, onSubmit } = renderControl();
    pickFiles(input, ["quote.pdf"]);

    expect(screen.getByText('A file already exists at "docs/quote.pdf".')).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: new RegExp(REPLACE_LABEL) })).toBeTruthy();
    expect(screen.getByText(/The previous version is not kept/)).toBeTruthy();
    expect(uploadNowButton().hasAttribute("disabled")).toBe(true);

    fireEvent.click(uploadNowButton());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits only the conflicting paths as replacements once opted in", async () => {
    const { input, onSubmit } = renderControl();
    const files = pickFiles(input, ["quote.pdf", "new.txt"]);

    fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(REPLACE_LABEL) }));
    expect(screen.queryByText('A file already exists at "docs/quote.pdf".')).toBeNull();
    expect(uploadNowButton().hasAttribute("disabled")).toBe(false);

    await act(async () => {
      fireEvent.click(uploadNowButton());
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(files, "docs", "immediate", ["docs/quote.pdf"]);
  });

  it("still blocks duplicate names within the selection when replacing", () => {
    const { input, onSubmit } = renderControl();
    pickFiles(input, ["quote.pdf", "quote.pdf"]);

    fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(REPLACE_LABEL) }));
    expect(screen.getByText("Two selected files would use the same Drive path.")).toBeTruthy();
    expect(uploadNowButton().hasAttribute("disabled")).toBe(true);
    fireEvent.click(uploadNowButton());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not carry the replace choice over to a new selection", () => {
    const { input } = renderControl();
    pickFiles(input, ["quote.pdf"]);
    fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(REPLACE_LABEL) }));
    expect(uploadNowButton().hasAttribute("disabled")).toBe(false);

    pickFiles(input, ["quote.pdf"]);
    expect(
      screen.getByRole("checkbox", { name: new RegExp(REPLACE_LABEL) }).getAttribute("data-state"),
    ).toBe("unchecked");
    expect(uploadNowButton().hasAttribute("disabled")).toBe(true);
  });

  it("offers no replace option when nothing conflicts", async () => {
    const { input, onSubmit } = renderControl();
    const files = pickFiles(input, ["new.txt"]);

    expect(screen.queryByRole("checkbox", { name: new RegExp(REPLACE_LABEL) })).toBeNull();
    await act(async () => {
      fireEvent.click(uploadNowButton());
    });
    expect(onSubmit).toHaveBeenCalledWith(files, "docs", "immediate", []);
  });
});
