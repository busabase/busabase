// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ApiKeyPermissionLevel } from "busabase-contract/access-control/api-key-level";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { BaseFieldVO, BaseVO, RecordVO } from "busabase-contract/types";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import type { RecordCellUpdateResult, UpdateRecordCell } from "../hooks/use-base-grid-editing";
import { SubmitPermissionProvider } from "./split-submit-button";

vi.mock("wouter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wouter")>()),
  useSearch: () => "space=shop",
  useLocation: () => ["/base/products", vi.fn()],
}));
vi.mock("openlib/ui/dashboard", () => ({
  useAddDemoParam: () => (href: string) => href,
  SPALink: ({ children, ...props }: { children: ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ scrollMargin }: { scrollMargin: number }) => ({
    getTotalSize: () => 4848,
    getVirtualItems: () => [{ index: 0, start: scrollMargin }],
    options: { scrollMargin },
  }),
}));

const { BusaBaseTable } = await import("./base-table");

const field = (
  slug: string,
  type: BaseFieldVO["type"],
  options: BaseFieldVO["options"] = {},
  extra: Partial<BaseFieldVO> = {},
): BaseFieldVO => ({
  id: `fld_${slug}`,
  baseId: "bas_products",
  slug,
  name: slug[0]?.toUpperCase() + slug.slice(1),
  type,
  required: false,
  position: 0,
  options,
  ...extra,
});

const fields = [
  field("name", "text"),
  field("price", "number", { number: { format: "currency", currency: "USD", locale: "en-US" } }),
  field("status", "select", {
    choices: [
      { id: "chc_draft", name: "Draft", color: "gray" },
      { id: "chc_live", name: "Live", color: "green" },
    ],
  }),
  field("stocked", "checkbox"),
  field("launch", "date"),
  field("notes", "longtext"),
  field("owner", "member", { multiple: false }),
  field("sku", "text"),
];

const base: BaseVO = {
  id: "bas_products",
  nodeId: "nod_products",
  slug: "products",
  name: "Products",
  description: "",
  reviewPolicy: { kind: "single", requiredApprovals: 1 },
  createdAt: "2026-11-01T00:00:00Z",
  fields,
};

const relation = field("related", "relation", { targetBaseId: "bas_related", multiple: true });
const relatedBase = {
  ...base,
  id: "bas_related",
  slug: "related-records",
  fields: [field("name", "text")],
} as BaseVO;
const baseWithRelation = { ...base, fields: [...fields, relation] } as BaseVO;

const makeRecord = (
  id: string,
  payload: Record<string, unknown>,
  headCommitId = `cmt_${id}`,
): RecordVO => ({
  id,
  baseId: base.id,
  headCommitId,
  parentRecordId: null,
  parentCommitId: null,
  status: "active",
  createdBy: "usr_owner",
  archivedAt: null,
  createdAt: base.createdAt,
  updatedAt: base.createdAt,
  base,
  headCommit: {
    id: headCommitId,
    baseId: base.id,
    targetType: "base",
    nodeId: null,
    operationId: null,
    parentCommitId: null,
    payload,
    operation: "record_create",
    message: "",
    author: "usr_owner",
    createdAt: base.createdAt,
  },
});

const robot = makeRecord("rec_robot", {
  name: "Walking Robot Buddy",
  price: 24,
  status: "chc_draft",
  stocked: false,
  launch: "2026-11-20",
  notes: "Long description",
  sku: "TT-ROBOT",
  owner: "usr_alice",
});
const blocks = makeRecord("rec_blocks", {
  name: "Rainbow Stacking Blocks",
  price: 18.5,
  status: "chc_live",
  stocked: true,
  launch: "",
  notes: "",
  sku: "TT-BLOCKS",
  owner: "",
});
const relatedRecord = {
  ...makeRecord("rec_related", { name: "Related record" }),
  baseId: relatedBase.id,
  base: relatedBase,
} as RecordVO;

const merged = (headCommitId = "cmt_after"): RecordCellUpdateResult => ({
  materialized: true,
  headCommitId,
});

function harness(level: ApiKeyPermissionLevel, children: ReactNode) {
  return (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <CoreI18nProvider locale="en">
        <SubmitPermissionProvider permissionLevel={level}>{children}</SubmitPermissionProvider>
      </CoreI18nProvider>
    </QueryClientProvider>
  );
}

function renderGrid({
  level = "write",
  records = [robot, blocks],
  ...props
}: Partial<ComponentProps<typeof BusaBaseTable>> & { level?: ApiKeyPermissionLevel } = {}) {
  const onUpdateRecordCell =
    props.onUpdateRecordCell ?? vi.fn<UpdateRecordCell>(async () => merged());
  const onOpenRecord = props.onOpenRecord ?? vi.fn();
  const client =
    props.client ??
    ({
      listSpaceMembers: vi.fn().mockResolvedValue([
        { id: "usr_alice", name: "Alice", email: "alice@example.com", image: null, role: null },
        { id: "usr_bob", name: "Bob", email: "bob@example.com", image: null, role: null },
      ]),
    } as unknown as BusabaseDashboardApiClient);
  const element = (rows: RecordVO[]) =>
    harness(
      level,
      <BusaBaseTable
        activeView={null}
        base={base}
        client={client}
        onCreateView={vi.fn()}
        onDeleteView={vi.fn()}
        onUpdateView={vi.fn()}
        records={rows}
        scrollElementRef={{ current: null }}
        views={[]}
        {...props}
        onOpenRecord={onOpenRecord}
        onUpdateRecordCell={onUpdateRecordCell}
      />,
    );
  const result = render(element(records));
  return {
    ...result,
    onOpenRecord,
    onUpdateRecordCell: onUpdateRecordCell as ReturnType<typeof vi.fn<UpdateRecordCell>>,
    rerenderRecords: (rows: RecordVO[]) => result.rerender(element(rows)),
  };
}

const cell = (container: HTMLElement, recordId: string, slug: string) => {
  const found = container.querySelector<HTMLElement>(`[data-grid-cell="${recordId}::${slug}"]`);
  if (!found) throw new Error(`no cell ${recordId}/${slug}`);
  return found;
};

const editorInput = (target: HTMLElement) => {
  const input = target.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    "[data-inline-cell-editor] input, [data-inline-cell-editor] textarea",
  );
  if (!input) throw new Error("no editor open");
  return input;
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("selecting and moving between cells", () => {
  it("selects an editable cell on click instead of opening the record", () => {
    const { container, onOpenRecord } = renderGrid();
    const price = cell(container, robot.id, "price");
    expect(price.getAttribute("aria-readonly")).toBe("false");
    expect(price.querySelector("a")).toBeNull();
    fireEvent.focus(price);
    fireEvent.click(price);
    expect(onOpenRecord).not.toHaveBeenCalled();
    expect(price.tabIndex).toBe(0);
    expect(price.className).toContain("ring-primary");
  });

  it("edits the frozen title cell and renders record expansion within the first field", () => {
    const { container, onOpenRecord, onUpdateRecordCell } = renderGrid();
    const title = cell(container, robot.id, "name");
    expect(title.getAttribute("aria-readonly")).toBe("false");
    const expand = within(title).getByRole("button", {
      name: "Open: Walking Robot Buddy",
    });
    expect(expand.parentElement).toBe(title);
    fireEvent.doubleClick(title);
    const input = editorInput(title);
    fireEvent.change(input, { target: { value: "Walking Robot Buddy v2" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onUpdateRecordCell).toHaveBeenCalledWith(
      robot,
      "name",
      "Walking Robot Buddy v2",
      expect.anything(),
    );

    fireEvent.click(expand);
    expect(onOpenRecord).toHaveBeenCalledWith(robot);
  });

  it("opens an Airtable-style member menu and saves the selected person", async () => {
    const { container, onOpenRecord, onUpdateRecordCell } = renderGrid();
    const owner = cell(container, robot.id, "owner");
    expect(owner.getAttribute("aria-readonly")).toBe("false");

    fireEvent.click(owner);
    expect(await screen.findByRole("listbox", { name: "Owner" })).toBeTruthy();
    expect(onOpenRecord).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("option", { name: /Bob/ }));

    expect(onUpdateRecordCell).toHaveBeenCalledWith(robot, "owner", "usr_bob", {
      baseCommitId: robot.headCommitId,
      mergeImmediately: true,
    });
    await waitFor(() => expect(owner.textContent).toContain("Bob"));
  });

  it("keeps a required member session cancellable after clearing it fails validation", async () => {
    const requiredOwner = field("owner", "member", { multiple: false }, { required: true });
    const requiredBase = {
      ...base,
      fields: fields.map((current) => (current.slug === "owner" ? requiredOwner : current)),
    };
    const requiredRobot = { ...robot, base: requiredBase };
    const { container, onUpdateRecordCell } = renderGrid({
      base: requiredBase,
      records: [requiredRobot],
    });
    const owner = cell(container, requiredRobot.id, "owner");

    fireEvent.click(owner);
    fireEvent.click(await screen.findByRole("option", { name: "Unassigned" }));
    expect(screen.getByRole("alert").textContent).toContain("required");

    fireEvent.keyDown(screen.getByRole("searchbox", { name: "Search members - Owner" }), {
      key: "Escape",
    });
    await waitFor(() => expect(owner.querySelector("[data-inline-cell-editor]")).toBeNull());
    expect(onUpdateRecordCell).not.toHaveBeenCalled();
  });

  it("does not assign the first member while an IME confirms search text", async () => {
    const { container, onUpdateRecordCell } = renderGrid();
    const owner = cell(container, robot.id, "owner");

    fireEvent.click(owner);
    const search = await screen.findByRole("searchbox", { name: "Search members - Owner" });
    fireEvent.keyDown(search, { isComposing: true, key: "Enter", keyCode: 229 });

    expect(onUpdateRecordCell).not.toHaveBeenCalled();
    expect(owner.querySelector("[data-inline-cell-editor]")).not.toBeNull();
  });

  it("lets a multi-member editor remove a selected former member", async () => {
    const members = field("owner", "member", { multiple: true });
    const memberBase = {
      ...base,
      fields: fields.map((current) => (current.slug === "owner" ? members : current)),
    };
    const memberRobot = {
      ...robot,
      base: memberBase,
      fieldUsers: {
        usr_former: {
          id: "usr_former",
          name: "Former Teammate",
          email: "former@example.com",
          image: null,
          role: null,
        },
      },
      headCommit: {
        ...robot.headCommit,
        payload: { ...robot.headCommit.payload, owner: ["usr_former"] },
      },
    };
    const { container } = renderGrid({ base: memberBase, records: [memberRobot] });
    const owner = cell(container, memberRobot.id, "owner");

    fireEvent.click(owner);
    fireEvent.click(screen.getByRole("button", { name: "Remove Former Teammate" }));

    expect(screen.queryByRole("button", { name: "Remove Former Teammate" })).toBeNull();
  });

  it("suppresses member candidates when loading the roster fails", async () => {
    const client = {
      listSpaceMembers: vi.fn().mockRejectedValue({ code: "FORBIDDEN" }),
    } as unknown as BusabaseDashboardApiClient;
    const { container, onUpdateRecordCell } = renderGrid({ client });
    const owner = cell(container, robot.id, "owner");

    fireEvent.click(owner);
    expect((await screen.findByRole("alert")).textContent).toContain("do not have permission");
    expect(screen.queryByRole("option")).toBeNull();
    fireEvent.keyDown(screen.getByRole("searchbox", { name: "Search members - Owner" }), {
      key: "Enter",
    });
    expect(onUpdateRecordCell).not.toHaveBeenCalled();
  });

  it("expands the selected primary-field record with Space", () => {
    const { container, onOpenRecord } = renderGrid();
    const title = cell(container, robot.id, "name");
    act(() => title.focus());
    fireEvent.keyDown(title, { key: " " });
    expect(onOpenRecord).toHaveBeenCalledWith(robot);
  });

  it("moves with the arrow keys and Tab, and Space opens the record", () => {
    const { container, onOpenRecord } = renderGrid();
    const price = cell(container, robot.id, "price");
    act(() => price.focus());
    fireEvent.keyDown(price, { key: "ArrowRight" });
    expect(document.activeElement).toBe(cell(container, robot.id, "status"));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowDown" });
    expect(document.activeElement).toBe(cell(container, blocks.id, "status"));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(cell(container, blocks.id, "price"));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowUp" });
    expect(document.activeElement).toBe(price);
    fireEvent.keyDown(price, { key: " " });
    expect(onOpenRecord).toHaveBeenCalledWith(robot);
  });

  it("lets Tab leave the grid at the end of a row instead of trapping focus", () => {
    const { container } = renderGrid();
    const last = cell(container, robot.id, "sku");
    act(() => last.focus());
    const event = fireEvent.keyDown(last, { key: "Tab" });
    // Not prevented: the browser moves focus on, out of the row.
    expect(event).toBe(true);
  });
});

describe("attachment cells", () => {
  const attachmentField = field("files", "attachment");
  const attachmentRecord = makeRecord("rec_attachment", {
    ...robot.headCommit.payload,
    files: [],
  });

  it("uploads a picked file and saves its asset ref through the cell update path", async () => {
    const uploaded = {
      id: "ast_uploaded",
      assetId: "ast_uploaded",
      attachmentId: "att_uploaded",
      fileName: "release-notes.txt",
      mimeType: "text/plain",
      size: 12,
      url: "/api/assets/ast_uploaded/raw",
    };
    const onUploadAttachment = vi.fn(async () => uploaded);
    const onUpdateRecordCell = vi.fn<UpdateRecordCell>(async () => merged());
    const { container } = renderGrid({
      base: { ...base, fields: [...fields, attachmentField] },
      onUpdateRecordCell,
      onUploadAttachment,
      records: [attachmentRecord],
    });
    const target = cell(container, attachmentRecord.id, "files");

    expect(target.getAttribute("aria-readonly")).toBe("false");
    expect(within(target).queryByRole("button", { name: "Add file" })).toBeNull();
    fireEvent.click(target);
    const uploadButton = within(target).getByRole("button", { name: "Add file" });
    expect(uploadButton.querySelector("svg.lucide-paperclip")).toBeTruthy();
    const pickerClick = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(uploadButton);
    expect(pickerClick).toHaveBeenCalledTimes(1);
    const input = within(target).getByLabelText("Files") as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(["release notes"], "release-notes.txt", { type: "text/plain" })] },
    });

    await waitFor(() => expect(onUploadAttachment).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(onUpdateRecordCell).toHaveBeenCalledWith(
        attachmentRecord,
        "files",
        [uploaded],
        expect.objectContaining({
          baseCommitId: attachmentRecord.headCommitId,
          mergeImmediately: true,
        }),
      ),
    );
  });

  it("keeps attachment cells read-only when the host did not provide an uploader", () => {
    const { container } = renderGrid({
      base: { ...base, fields: [...fields, attachmentField] },
      records: [attachmentRecord],
    });

    expect(cell(container, attachmentRecord.id, "files").getAttribute("aria-readonly")).toBe(
      "true",
    );
  });
});

describe("relation cells", () => {
  it("keeps the add button first and retains an invalid required draft until corrected or cancelled", async () => {
    const row = makeRecord(robot.id, { ...robot.headCommit.payload, related: [relatedRecord.id] });
    const onUpdateRecordCell = vi.fn<UpdateRecordCell>(async () => merged());
    const client = {
      getBase: vi.fn(async () => relatedBase),
      listSpaceMembers: vi.fn().mockResolvedValue([]),
      listRecordsPage: vi.fn(async () => ({ records: [relatedRecord], totalPages: 1 })),
    } as unknown as BusabaseDashboardApiClient;
    const { container } = renderGrid({
      base: { ...baseWithRelation, fields: [...fields, { ...relation, required: true }] },
      client,
      records: [row],
      relationRecords: [relatedRecord],
      onUpdateRecordCell,
    });
    const target = cell(container, row.id, "related");
    const add = within(target).getByRole("button", { name: "Add link" });
    expect(target.firstElementChild).toBe(add);
    fireEvent.click(add);
    fireEvent.click(await screen.findByRole("button", { name: "Remove link to Related record" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Now" }));
    expect(screen.getByRole("alert").textContent).toMatch(/required/i);
    expect(onUpdateRecordCell).not.toHaveBeenCalled();
    fireEvent.focusIn(document.body);
    expect(screen.getByRole("searchbox")).toBeTruthy();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Related record" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Now" }));
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(onUpdateRecordCell).not.toHaveBeenCalled();
    fireEvent.click(within(target).getByRole("button", { name: "Add link" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove link to Related record" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("searchbox")).toBeNull();
    fireEvent.click(within(target).getByRole("button", { name: "Add link" }));
    expect(screen.getByRole("button", { name: "Remove link to Related record" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onUpdateRecordCell).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "saves a relation draft through the normal record update (reverse: %s)",
    async (reverse) => {
      const row = makeRecord(robot.id, { ...robot.headCommit.payload, related: [] });
      const onUpdateRecordCell = vi.fn<UpdateRecordCell>(async () => merged());
      const client = {
        getBase: vi.fn(async () => relatedBase),
        listSpaceMembers: vi.fn().mockResolvedValue([]),
        listRecordsPage: vi.fn(async () => ({
          records: [relatedRecord],
          total: 1,
          totalPages: 1,
          page: 1,
        })),
      } as unknown as BusabaseDashboardApiClient;
      const { container } = renderGrid({
        base: reverse
          ? {
              ...baseWithRelation,
              fields: [
                ...fields,
                { ...relation, options: { ...relation.options, reverseOfFieldId: "forward" } },
              ],
            }
          : baseWithRelation,
        client,
        onUpdateRecordCell,
        records: [row],
        relationRecords: [relatedRecord],
      });
      const relationCell = cell(container, row.id, "related");

      fireEvent.click(relationCell);
      expect(screen.queryByRole("searchbox")).toBeNull();
      fireEvent.doubleClick(relationCell);
      expect(screen.queryByRole("searchbox")).toBeNull();
      fireEvent.click(within(relationCell).getByRole("button", { name: "Add link" }));
      fireEvent.click(await screen.findByRole("checkbox", { name: /Related record/ }));
      expect(onUpdateRecordCell).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Save Now" }));

      await waitFor(() =>
        expect(onUpdateRecordCell).toHaveBeenCalledWith(row, "related", [relatedRecord.id], {
          baseCommitId: row.headCommitId,
          mergeImmediately: true,
        }),
      );
    },
  );

  it.each([false, true])(
    "submits a relation selection for review without direct save access (reverse: %s)",
    async (reverse) => {
      const row = makeRecord(robot.id, { ...robot.headCommit.payload, related: [] });
      const onUpdateRecordCell = vi.fn<UpdateRecordCell>(async () => ({
        materialized: false,
        changeRequestId: "crq_related",
      }));
      const client = {
        getBase: vi.fn(async () => relatedBase),
        listSpaceMembers: vi.fn().mockResolvedValue([]),
        listRecordsPage: vi.fn(async () => ({
          records: [relatedRecord],
          total: 1,
          totalPages: 1,
          page: 1,
        })),
      } as unknown as BusabaseDashboardApiClient;
      const { container } = renderGrid({
        base: reverse
          ? {
              ...baseWithRelation,
              fields: [
                ...fields,
                { ...relation, options: { ...relation.options, reverseOfFieldId: "forward" } },
              ],
            }
          : baseWithRelation,
        client,
        level: "changeRequest",
        onUpdateRecordCell,
        records: [row],
        relationRecords: [relatedRecord],
      });

      fireEvent.click(
        within(cell(container, row.id, "related")).getByRole("button", { name: "Add link" }),
      );
      fireEvent.click(await screen.findByRole("checkbox", { name: /Related record/ }));
      fireEvent.click(screen.getByRole("button", { name: "Save as Change Request" }));

      await waitFor(() =>
        expect(onUpdateRecordCell).toHaveBeenCalledWith(row, "related", [relatedRecord.id], {
          baseCommitId: row.headCommitId,
          mergeImmediately: false,
        }),
      );
    },
  );
});

describe("editing a number (the price cell)", () => {
  it("double-click → type → Enter saves one field, pinned to the head it opened on", async () => {
    let resolve: (value: RecordCellUpdateResult) => void = () => undefined;
    const onUpdateRecordCell = vi.fn<UpdateRecordCell>(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const { container } = renderGrid({ onUpdateRecordCell });
    const price = cell(container, robot.id, "price");
    expect(price.textContent).toContain("$24.00");
    fireEvent.doubleClick(price);
    const input = editorInput(price);
    expect(input.value).toBe("24");
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "$129.50" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onUpdateRecordCell).toHaveBeenCalledTimes(1);
    expect(onUpdateRecordCell).toHaveBeenCalledWith(robot, "price", 129.5, {
      baseCommitId: robot.headCommitId,
      mergeImmediately: true,
    });
    // Optimistic: the new price shows while the write is in flight.
    expect(price.querySelector("[data-inline-cell-editor]")).toBeNull();
    expect(price.textContent).toContain("$129.50");
    expect(price.querySelector('[data-inline-cell-status="saving"]')).not.toBeNull();
    await act(async () => resolve(merged()));
    expect(price.textContent).toContain("$129.50");
    expect(price.querySelector("[data-inline-cell-status]")).toBeNull();
  });

  it("starts editing by typing, replacing the value", () => {
    const { container, onUpdateRecordCell } = renderGrid();
    const price = cell(container, robot.id, "price");
    act(() => price.focus());
    fireEvent.keyDown(price, { key: "9" });
    const input = editorInput(price);
    expect(input.value).toBe("9");
    fireEvent.change(input, { target: { value: "99" } });
    fireEvent.keyDown(input, { key: "Tab" });
    expect(onUpdateRecordCell).toHaveBeenCalledWith(robot, "price", 99, expect.anything());
    // Tab saved and moved right.
    return waitFor(() => expect(document.activeElement).toBe(cell(container, robot.id, "status")));
  });

  it("Esc cancels without writing anything", () => {
    const { container, onUpdateRecordCell } = renderGrid();
    const price = cell(container, robot.id, "price");
    act(() => price.focus());
    fireEvent.keyDown(price, { key: "Enter" });
    const input = editorInput(price);
    fireEvent.change(input, { target: { value: "1000" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(price.querySelector("[data-inline-cell-editor]")).toBeNull();
    expect(price.textContent).toContain("$24.00");
    expect(onUpdateRecordCell).not.toHaveBeenCalled();
  });

  it("shows a validation error in the cell and keeps the draft", () => {
    const { container, onUpdateRecordCell } = renderGrid();
    const price = cell(container, robot.id, "price");
    fireEvent.doubleClick(price);
    const input = editorInput(price);
    fireEvent.change(input, { target: { value: "twelve" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onUpdateRecordCell).not.toHaveBeenCalled();
    expect(within(price).getByRole("alert").textContent).toBe(
      "Enter a number, like 129 or 129.50.",
    );
    expect(editorInput(price).value).toBe("twelve");
    expect(editorInput(price).getAttribute("aria-invalid")).toBe("true");
  });

  it("does not write when the value did not change", () => {
    const { container, onUpdateRecordCell } = renderGrid();
    const price = cell(container, robot.id, "price");
    fireEvent.doubleClick(price);
    fireEvent.keyDown(editorInput(price), { key: "Enter" });
    expect(onUpdateRecordCell).not.toHaveBeenCalled();
  });

  it("rolls the cell back and says why when the save fails", async () => {
    const onUpdateRecordCell = vi.fn<UpdateRecordCell>(async () => {
      throw new Error("Record changed since you opened it");
    });
    const { container } = renderGrid({ onUpdateRecordCell });
    const price = cell(container, robot.id, "price");
    fireEvent.doubleClick(price);
    fireEvent.change(editorInput(price), { target: { value: "30" } });
    fireEvent.keyDown(editorInput(price), { key: "Enter" });
    await waitFor(() => expect(price.textContent).toContain("$24.00"));
    expect(price.querySelector('[data-inline-cell-status="error"]')).not.toBeNull();
    expect(screen.getByTestId("inline-edit-notice").textContent).toContain(
      "Couldn't save Price: Record changed since you opened it",
    );
  });

  it("keeps the draft and the original head through a live refresh", () => {
    const { container, onUpdateRecordCell, rerenderRecords } = renderGrid();
    fireEvent.doubleClick(cell(container, robot.id, "price"));
    fireEvent.change(editorInput(cell(container, robot.id, "price")), {
      target: { value: "31" },
    });
    // Someone else changes another field; the list refreshes under the editor.
    const refreshed = makeRecord(
      robot.id,
      { ...robot.headCommit.payload, sku: "TT-ROBOT-2" },
      "cmt_someone_else",
    );
    rerenderRecords([refreshed, blocks]);
    const price = cell(container, robot.id, "price");
    expect(editorInput(price).value).toBe("31");
    fireEvent.keyDown(editorInput(price), { key: "Enter" });
    // Pinned to the head the editor opened on: the server three-way merges the
    // other field, and refuses a conflicting change to THIS one by name.
    expect(onUpdateRecordCell).toHaveBeenCalledWith(refreshed, "price", 31, {
      baseCommitId: robot.headCommitId,
      mergeImmediately: true,
    });
  });

  it("keeps different cells pinned to the versions their editors opened on", async () => {
    const onUpdateRecordCell = vi
      .fn<UpdateRecordCell>()
      .mockResolvedValueOnce(merged("cmt_after_price"))
      .mockResolvedValueOnce(merged("cmt_after_sku"));
    const { container } = renderGrid({ onUpdateRecordCell });
    fireEvent.doubleClick(cell(container, robot.id, "price"));
    fireEvent.change(editorInput(cell(container, robot.id, "price")), {
      target: { value: "25" },
    });
    fireEvent.keyDown(editorInput(cell(container, robot.id, "price")), { key: "Enter" });
    fireEvent.doubleClick(cell(container, robot.id, "sku"));
    fireEvent.change(editorInput(cell(container, robot.id, "sku")), {
      target: { value: "TT-ROBOT-XL" },
    });
    fireEvent.keyDown(editorInput(cell(container, robot.id, "sku")), { key: "Enter" });
    await waitFor(() => expect(onUpdateRecordCell).toHaveBeenCalledTimes(2));
    expect(onUpdateRecordCell.mock.calls[1]?.[3]).toEqual({
      baseCommitId: robot.headCommitId,
      mergeImmediately: true,
    });
    expect(cell(container, robot.id, "sku").textContent).toContain("TT-ROBOT-XL");
  });

  it("chains three queued edits of the same cell onto its own merged heads", async () => {
    let resolve: (value: RecordCellUpdateResult) => void = () => undefined;
    const onUpdateRecordCell = vi
      .fn<UpdateRecordCell>()
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      )
      .mockResolvedValueOnce(merged("cmt_second_price"))
      .mockResolvedValueOnce(merged("cmt_third_price"));
    const { container } = renderGrid({ onUpdateRecordCell });
    const price = cell(container, robot.id, "price");
    for (const value of ["25", "26", "27"]) {
      fireEvent.doubleClick(price);
      fireEvent.change(editorInput(price), { target: { value } });
      fireEvent.keyDown(editorInput(price), { key: "Enter" });
    }
    expect(onUpdateRecordCell).toHaveBeenCalledTimes(1);
    await act(async () => resolve(merged("cmt_first_price")));
    await waitFor(() => expect(onUpdateRecordCell).toHaveBeenCalledTimes(3));
    expect(onUpdateRecordCell.mock.calls.map((call) => call[3].baseCommitId)).toEqual([
      robot.headCommitId,
      "cmt_first_price",
      "cmt_second_price",
    ]);
    expect(price.textContent).toContain("$27.00");
  });

  it("does not rebase a queued cell over a concurrent change merged by another cell", async () => {
    let resolve: (value: RecordCellUpdateResult) => void = () => undefined;
    const onUpdateRecordCell = vi
      .fn<UpdateRecordCell>()
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      )
      .mockRejectedValueOnce(new Error("Conflicting field: sku"));
    const { container, rerenderRecords } = renderGrid({ onUpdateRecordCell });
    const price = cell(container, robot.id, "price");
    fireEvent.doubleClick(price);
    fireEvent.change(editorInput(price), { target: { value: "25" } });
    fireEvent.keyDown(editorInput(price), { key: "Enter" });
    const sku = cell(container, robot.id, "sku");
    fireEvent.doubleClick(sku);
    fireEvent.change(editorInput(sku), { target: { value: "MY-SKU" } });
    fireEvent.keyDown(editorInput(sku), { key: "Enter" });
    const refreshed = makeRecord(
      robot.id,
      { ...robot.headCommit.payload, price: 25, sku: "THEIR-SKU" },
      "cmt_price_merged_with_their_sku",
    );
    rerenderRecords([refreshed, blocks]);
    await act(async () => resolve(merged(refreshed.headCommitId)));
    await waitFor(() => expect(onUpdateRecordCell).toHaveBeenCalledTimes(2));
    expect(onUpdateRecordCell.mock.calls[1]?.[3]).toEqual({
      baseCommitId: robot.headCommitId,
      mergeImmediately: true,
    });
    expect(sku.textContent).toContain("THEIR-SKU");
    expect(screen.getByTestId("inline-edit-notice").textContent).toContain(
      "Conflicting field: sku",
    );
  });

  it("pins a queued checkbox to the version visible when it was toggled", async () => {
    let resolve: (value: RecordCellUpdateResult) => void = () => undefined;
    const onUpdateRecordCell = vi
      .fn<UpdateRecordCell>()
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      )
      .mockResolvedValueOnce(merged("cmt_after_checkbox"));
    const { container, rerenderRecords } = renderGrid({ onUpdateRecordCell });
    const price = cell(container, robot.id, "price");
    fireEvent.doubleClick(price);
    fireEvent.change(editorInput(price), { target: { value: "25" } });
    fireEvent.keyDown(editorInput(price), { key: "Enter" });
    fireEvent.click(within(cell(container, robot.id, "stocked")).getByRole("checkbox"));
    rerenderRecords([
      makeRecord(robot.id, { ...robot.headCommit.payload, stocked: true }, "cmt_other_editor"),
      blocks,
    ]);
    await act(async () => resolve(merged("cmt_after_price")));
    await waitFor(() => expect(onUpdateRecordCell).toHaveBeenCalledTimes(2));
    expect(onUpdateRecordCell.mock.calls[1]?.[3]).toEqual({
      baseCommitId: robot.headCommitId,
      mergeImmediately: true,
    });
  });

  it("shows refreshed values instead of an older overlay after a later own merge", async () => {
    const onUpdateRecordCell = vi
      .fn<UpdateRecordCell>()
      .mockResolvedValueOnce(merged("cmt_after_price"))
      .mockResolvedValueOnce(merged("cmt_after_sku"));
    const { container, rerenderRecords } = renderGrid({ onUpdateRecordCell });
    const price = cell(container, robot.id, "price");
    fireEvent.doubleClick(price);
    fireEvent.change(editorInput(price), { target: { value: "25" } });
    fireEvent.keyDown(editorInput(price), { key: "Enter" });
    await waitFor(() =>
      expect(price.querySelector('[data-inline-cell-status="saving"]')).toBeNull(),
    );
    const sku = cell(container, robot.id, "sku");
    fireEvent.doubleClick(sku);
    fireEvent.change(editorInput(sku), { target: { value: "MY-SKU" } });
    fireEvent.keyDown(editorInput(sku), { key: "Enter" });
    await waitFor(() => expect(sku.querySelector('[data-inline-cell-status="saving"]')).toBeNull());
    // Our SKU merge includes another editor's newer price, not our old overlay.
    rerenderRecords([
      makeRecord(
        robot.id,
        { ...robot.headCommit.payload, price: 30, sku: "MY-SKU" },
        "cmt_after_sku",
      ),
      blocks,
    ]);
    expect(price.textContent).toContain("$30.00");
    expect(price.textContent).not.toContain("$25.00");
  });

  it("restores a refused draft and its validation message after editing another cell", () => {
    const { container, onUpdateRecordCell } = renderGrid();
    const price = cell(container, robot.id, "price");
    fireEvent.doubleClick(price);
    fireEvent.change(editorInput(price), { target: { value: "twelve" } });
    fireEvent.keyDown(editorInput(price), { key: "Enter" });
    fireEvent.blur(editorInput(price));
    const sku = cell(container, robot.id, "sku");
    fireEvent.doubleClick(sku);
    fireEvent.keyDown(editorInput(sku), { key: "Escape" });
    fireEvent.doubleClick(price);
    expect(editorInput(price).value).toBe("twelve");
    expect(within(price).getByRole("alert").textContent).toContain("Enter a number");
    expect(onUpdateRecordCell).not.toHaveBeenCalled();
    fireEvent.keyDown(editorInput(price), { key: "Escape" });
    fireEvent.doubleClick(price);
    expect(editorInput(price).value).toBe("24");
    expect(within(price).queryByRole("alert")).toBeNull();
  });

  it("keeps the rejected draft's original head when it is resumed after a live refresh", () => {
    const { container, onUpdateRecordCell, rerenderRecords } = renderGrid();
    const price = cell(container, robot.id, "price");
    fireEvent.doubleClick(price);
    fireEvent.change(editorInput(price), { target: { value: "twelve" } });
    fireEvent.keyDown(editorInput(price), { key: "Enter" });
    fireEvent.doubleClick(cell(container, robot.id, "sku"));
    fireEvent.keyDown(editorInput(cell(container, robot.id, "sku")), { key: "Escape" });
    const refreshed = makeRecord(
      robot.id,
      { ...robot.headCommit.payload, price: 28 },
      "cmt_other_price",
    );
    rerenderRecords([refreshed, blocks]);
    fireEvent.doubleClick(price);
    expect(editorInput(price).value).toBe("twelve");
    fireEvent.change(editorInput(price), { target: { value: "29" } });
    fireEvent.keyDown(editorInput(price), { key: "Enter" });
    expect(onUpdateRecordCell).toHaveBeenCalledWith(refreshed, "price", 29, {
      baseCommitId: robot.headCommitId,
      mergeImmediately: true,
    });
  });

  it("clears a resumed rejected draft after it is corrected and submitted", async () => {
    const { container, onUpdateRecordCell, rerenderRecords } = renderGrid();
    const price = cell(container, robot.id, "price");
    fireEvent.doubleClick(price);
    fireEvent.change(editorInput(price), { target: { value: "twelve" } });
    fireEvent.keyDown(editorInput(price), { key: "Enter" });
    fireEvent.doubleClick(cell(container, robot.id, "sku"));
    fireEvent.keyDown(editorInput(cell(container, robot.id, "sku")), { key: "Escape" });
    fireEvent.doubleClick(price);
    fireEvent.change(editorInput(price), { target: { value: "29" } });
    fireEvent.keyDown(editorInput(price), { key: "Enter" });
    await waitFor(() => expect(onUpdateRecordCell).toHaveBeenCalledTimes(1));
    rerenderRecords([
      makeRecord(robot.id, { ...robot.headCommit.payload, price: 29 }, "cmt_after"),
      blocks,
    ]);
    fireEvent.doubleClick(price);
    expect(editorInput(price).value).toBe("29");
    expect(within(price).queryByRole("alert")).toBeNull();
  });
});

describe("select, checkbox and text cells", () => {
  it("picks a single-select option from the keyboard", () => {
    const { container, onUpdateRecordCell } = renderGrid();
    const status = cell(container, robot.id, "status");
    act(() => status.focus());
    fireEvent.keyDown(status, { key: "Enter" });
    const listbox = screen.getByRole("listbox", { name: "Status" });
    expect(
      within(listbox)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Draft", "Live"]);
    // The record form's option panel: same footer, same clear action.
    expect(screen.getByText("1 selected")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear selection" })).toBeTruthy();
    const search = screen.getByRole("combobox", { name: /Search options/ });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onUpdateRecordCell).toHaveBeenCalledWith(robot, "status", "chc_live", expect.anything());
    expect(status.textContent).toContain("Live");
  });

  it("filters options by the key that opened the picker", () => {
    const { container, onUpdateRecordCell } = renderGrid();
    const status = cell(container, robot.id, "status");
    act(() => status.focus());
    fireEvent.keyDown(status, { key: "l" });
    expect((screen.getByRole("combobox") as HTMLInputElement).value).toBe("l");
    fireEvent.click(screen.getByRole("option", { name: "Live" }));
    expect(onUpdateRecordCell).toHaveBeenCalledWith(robot, "status", "chc_live", expect.anything());
  });

  it("clears a select from the panel's Clear selection", () => {
    const { container, onUpdateRecordCell } = renderGrid();
    const status = cell(container, robot.id, "status");
    fireEvent.doubleClick(status);
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(onUpdateRecordCell).toHaveBeenCalledWith(robot, "status", "", expect.anything());
  });

  it("edits a date with the record form's calendar: one pick saves the day", () => {
    const { container, onUpdateRecordCell } = renderGrid();
    const launch = cell(container, robot.id, "launch");
    act(() => launch.focus());
    fireEvent.keyDown(launch, { key: "Enter" });
    // The form's localized calendar opens straight from the cell, on the stored day.
    expect(screen.getByRole("grid", { name: "November 2026" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /November 25th, 2026/ }));
    expect(onUpdateRecordCell).toHaveBeenCalledWith(
      robot,
      "launch",
      "2026-11-25",
      expect.objectContaining({ baseCommitId: robot.headCommitId }),
    );
    expect(launch.querySelector("[data-inline-cell-editor]")).toBeNull();
    expect(screen.queryByRole("grid", { name: "November 2026" })).toBeNull();
  });

  it("Esc closes a date's calendar without writing", () => {
    const { container, onUpdateRecordCell } = renderGrid();
    const launch = cell(container, robot.id, "launch");
    fireEvent.doubleClick(launch);
    const calendar = screen.getByRole("grid", { name: "November 2026" });
    fireEvent.keyDown(calendar, { key: "Escape" });
    expect(launch.querySelector("[data-inline-cell-editor]")).toBeNull();
    expect(onUpdateRecordCell).not.toHaveBeenCalled();
  });

  it("toggles a checkbox in place with a click or Space", () => {
    const { container, onUpdateRecordCell } = renderGrid();
    const stocked = cell(container, robot.id, "stocked");
    const box = within(stocked).getByRole("checkbox", { name: "Stocked" });
    expect(box.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(box);
    expect(onUpdateRecordCell).toHaveBeenLastCalledWith(robot, "stocked", true, expect.anything());
    expect(box.getAttribute("aria-checked")).toBe("true");
    const other = cell(container, blocks.id, "stocked");
    act(() => other.focus());
    fireEvent.keyDown(other, { key: " " });
    expect(onUpdateRecordCell).toHaveBeenLastCalledWith(
      blocks,
      "stocked",
      false,
      expect.anything(),
    );
  });

  it("edits a text cell and saves on blur", async () => {
    const { container, onUpdateRecordCell } = renderGrid();
    const sku = cell(container, robot.id, "sku");
    fireEvent.doubleClick(sku);
    const input = editorInput(sku);
    fireEvent.change(input, { target: { value: "TT-ROBOT-V2" } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(onUpdateRecordCell).toHaveBeenCalledWith(robot, "sku", "TT-ROBOT-V2", {
        baseCommitId: robot.headCommitId,
        mergeImmediately: true,
      }),
    );
  });

  it("keeps text type-to-edit, Tab save and Esc cancellation on the compact textarea", () => {
    const { container, onUpdateRecordCell } = renderGrid();
    const sku = cell(container, robot.id, "sku");
    act(() => sku.focus());
    fireEvent.keyDown(sku, { key: "A" });
    expect(editorInput(sku).tagName).toBe("TEXTAREA");
    expect(editorInput(sku).value).toBe("A");
    fireEvent.change(editorInput(sku), { target: { value: "AB" } });
    fireEvent.keyDown(editorInput(sku), { key: "Tab", shiftKey: true });
    expect(onUpdateRecordCell).toHaveBeenCalledWith(robot, "sku", "AB", expect.anything());
    fireEvent.doubleClick(sku);
    fireEvent.change(editorInput(sku), { target: { value: "CANCELLED" } });
    fireEvent.keyDown(editorInput(sku), { key: "Escape" });
    expect(onUpdateRecordCell).toHaveBeenCalledTimes(1);
    expect(sku.textContent).toContain("AB");
  });

  it.each(["LINE1\nLINE2", "LINE1\r\nLINE2", "LINE1\r\nLINE2\nLINE3\rLINE4"])(
    "preserves existing line endings when appending to text %j",
    (value) => {
      const row = makeRecord(robot.id, { ...robot.headCommit.payload, sku: value });
      const { container, onUpdateRecordCell } = renderGrid({ records: [row] });
      const sku = cell(container, robot.id, "sku");
      fireEvent.doubleClick(sku);
      const input = editorInput(sku);
      expect(input.value).toBe(value.replace(/\r\n?/g, "\n"));
      fireEvent.change(input, {
        target: { value: `${value.replace(/\r\n?/g, "\n")}X` },
      });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onUpdateRecordCell).toHaveBeenCalledWith(row, "sku", `${value}X`, expect.anything());
    },
  );

  it("keeps long text read-only and says so instead of editing it", () => {
    const { container, onUpdateRecordCell, onOpenRecord } = renderGrid();
    const notes = cell(container, robot.id, "notes");
    expect(notes.getAttribute("aria-readonly")).toBe("true");
    act(() => notes.focus());
    fireEvent.keyDown(notes, { key: "x" });
    expect(screen.getByTestId("inline-edit-notice").textContent).toBe(
      "Notes can't be edited in the table. Press Enter to open the record.",
    );
    fireEvent.keyDown(notes, { key: "Enter" });
    expect(onOpenRecord).toHaveBeenCalledWith(robot);
    fireEvent.doubleClick(notes);
    expect(notes.querySelector("[data-inline-cell-editor]")).toBeNull();
    expect(onUpdateRecordCell).not.toHaveBeenCalled();
  });
});

describe("the submit control under an in-cell editor", () => {
  const nextTick = () => act(() => new Promise((done) => setTimeout(done, 10)));

  it("saves with a click on Save Now, without needing the Enter key", () => {
    const { container, onUpdateRecordCell } = renderGrid();
    const price = cell(container, robot.id, "price");
    fireEvent.doubleClick(price);
    const input = editorInput(price);
    fireEvent.change(input, { target: { value: "31" } });
    const saveNow = screen.getByRole("button", { name: "Save Now" });
    // Pressing the button does not take focus (or the caret) away from the input.
    expect(fireEvent.mouseDown(saveNow)).toBe(false);
    expect(document.activeElement).toBe(input);
    fireEvent.click(saveNow);
    expect(onUpdateRecordCell).toHaveBeenCalledWith(robot, "price", 31, {
      baseCommitId: robot.headCommitId,
      mergeImmediately: true,
    });
    expect(price.querySelector("[data-inline-cell-editor]")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save Now" })).toBeNull();
  });

  it("Cancel closes the editor without writing anything", () => {
    const { container, onUpdateRecordCell } = renderGrid();
    const sku = cell(container, robot.id, "sku");
    fireEvent.doubleClick(sku);
    fireEvent.change(editorInput(sku), { target: { value: "THROWN-AWAY" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(sku.querySelector("[data-inline-cell-editor]")).toBeNull();
    expect(sku.textContent).toContain("TT-ROBOT");
    expect(onUpdateRecordCell).not.toHaveBeenCalled();
  });

  it("files a Change Request from the menu even when the viewer could merge", async () => {
    const onUpdateRecordCell = vi.fn<UpdateRecordCell>(async () => ({
      materialized: false,
      changeRequestId: "crq_price",
    }));
    const { container } = renderGrid({ onUpdateRecordCell });
    const price = cell(container, robot.id, "price");
    fireEvent.doubleClick(price);
    fireEvent.change(editorInput(price), { target: { value: "129" } });
    fireEvent.keyDown(screen.getByRole("button", { name: "More submit options" }), {
      key: "ArrowDown",
    });
    const request = await screen.findByRole("menuitem", { name: "Save as Change Request" });
    // Focus moving into the menu is not leaving the editor, so nothing saved yet.
    await nextTick();
    expect(onUpdateRecordCell).not.toHaveBeenCalled();
    expect(editorInput(price).value).toBe("129");
    fireEvent.click(request);
    expect(onUpdateRecordCell).toHaveBeenCalledWith(robot, "price", 129, {
      baseCommitId: robot.headCommitId,
      mergeImmediately: false,
    });
    await waitFor(() =>
      expect(price.querySelector('[data-inline-cell-status="pending"]')).not.toBeNull(),
    );
    expect(price.textContent).toContain("$24.00");
    expect(screen.getByTestId("inline-edit-notice").textContent).toContain(
      "Your edit to Price was saved as a change request.",
    );
  });

  it("returns focus to the input when the menu closes without a choice", async () => {
    const { container, onUpdateRecordCell } = renderGrid();
    const sku = cell(container, robot.id, "sku");
    fireEvent.doubleClick(sku);
    fireEvent.change(editorInput(sku), { target: { value: "TT-ROBOT-V9" } });
    fireEvent.keyDown(screen.getByRole("button", { name: "More submit options" }), {
      key: "ArrowDown",
    });
    const menu = await screen.findByRole("menu");
    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await nextTick();
    expect(document.activeElement).toBe(editorInput(sku));
    expect(onUpdateRecordCell).not.toHaveBeenCalled();
    fireEvent.keyDown(editorInput(sku), { key: "Enter" });
    expect(onUpdateRecordCell).toHaveBeenCalledWith(robot, "sku", "TT-ROBOT-V9", {
      baseCommitId: robot.headCommitId,
      mergeImmediately: true,
    });
  });

  it("gives a proposal-only member just the request, which Enter files too", async () => {
    const onUpdateRecordCell = vi.fn<UpdateRecordCell>(async () => ({
      materialized: false,
      changeRequestId: "crq_sku",
    }));
    const { container } = renderGrid({ level: "changeRequest", onUpdateRecordCell });
    const sku = cell(container, robot.id, "sku");
    fireEvent.doubleClick(sku);
    expect(screen.getByRole("button", { name: "Save as Change Request" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save Now" })).toBeNull();
    expect(screen.queryByRole("button", { name: "More submit options" })).toBeNull();
    fireEvent.change(editorInput(sku), { target: { value: "TT-ROBOT-V2" } });
    fireEvent.keyDown(editorInput(sku), { key: "Enter" });
    expect(onUpdateRecordCell).toHaveBeenCalledWith(robot, "sku", "TT-ROBOT-V2", {
      baseCommitId: robot.headCommitId,
      mergeImmediately: false,
    });
    // Their access, not a choice, is why it waits — the notice keeps saying so.
    await waitFor(() =>
      expect(screen.getByTestId("inline-edit-notice").textContent).toContain(
        "Your access to this Base is Change request",
      ),
    );
  });

  it("puts the submit control under a date-and-time calendar", async () => {
    const restock = field("restock", "date", { date: { includeTime: true, timezone: "UTC" } });
    const withTime: BaseVO = { ...base, fields: [...fields, restock] };
    const row = makeRecord(robot.id, {
      ...robot.headCommit.payload,
      restock: "2026-11-12T10:15:00Z",
    });
    const onUpdateRecordCell = vi.fn<UpdateRecordCell>(async () => merged());
    const { container } = renderGrid({ base: withTime, records: [row], onUpdateRecordCell });
    const cellEl = cell(container, robot.id, "restock");
    fireEvent.doubleClick(cellEl);
    fireEvent.click(screen.getByRole("button", { name: /November 13th, 2026/ }));
    // Picking the day alone does not save: the time can still be set.
    expect(onUpdateRecordCell).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("button", { name: "More submit options" }), {
      key: "ArrowDown",
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Save as Change Request" }));
    expect(onUpdateRecordCell).toHaveBeenCalledTimes(1);
    expect(onUpdateRecordCell).toHaveBeenCalledWith(
      row,
      "restock",
      expect.stringContaining("2026-11-13T10:15"),
      { baseCommitId: row.headCommitId, mergeImmediately: false },
    );
    await waitFor(() => expect(cellEl.querySelector("[data-inline-cell-editor]")).toBeNull());
  });
});

describe("permissions", () => {
  it("a proposal-only member's edit shows as waiting for review, not as saved", async () => {
    const onUpdateRecordCell = vi.fn<UpdateRecordCell>(async () => ({
      materialized: false,
      changeRequestId: "crq_price",
    }));
    const { container } = renderGrid({ level: "changeRequest", onUpdateRecordCell });
    const price = cell(container, robot.id, "price");
    fireEvent.doubleClick(price);
    fireEvent.change(editorInput(price), { target: { value: "129" } });
    fireEvent.keyDown(editorInput(price), { key: "Enter" });
    const badge = await waitFor(() => {
      const found = price.querySelector<HTMLAnchorElement>('[data-inline-cell-status="pending"]');
      if (!found) throw new Error("no pending badge");
      return found;
    });
    // The cell keeps the current value; the proposal is named, with a link to it.
    expect(price.textContent).toContain("$24.00");
    expect(price.textContent).not.toContain("$129.00");
    expect(badge.textContent).toBe("Waiting for review");
    expect(badge.getAttribute("href")).toBe("/inbox/crq_price?space=shop");
    expect(badge.getAttribute("title")).toContain("Proposed: $129.00");
    const notice = screen.getByTestId("inline-edit-notice");
    expect(notice.textContent).toContain("your edit to Price was submitted for review");
    expect(within(notice).getByRole("link", { name: "View request" }).getAttribute("href")).toBe(
      "/inbox/crq_price?space=shop",
    );
  });

  it("a read-only viewer never enters edit mode and every cell opens the record", () => {
    const { container, onUpdateRecordCell, onOpenRecord } = renderGrid({ level: "read" });
    expect(container.querySelector("[data-grid-cell]")).toBeNull();
    expect(container.querySelector("[data-inline-editing]")).toBeNull();
    const row = container.querySelector<HTMLElement>(`[data-record-id="${robot.id}"]`);
    const priceLink = within(row as HTMLElement).getByRole("link", { name: /\$24\.00/ });
    fireEvent.doubleClick(priceLink);
    expect(container.querySelector("[data-inline-cell-editor]")).toBeNull();
    fireEvent.click(priceLink);
    expect(onOpenRecord).toHaveBeenCalledWith(robot);
    expect(onUpdateRecordCell).not.toHaveBeenCalled();
  });

  it("stays read-only on a touch-only screen", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    try {
      const { container } = renderGrid();
      expect(container.querySelector("[data-grid-cell]")).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
