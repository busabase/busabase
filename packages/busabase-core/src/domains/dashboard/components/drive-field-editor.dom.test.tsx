// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { AssetAttachmentRef, BaseFieldVO } from "busabase-contract/types";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { coreMessagesEn } from "../../../i18n/messages";
import { FieldValueDiff } from "./operation-diff";
import { RecordFieldInput } from "./record-views";

// The editor is exercised through `RecordFieldInput`, the record form's own
// field switch, so these tests also pin that a `drive` column gets the folder
// editor and not the flat attachment list.

const driveField: BaseFieldVO = {
  id: "fld_docs",
  slug: "docs",
  baseId: "bas_deals",
  name: "Documents",
  type: "drive",
  required: false,
  position: 1,
  options: {},
};

const ref = (id: string, fileName: string, path?: string) => ({
  id,
  assetId: id,
  url: `https://example.com/${id}`,
  fileName,
  mimeType: "application/pdf",
  size: 10,
  ...(path ? { path } : {}),
});

type Entry = ReturnType<typeof ref> & { path: string };

const uploaded = (file: File): AssetAttachmentRef =>
  ({
    id: `ast_${file.name}`,
    assetId: `ast_${file.name}`,
    url: `https://example.com/${file.name}`,
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
  }) as AssetAttachmentRef;

function renderEditor(
  initial: unknown,
  {
    field = driveField,
    upload = vi.fn(async (file: File) => uploaded(file)),
  }: {
    field?: BaseFieldVO;
    upload?: ReturnType<typeof vi.fn<(file: File) => Promise<AssetAttachmentRef>>>;
  } = {},
) {
  const changes: Entry[][] = [];
  function Harness() {
    const [value, setValue] = useState(initial);
    return (
      <RecordFieldInput
        client={{} as BusabaseDashboardApiClient}
        editorInstanceKey="rec_1"
        field={field}
        onChange={(next) => {
          changes.push(next as Entry[]);
          setValue(next);
        }}
        onUploadAttachment={upload}
        records={[]}
        value={value}
      />
    );
  }
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <CoreI18nProvider locale="en">
        <Harness />
      </CoreI18nProvider>
    </QueryClientProvider>,
  );
  const fileInput = () => view.container.querySelector('input[type="file"]') as HTMLInputElement;
  return {
    ...view,
    changes,
    upload,
    fileInput,
    pick: (...names: string[]) =>
      fireEvent.change(fileInput(), {
        target: {
          files: names.map((name) => new File(["0123456789"], name, { type: "application/pdf" })),
        },
      }),
    paths: () => (changes.at(-1) ?? []).map((entry) => entry.path).sort(),
    target: () =>
      view.container
        .querySelector("[data-drive-target-folder]")
        ?.getAttribute("data-drive-target-folder"),
  };
}

const openMenu = (name: string) =>
  fireEvent.pointerDown(screen.getByRole("button", { name }), {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });

afterEach(cleanup);

describe("drive field editor", () => {
  it("uploads into the folder selected in the tree, keeping every existing path", async () => {
    const editor = renderEditor([
      ref("a", "main.pdf", "contracts/main.pdf"),
      ref("b", "notes.txt"),
    ]);
    expect(editor.target()).toBe("");
    expect(screen.getByRole("treeitem", { name: "Drive root" }).getAttribute("aria-selected")).toBe(
      "true",
    );

    fireEvent.click(screen.getByRole("treeitem", { name: "contracts" }));
    expect(editor.target()).toBe("contracts");
    expect(screen.getByRole("treeitem", { name: "Drive root" }).getAttribute("aria-selected")).toBe(
      "false",
    );

    editor.pick("offer.pdf", "main.pdf");
    await waitFor(() => expect(editor.changes).toHaveLength(1));
    expect(editor.upload).toHaveBeenCalledTimes(2);
    // A name already taken in the folder gets a suffix instead of overwriting.
    expect(editor.paths()).toEqual([
      "contracts/main (2).pdf",
      "contracts/main.pdf",
      "contracts/offer.pdf",
      "notes.txt",
    ]);
    expect(editor.changes[0]?.find((entry) => entry.path === "notes.txt")?.id).toBe("b");
  });

  it("creates a new folder as the upload target and keeps it until files land in it", async () => {
    const editor = renderEditor([ref("b", "notes.txt")]);
    fireEvent.click(screen.getByRole("button", { name: "New folder" }));
    const name = screen.getByLabelText("New folder inside Drive root");

    fireEvent.change(name, { target: { value: "a/b" } });
    expect(screen.getByText("Enter a folder name without slashes.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Add" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(name, { target: { value: "notes.txt" } });
    expect(
      screen.getByText('Something is already at "notes.txt". Choose a different path.'),
    ).toBeTruthy();

    fireEvent.change(name, { target: { value: "Contracts 2026" } });
    fireEvent.keyDown(name, { key: "Enter" });
    expect(screen.queryByLabelText("New folder inside Drive root")).toBeNull();
    expect(screen.getByRole("treeitem", { name: "Contracts 2026" })).toBeTruthy();
    expect(editor.target()).toBe("Contracts 2026");
    expect(
      screen.getByText("Empty folders are not saved. Add files to keep this folder."),
    ).toBeTruthy();
    // A folder alone is not a value: nothing is written until a file lands in it.
    expect(editor.changes).toHaveLength(0);

    editor.pick("deal.pdf");
    await waitFor(() => expect(editor.changes).toHaveLength(1));
    expect(editor.paths()).toEqual(["Contracts 2026/deal.pdf", "notes.txt"]);
    expect(screen.queryByText("Empty folders are not saved. Add files to keep this folder.")).toBe(
      null,
    );
  });

  it("moves a file into another folder, and a rename carries the new name", () => {
    const editor = renderEditor([
      ref("a", "main.pdf", "contracts/main.pdf"),
      ref("b", "notes.txt"),
    ]);

    openMenu("Actions for notes.txt");
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename or move" }));
    const dialog = screen.getByTestId("drive-path-dialog");
    const path = within(dialog).getByLabelText("File path") as HTMLInputElement;
    expect(path.value).toBe("notes.txt");
    fireEvent.change(path, { target: { value: "contracts/notes.txt" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));

    expect(screen.queryByTestId("drive-path-dialog")).toBeNull();
    expect(editor.paths()).toEqual(["contracts/main.pdf", "contracts/notes.txt"]);
    const moved = editor.changes.at(-1)?.find((entry) => entry.id === "b");
    expect(moved?.fileName).toBe("notes.txt");

    openMenu("Actions for main.pdf");
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename or move" }));
    fireEvent.change(within(screen.getByTestId("drive-path-dialog")).getByLabelText("File path"), {
      target: { value: "contracts/agreement.pdf" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    const renamed = editor.changes.at(-1)?.find((entry) => entry.id === "a");
    expect(renamed).toMatchObject({ path: "contracts/agreement.pdf", fileName: "agreement.pdf" });
  });

  it("refuses a move onto a taken path with a visible reason and writes nothing", () => {
    const editor = renderEditor([ref("a", "main.pdf", "contracts/main.pdf"), ref("b", "main.pdf")]);

    // Two files share the name; folders list first, so the root one is the second row.
    const menus = screen.getAllByRole("button", { name: "Actions for main.pdf" });
    expect(menus).toHaveLength(2);
    fireEvent.pointerDown(menus[1] as HTMLElement, {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename or move" }));
    const dialog = screen.getByTestId("drive-path-dialog");
    const path = within(dialog).getByLabelText("File path") as HTMLInputElement;
    expect(path.value).toBe("main.pdf");

    fireEvent.change(path, { target: { value: "contracts/main.pdf" } });
    expect(
      within(dialog).getByText(
        'Something is already at "contracts/main.pdf". Choose a different path.',
      ),
    ).toBeTruthy();
    const apply = within(dialog).getByRole("button", { name: "Apply" }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    fireEvent.keyDown(path, { key: "Enter" });
    fireEvent.click(apply);
    expect(screen.getByTestId("drive-path-dialog")).toBeTruthy();
    expect(editor.changes).toHaveLength(0);

    // A file where a folder already is, is the same refusal.
    fireEvent.change(path, { target: { value: "contracts" } });
    expect(
      within(dialog).getByText('Something is already at "contracts". Choose a different path.'),
    ).toBeTruthy();
    expect(editor.changes).toHaveLength(0);
  });

  it("refuses to move a folder into itself", () => {
    const editor = renderEditor([ref("a", "main.pdf", "contracts/main.pdf")]);
    openMenu("Actions for folder contracts");
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename or move folder" }));
    const dialog = screen.getByTestId("drive-path-dialog");
    fireEvent.change(within(dialog).getByLabelText("Folder path"), {
      target: { value: "contracts/old" },
    });
    expect(within(dialog).getByText("A folder cannot be moved into itself.")).toBeTruthy();

    fireEvent.change(within(dialog).getByLabelText("Folder path"), {
      target: { value: "archive/contracts" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    expect(editor.paths()).toEqual(["archive/contracts/main.pdf"]);
  });

  it("moves a folder's contents to the root when its path is cleared, as the hint says", () => {
    const editor = renderEditor([
      ref("a", "main.pdf", "contracts/main.pdf"),
      ref("b", "notes.txt"),
    ]);
    openMenu("Actions for folder contracts");
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename or move folder" }));
    const dialog = screen.getByTestId("drive-path-dialog");
    expect(
      within(dialog).getByText(/Leave it empty to move its contents to the root/),
    ).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText("Folder path"), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    expect(editor.paths()).toEqual(["main.pdf", "notes.txt"]);
  });

  it("removes a folder and everything under it only after confirming", () => {
    const editor = renderEditor([
      ref("a", "main.pdf", "contracts/2026/main.pdf"),
      ref("c", "old.pdf", "contracts/old.pdf"),
      ref("b", "notes.txt"),
    ]);
    fireEvent.click(screen.getByRole("treeitem", { name: "2026" }));
    expect(editor.target()).toBe("contracts/2026");

    openMenu("Actions for folder contracts");
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove folder" }));
    let confirm = screen.getByRole("dialog", { name: "Remove folder" });
    expect(
      within(confirm).getByText(
        'This removes "contracts" and the 2 files in it from this field. Nothing changes until you save the record.',
      ),
    ).toBeTruthy();
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(editor.changes).toHaveLength(0);

    openMenu("Actions for folder contracts");
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove folder" }));
    confirm = screen.getByRole("dialog", { name: "Remove folder" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Remove folder" }));
    expect(editor.paths()).toEqual(["notes.txt"]);
    // The target folder went with it, so uploads go back to the root.
    expect(editor.target()).toBe("");
    expect(screen.queryByRole("treeitem", { name: "contracts" })).toBeNull();
  });

  it("removes one file straight away", () => {
    const editor = renderEditor([
      ref("a", "main.pdf", "contracts/main.pdf"),
      ref("b", "notes.txt"),
    ]);
    openMenu("Actions for notes.txt");
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove from Drive" }));
    expect(editor.paths()).toEqual(["contracts/main.pdf"]);
  });

  it("honours the field's file limits exactly like an attachment column", async () => {
    const upload = vi.fn(async (file: File) => uploaded(file));
    const editor = renderEditor([ref("a", "main.pdf", "contracts/main.pdf")], {
      field: {
        ...driveField,
        options: {
          attachment: { maxFiles: 1, allowedMimeTypes: ["application/pdf"], maxFileSize: 4 },
        },
      },
      upload,
    });
    expect(editor.fileInput().accept).toBe("application/pdf");
    expect(editor.fileInput().multiple).toBe(false);

    // Larger than the field's own limit: refused inline before anything uploads.
    editor.pick("big.pdf");
    await waitFor(() =>
      expect(editor.container.querySelector("p.text-destructive")?.textContent).toBeTruthy(),
    );
    expect(upload).not.toHaveBeenCalled();
    expect(editor.changes).toHaveLength(0);
  });

  it("replaces the only file of a one-file drive field, in the target folder", async () => {
    const editor = renderEditor([ref("a", "main.pdf", "contracts/main.pdf")], {
      field: { ...driveField, options: { attachment: { maxFiles: 1 } } },
    });
    fireEvent.click(screen.getByRole("treeitem", { name: "contracts" }));
    editor.pick("new.pdf");
    await waitFor(() => expect(editor.changes).toHaveLength(1));
    expect(editor.paths()).toEqual(["contracts/new.pdf"]);
  });
});

describe("drive field in a change-request review", () => {
  it("shows a moved file as a change of its path, not the same file name twice", () => {
    const view = render(
      <CoreI18nProvider locale="en">
        <FieldValueDiff
          change={{
            slug: "docs",
            label: "Documents",
            status: "changed",
            beforeValue: [ref("a", "main.pdf", "main.pdf")],
            afterValue: [ref("a", "main.pdf", "contracts/main.pdf")],
          }}
          field={driveField}
          messages={coreMessagesEn}
        />
      </CoreI18nProvider>,
    );
    const lists = view.container.querySelectorAll("[data-drive-field-paths]");
    expect([...lists].map((list) => list.textContent)).toEqual(["main.pdf", "contracts/main.pdf"]);
  });
});
