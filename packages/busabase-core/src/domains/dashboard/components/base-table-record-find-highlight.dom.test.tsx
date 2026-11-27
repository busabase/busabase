// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { BaseFieldVO, BaseVO, RecordVO, ViewConfigVO, ViewVO } from "busabase-contract/types";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import type { UpdateRecordCell } from "../hooks/use-base-grid-editing";
import type { RecordFindControl } from "../hooks/use-record-find";
import { SubmitPermissionProvider } from "./split-submit-button";

vi.mock("wouter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wouter")>()),
  useSearch: () => "space=shop",
  useLocation: () => ["/base/deliveries", vi.fn()],
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
// jsdom has no layout; the view tabs reveal the active tab on mount.
Element.prototype.scrollIntoView ??= () => {};

const field = (
  slug: string,
  type: BaseFieldVO["type"],
  position: number,
  options: BaseFieldVO["options"] = {},
): BaseFieldVO => ({
  id: `fld_${slug}`,
  baseId: "bas_deliveries",
  slug,
  name: slug,
  type,
  required: false,
  position,
  options,
});

const fields = [
  field("title", "text", 0),
  field("client", "text", 1),
  field("status", "select", 2, { choices: [{ id: "chc_acme", name: "Acme tier" }] }),
  field("site", "url", 3),
  field("docs", "markdown", 4),
  field("notes", "longtext", 5),
];
const base: BaseVO = {
  id: "bas_deliveries",
  nodeId: "nod_deliveries",
  slug: "deliveries",
  name: "Deliveries",
  description: "",
  reviewPolicy: { kind: "single", requiredApprovals: 1 },
  createdAt: "2026-11-20T00:00:00Z",
  fields,
};
const record: RecordVO = {
  id: "rec_acme",
  baseId: base.id,
  headCommitId: "cmt_acme",
  parentRecordId: null,
  parentCommitId: null,
  status: "active",
  createdBy: "usr_owner",
  archivedAt: null,
  createdAt: base.createdAt,
  updatedAt: base.createdAt,
  base,
  headCommit: {
    id: "cmt_acme",
    baseId: base.id,
    targetType: "base",
    nodeId: null,
    operationId: null,
    parentCommitId: null,
    payload: {
      title: "ACME rollout",
      client: "Acme Corp",
      status: "chc_acme",
      site: "https://acme.example",
      docs: "acme **handbook**",
      notes: "Call acme first",
    },
    operation: "record_create",
    message: "",
    author: "usr_owner",
    createdAt: base.createdAt,
  },
};
const view = (type: ViewVO["type"], config: Partial<ViewConfigVO> = {}): ViewVO => ({
  id: `viw_${type}`,
  baseId: base.id,
  slug: type,
  name: type,
  description: "",
  type,
  config: { filters: [], sorts: [], ...config },
  status: "active",
  position: 0,
  createdBy: "usr_owner",
  archivedAt: null,
  createdAt: base.createdAt,
  updatedAt: base.createdAt,
});
// Everything but `notes`, which the view hides.
const shown = view("table", { visibleFieldSlugs: ["title", "client", "status", "site", "docs"] });

/** A committed find of `query`; the input may already hold a newer draft. */
const committedFind = (query: string, fieldId = "", draft = query): RecordFindControl => ({
  input: { query, ...(fieldId ? { fieldId } : {}) },
  query: draft,
  fieldId,
  hasQuery: true,
  isPending: false,
  isFetching: false,
  setQuery: vi.fn(),
  setFieldId: vi.fn(),
  startComposition: vi.fn(),
  endComposition: vi.fn(),
  clear: vi.fn(),
});

function renderTable(props: Partial<ComponentProps<typeof BusaBaseTable>> = {}) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <CoreI18nProvider locale="en">
        <SubmitPermissionProvider permissionLevel="write">
          <BusaBaseTable
            activeView={shown}
            base={base}
            client={{} as BusabaseDashboardApiClient}
            onCreateView={vi.fn()}
            onDeleteView={vi.fn()}
            onUpdateView={vi.fn()}
            records={[record]}
            scrollElementRef={{ current: null }}
            views={[shown]}
            {...props}
          />
        </SubmitPermissionProvider>
      </CoreI18nProvider>
    </QueryClientProvider>,
  );
}

const cellMarks = (container: HTMLElement, slug: string) =>
  [
    ...container.querySelectorAll(
      `[data-cell-record="${record.id}"][data-cell-field="${slug}"] mark`,
    ),
  ].map((mark) => mark.textContent);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("record find highlight in the table", () => {
  it("marks the committed query in the visible fields find searched", () => {
    // Choice chips render once the cell has a measured width.
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(240);
    const { container } = renderTable({ recordFind: committedFind("acme", "", "acme rollout") });
    expect(cellMarks(container, "title")).toEqual(["ACME"]);
    expect(cellMarks(container, "client")).toEqual(["Acme"]);
    expect(cellMarks(container, "status")).toEqual(["Acme"]);
    expect(cellMarks(container, "site")).toEqual(["acme"]);
    // Rendered rich content stays unmarked.
    expect(cellMarks(container, "docs")).toEqual([]);
    // The query typed since (not yet searched) does not move the marks.
    expect(container.querySelectorAll("mark")).toHaveLength(4);
    const title = container.querySelector(`[data-cell-field="title"] [data-grid-cell-text]`);
    expect(title?.textContent).toBe("ACME rollout");
  });

  it("marks only the chosen field", () => {
    const { container } = renderTable({ recordFind: committedFind("acme", "fld_client") });
    expect(cellMarks(container, "client")).toEqual(["Acme"]);
    expect(container.querySelectorAll("mark")).toHaveLength(1);
  });

  it("marks nothing without a committed find", () => {
    const control = { ...committedFind("acme"), input: undefined, hasQuery: false };
    const { container } = renderTable({ recordFind: control });
    expect(container.querySelectorAll("mark")).toHaveLength(0);
  });

  it("marks editable cells, but a cell being edited shows the raw value", () => {
    const { container } = renderTable({
      recordFind: committedFind("acme"),
      onUpdateRecordCell: vi.fn<UpdateRecordCell>(async () => ({
        materialized: true,
        headCommitId: "cmt_after",
      })),
    });
    const client = container.querySelector<HTMLElement>(`[data-grid-cell="${record.id}::client"]`);
    if (!client) throw new Error("Expected an editable client cell");
    expect(client.getAttribute("data-inline-editable")).toBe("true");
    expect(cellMarks(container, "client")).toEqual(["Acme"]);
    expect(cellMarks(container, "status")).toEqual(["Acme"]);

    act(() => {
      fireEvent.doubleClick(client);
    });
    const editor = client.querySelector<HTMLTextAreaElement>(
      "[data-inline-cell-editor] input, [data-inline-cell-editor] textarea",
    );
    expect(editor?.value).toBe("Acme Corp");
    expect(cellMarks(container, "client")).toEqual([]);
  });

  it("marks gallery cards from the same scope", () => {
    const gallery = view("gallery", { visibleFieldSlugs: ["title", "client", "docs"] });
    const { container } = renderTable({
      activeView: gallery,
      recordFind: committedFind("acme"),
      views: [gallery],
    });
    const card = container.querySelector(`[data-testid="base-gallery"] [data-record-id]`);
    expect([...(card?.querySelectorAll("mark") ?? [])].map((mark) => mark.textContent)).toEqual([
      "ACME",
      "Acme",
    ]);
  });
});
