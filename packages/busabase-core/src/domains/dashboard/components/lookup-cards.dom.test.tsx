// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import { createBusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type {
  BaseFieldVO,
  BaseVO,
  LookupComputedVO,
  RecordVO,
  ViewVO,
} from "busabase-contract/types";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { DashboardOrpcProvider } from "../orpc-context";

vi.mock("wouter", () => ({ useSearch: () => "?spaceId=space&view=cards" }));
vi.mock("openlib/ui/dashboard", () => ({
  SPALink: ({ children, ...props }: { children: ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));
const { BusaBaseGallery } = await import("./base-gallery");
const { BusaBaseKanban } = await import("./base-kanban");
const field = (
  slug: string,
  type: BaseFieldVO["type"],
  options: BaseFieldVO["options"] = {},
): BaseFieldVO => ({
  id: slug,
  slug,
  type,
  options,
  name: slug,
  baseId: "projects",
  position: 1,
  required: false,
});
const title = field("title", "text");
const state = field("state", "select", {
  choices: [
    { id: "todo", name: "To do" },
    { id: "done", name: "Done" },
  ],
});
const lookup = (slug: string) =>
  field(slug, "lookup", { lookup: { relationFieldSlug: "sources", targetFieldSlug: slug } });
const fields = [
  title,
  state,
  lookup("total"),
  lookup("owner"),
  lookup("receipt"),
  lookup("fourth"),
];
const base: BaseVO = {
  id: "projects",
  nodeId: "project-node",
  slug: "projects",
  name: "Projects",
  description: "",
  fields,
  reviewPolicy: { kind: "single", requiredApprovals: 1 },
  createdAt: "2026-10-23T00:00:00.000Z",
};
const computed = (targetField: BaseFieldVO, value: unknown): LookupComputedVO => ({
  status: "ready",
  value,
  targetField,
  sourceBaseId: "expenses",
  sourceBaseSlug: "expenses",
  dependencyVersion: "v1",
  sources: [{ recordId: "train", title: "Train fare", value, headCommitId: "source-head" }],
});
const attachment = {
  id: "receipt",
  fileName: "receipt.pdf",
  url: "https://example.com/receipt.pdf",
  mimeType: "application/pdf",
  size: 12,
};
const record: RecordVO = {
  id: "launch",
  baseId: base.id,
  headCommitId: "head",
  parentRecordId: null,
  parentCommitId: null,
  status: "active",
  createdBy: "owner",
  archivedAt: null,
  createdAt: base.createdAt,
  updatedAt: base.createdAt,
  base,
  fieldUsers: { alice: { id: "alice", name: "Alice", email: null, image: null, role: null } },
  computedFields: {
    total: computed(
      field("amount", "number", { number: { format: "currency", currency: "EUR" } }),
      [12],
    ),
    owner: computed(field("person", "member"), ["alice"]),
    receipt: computed(field("receipt", "attachment"), [attachment]),
    fourth: computed(field("amount", "number"), [999]),
  },
  headCommit: {
    id: "head",
    baseId: base.id,
    targetType: "base",
    nodeId: null,
    operationId: null,
    parentCommitId: null,
    payload: { title: "Launch", state: "todo", total: [999] },
    operation: "record_create",
    message: "",
    author: "owner",
    createdAt: base.createdAt,
  },
};
const result = (slug: string): LookupComputedVO => {
  const value = record.computedFields?.[slug];
  if (!value) throw new Error(`Missing test Lookup ${slug}`);
  return value;
};
const view = (type: "gallery" | "kanban"): ViewVO => ({
  id: "cards",
  baseId: base.id,
  slug: "cards",
  name: "Cards",
  description: "",
  type,
  config: { filters: [], sorts: [], stackByFieldSlug: "state" },
  status: "active",
  position: 0,
  createdBy: "owner",
  archivedAt: null,
  createdAt: base.createdAt,
  updatedAt: base.createdAt,
});
const harness = (children: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <CoreI18nProvider locale="en">{children}</CoreI18nProvider>
  </QueryClientProvider>
);
const client = {
  groupRecords: vi.fn(async () => ({
    groups: [
      { key: "todo", count: 1 },
      { key: "done", count: 0 },
    ],
  })),
  listRecordsPage: vi.fn(async (input) => ({
    records: input.filters[0].value === "todo" ? [record] : [],
    total: 1,
    page: 1,
    totalPages: 1,
  })),
} as unknown as BusabaseDashboardApiClient;
afterEach(cleanup);

describe.each(["gallery", "kanban"] as const)("typed Lookup in %s cards", (type) => {
  it("uses current currency, members, attachments and source links while keeping record navigation", async () => {
    render(
      harness(
        type === "gallery" ? (
          <BusaBaseGallery activeView={view(type)} base={base} fields={fields} records={[record]} />
        ) : (
          <BusaBaseKanban activeView={view(type)} base={base} fields={fields} client={client} />
        ),
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId("lookup-field-total").textContent).toContain("€12"),
    );
    expect(screen.getByText("Alice")).toBeTruthy();
    expect(screen.getByRole("link", { name: "receipt.pdf" }).getAttribute("href")).toBe(
      attachment.url,
    );
    expect(screen.getByRole("link", { name: "Launch" }).getAttribute("href")).toBe(
      "/base/projects/launch?spaceId=space&view=cards",
    );
    if (type === "kanban") expect(screen.queryByTestId("lookup-field-fourth")).toBeNull();
    fireEvent.click(screen.getByTestId("lookup-sources-total"));
    expect(screen.getByTestId("lookup-source-dialog").textContent).toContain("€12");
    expect(screen.getByRole("link", { name: "Train fare" }).getAttribute("href")).toBe(
      "/base/expenses/train?spaceId=space&view=cards",
    );
  });
});

it("shows invalid, inaccessible and unlinked states without a cached amount or source action", () => {
  const changed = {
    ...record,
    computedFields: {
      total: {
        ...result("total"),
        status: "invalid" as const,
        reason: "missing_target_field" as const,
      },
      owner: { ...result("owner"), status: "inaccessible" as const },
      receipt: {
        ...result("receipt"),
        status: "unlinked" as const,
        value: null,
        sources: [],
      },
    },
  };
  render(
    harness(
      <BusaBaseGallery
        activeView={view("gallery")}
        base={base}
        fields={fields.slice(0, 5)}
        records={[changed]}
      />,
    ),
  );
  expect(screen.getByText("The source field was removed or renamed")).toBeTruthy();
  expect(screen.getByText("Source unavailable or access denied")).toBeTruthy();
  expect(screen.getByText("No linked records")).toBeTruthy();
  expect(screen.queryByText("€12")).toBeNull();
  expect(screen.queryByTestId("lookup-sources-total")).toBeNull();
  expect(screen.queryByTestId("lookup-sources-owner")).toBeNull();
});

it("does not begin dragging when an interactive source control is dragged", async () => {
  const move = vi.fn(async () => {});
  render(
    harness(
      <BusaBaseKanban
        activeView={view("kanban")}
        base={base}
        fields={fields}
        client={client}
        onMoveRecord={move}
      />,
    ),
  );
  const source = await screen.findByTestId("lookup-sources-total");
  expect(fireEvent.dragStart(source)).toBe(false);
  fireEvent.drop(screen.getByTestId("kanban-column-done"));
  expect(move).not.toHaveBeenCalled();
  const card = source.closest("[data-record-id]");
  expect(card).not.toBeNull();
  if (!card) throw new Error("Expected draggable card");
  fireEvent.dragStart(card);
  fireEvent.drop(screen.getByTestId("kanban-column-done"));
  await waitFor(() => expect(move).toHaveBeenCalledWith(record, "state", "done"));
  move.mockClear();
  expect(fireEvent.dragStart(screen.getByRole("link", { name: "Launch" }))).toBe(true);
  fireEvent.drop(screen.getByTestId("kanban-column-done"));
  await waitFor(() => expect(move).toHaveBeenCalledWith(record, "state", "done"));
});

it("revalidates board cards and counts with the shared workspace record prefixes", async () => {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const orpc = createBusabaseQueryUtils("http://localhost/api/rpc", {}, "card-workspace");
  let latest = record;
  const getPage = vi.fn(async (input: { filters: Array<{ value?: unknown }> }) => ({
    records: input.filters[0]?.value === "todo" ? [latest] : [],
    total: 1,
    page: 1,
    totalPages: 1,
  }));
  const getCounts = vi.fn(async () => ({ groups: [{ key: "todo", count: 1 }] }));
  const api = {
    ...client,
    listRecordsPage: getPage,
    groupRecords: getCounts,
  } as unknown as BusabaseDashboardApiClient;
  render(
    <QueryClientProvider client={cache}>
      <DashboardOrpcProvider orpc={orpc}>
        <CoreI18nProvider locale="en">
          <BusaBaseKanban activeView={view("kanban")} base={base} fields={fields} client={api} />
        </CoreI18nProvider>
      </DashboardOrpcProvider>
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(screen.getByTestId("lookup-field-total").textContent).toContain("€12"),
  );
  latest = {
    ...record,
    computedFields: {
      ...record.computedFields,
      total: { ...result("total"), value: [65] },
    },
  };
  await cache.invalidateQueries({ queryKey: orpc.records.listPage.key() });
  await waitFor(() =>
    expect(screen.getByTestId("lookup-field-total").textContent).toContain("€65"),
  );
  const before = getCounts.mock.calls.length;
  await cache.invalidateQueries({ queryKey: orpc.records.count.key() });
  expect(getCounts.mock.calls.length).toBeGreaterThan(before);
  latest = {
    ...record,
    computedFields: {
      total: { status: "inaccessible", value: null, sources: [], dependencyVersion: "revoked" },
    },
  };
  await cache.invalidateQueries({ queryKey: orpc.records.listPage.key() });
  await waitFor(() => expect(screen.getByText("Source unavailable or access denied")).toBeTruthy());
  expect(screen.getByTestId("lookup-field-total").textContent).not.toContain("€65");
  expect(screen.queryByTestId("lookup-sources-total")).toBeNull();
});

it.each([
  ["missing_configuration", "Choose a relation and source field for this Lookup"],
  ["missing_relation", "The relation field was removed or is no longer a relation"],
  ["missing_source_configuration", "Choose a source Base for the relation field"],
  ["missing_target_field", "The source field was removed or renamed"],
  ["unsupported_source", "Lookups and formulas that depend on Lookups cannot be used as sources"],
  ["unsupported_rollup", "This aggregation does not support the source field type"],
  ["source_base_mismatch", "A linked record belongs to a different Base"],
  ["source_record_archived", "A linked source record is archived"],
] as const)(
  "shows the safe %s explanation without retaining values or source actions",
  (reason, text) => {
    const changed = {
      ...record,
      computedFields: {
        total: { ...result("total"), status: "invalid" as const, reason },
      },
    };
    render(
      harness(
        <BusaBaseGallery
          activeView={view("gallery")}
          base={base}
          fields={[title, lookup("total")]}
          records={[changed]}
        />,
      ),
    );
    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.queryByText("€12")).toBeNull();
    expect(screen.queryByTestId("lookup-sources-total")).toBeNull();
  },
);
