// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ApiKeyPermissionLevel } from "busabase-contract/access-control/api-key-level";
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
import { SubmitPermissionProvider } from "./split-submit-button";

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
const harness = (children: ReactNode, locale = "en") => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <CoreI18nProvider locale={locale}>{children}</CoreI18nProvider>
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

describe("Kanban attachment cards", () => {
  const files = field("files", "attachment");
  const emptyFiles = field("empty_files", "attachment");
  const cardFields = [title, state, files, emptyFiles];
  const image = {
    id: "ast_photo",
    assetId: "ast_photo",
    fileName: "class-photo.png",
    url: "https://old-storage.example/photo.png",
    mimeType: "image/png",
    size: 32,
  };

  function renderBoard(
    config: ViewVO["config"] = { filters: [], sorts: [] },
    onOpenRecord?: (record: RecordVO) => void,
    permissionLevel: ApiKeyPermissionLevel = "write",
  ) {
    const cardBase = { ...base, fields: cardFields };
    const cardRecord = {
      ...record,
      base: cardBase,
      computedFields: {},
      headCommit: {
        ...record.headCommit,
        payload: {
          title: "Class report",
          state: "todo",
          files: [image, attachment],
          empty_files: [],
        },
      },
    };
    const onMoveRecord = vi
      .fn()
      .mockResolvedValue(
        permissionLevel === "changeRequest"
          ? { materialized: false, changeRequestId: "crq_attachment_move" }
          : { materialized: true },
      );
    const api = {
      groupRecords: vi.fn(async () => ({ groups: [{ value: "todo", count: 1 }] })),
      listRecordsPage: vi.fn(async (input) => ({
        records: input.filters[0].value === "todo" ? [cardRecord] : [],
        total: 1,
        page: 1,
        totalPages: 1,
      })),
    } as unknown as BusabaseDashboardApiClient;
    const result = render(
      harness(
        <SubmitPermissionProvider permissionLevel={permissionLevel}>
          <BusaBaseKanban
            activeView={{ ...view("kanban"), config }}
            base={cardBase}
            fields={cardFields}
            client={api}
            onMoveRecord={onMoveRecord}
            onOpenRecord={onOpenRecord}
          />
        </SubmitPermissionProvider>,
      ),
    );
    return { ...result, cardRecord, onMoveRecord };
  }

  it("opens the record from the card body, title and cover without navigating away", async () => {
    const open = vi.fn();
    const { cardRecord } = renderBoard({ filters: [], sorts: [], coverFieldSlug: "files" }, open);
    const titleLink = await screen.findByRole("link", { name: "Class report" });
    const card = titleLink.closest("[data-record-id]");
    if (!card) throw new Error("Expected a Kanban card");
    fireEvent.click(screen.getByText("files", { exact: true }));
    expect(open).toHaveBeenLastCalledWith(cardRecord);
    fireEvent.click(card);
    expect(open).toHaveBeenCalledTimes(2);
    expect(fireEvent.click(titleLink)).toBe(false);
    expect(open).toHaveBeenCalledTimes(3);
    expect(fireEvent.click(screen.getByTestId("kanban-cover"))).toBe(false);
    expect(open).toHaveBeenCalledTimes(4);
    expect(titleLink.getAttribute("href")).toBe("/base/projects/launch?spaceId=space&view=cards");
  });

  it.each(["read", "changeRequest", "write"] as const)(
    "retains covers and record opening while respecting a %s grant on drag",
    async (permissionLevel) => {
      const open = vi.fn();
      const { cardRecord, onMoveRecord } = renderBoard(
        { filters: [], sorts: [], coverFieldSlug: "files", coverFit: "fit" },
        open,
        permissionLevel,
      );
      const cover = await screen.findByTestId("kanban-cover");
      expect(within(cover).getByRole("img", { name: image.fileName }).className).toContain(
        "object-contain",
      );
      fireEvent.click(cover);
      expect(open).toHaveBeenCalledWith(cardRecord);
      const card = cover.closest("[data-record-id]");
      if (!card) throw new Error("Expected a Kanban card");
      expect(card.getAttribute("draggable")).toBe(String(permissionLevel !== "read"));
      fireEvent.dragStart(card);
      fireEvent.drop(screen.getByTestId("kanban-column-done"));
      if (permissionLevel === "read") {
        expect(onMoveRecord).not.toHaveBeenCalled();
      } else {
        await waitFor(() => expect(onMoveRecord).toHaveBeenCalledWith(cardRecord, "state", "done"));
      }
      if (permissionLevel === "changeRequest") {
        expect((await screen.findByTestId("drag-review-notice")).textContent).toContain(
          "submitted for review",
        );
        expect(screen.getByRole("link", { name: "View request" }).getAttribute("href")).toBe(
          "/inbox/crq_attachment_move?spaceId=space&view=cards",
        );
      } else {
        expect(screen.queryByTestId("drag-review-notice")).toBeNull();
      }
    },
  );

  it("keeps modified record links and attachment previews independent of the card", async () => {
    const open = vi.fn();
    renderBoard({ filters: [], sorts: [], coverFieldSlug: "files" }, open);
    const titleLink = await screen.findByRole("link", { name: "Class report" });
    for (const modifier of ["ctrlKey", "metaKey", "shiftKey", "altKey"]) {
      expect(fireEvent.click(titleLink, { [modifier]: true })).toBe(true);
    }
    expect(fireEvent.click(screen.getByTestId("kanban-cover"), { ctrlKey: true })).toBe(true);
    expect(open).not.toHaveBeenCalled();

    const attachments = titleLink
      .closest("[data-record-id]")
      ?.querySelector("[data-attachment-preview]");
    if (!(attachments instanceof HTMLElement)) throw new Error("Expected the card attachments");
    fireEvent.click(within(attachments).getByRole("link", { name: image.fileName }));
    const preview = await screen.findByRole("dialog");
    expect(within(preview).getByRole("img", { name: image.fileName })).toBeTruthy();
    // A click inside the portalled preview must not bubble into record opening.
    fireEvent.click(within(preview).getByRole("heading", { name: image.fileName }));
    expect(open).not.toHaveBeenCalled();
  });

  it("suppresses post-drag clicks and allows the next pointer or keyboard activation", async () => {
    const open = vi.fn();
    const { cardRecord, onMoveRecord } = renderBoard(undefined, open);
    const titleLink = await screen.findByRole("link", { name: "Class report" });
    const card = titleLink.closest("[data-record-id]");
    if (!card) throw new Error("Expected a Kanban card");
    fireEvent.dragStart(card);
    fireEvent.drop(screen.getByTestId("kanban-column-done"));
    fireEvent.dragEnd(card);
    expect(fireEvent.click(titleLink)).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(onMoveRecord).toHaveBeenCalledWith(cardRecord, "state", "done");
    fireEvent.pointerDown(card);
    fireEvent.click(card);
    expect(open).toHaveBeenCalledTimes(1);
    fireEvent.dragStart(card);
    fireEvent.dragEnd(card);
    fireEvent.keyDown(titleLink, { key: "Enter" });
    fireEvent.click(titleLink, { detail: 0 });
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("shows attachment thumbnails and names without JSON or an implicit cover", async () => {
    renderBoard();
    const card = (await screen.findByRole("link", { name: "Class report" })).closest(
      "[data-record-id]",
    );
    if (!(card instanceof HTMLElement)) throw new Error("Expected a Kanban card");
    expect(within(card).getByRole("img", { name: image.fileName }).getAttribute("src")).toBe(
      "/api/assets/ast_photo/raw",
    );
    expect(within(card).getByText(attachment.fileName)).toBeTruthy();
    expect(card.textContent).not.toContain("old-storage");
    expect(card.textContent).not.toContain("empty_files");
    expect(screen.queryByTestId("kanban-cover")).toBeNull();
  });

  it("fits an explicit cover while retaining the field's other attachments and record navigation", async () => {
    const { onMoveRecord } = renderBoard({
      filters: [],
      sorts: [],
      coverFieldSlug: "files",
      coverFit: "fit",
    });
    const cover = await screen.findByTestId("kanban-cover");
    const coverImage = within(cover).getByRole("img", { name: image.fileName });
    expect(coverImage.className).toContain("object-contain");
    expect(coverImage.getAttribute("draggable")).toBe("false");
    expect(cover.getAttribute("href")).toBe("/base/projects/launch?spaceId=space&view=cards");
    expect(screen.getByText(attachment.fileName)).toBeTruthy();
    fireEvent.dragStart(coverImage);
    fireEvent.drop(screen.getByTestId("kanban-column-done"));
    expect(onMoveRecord).not.toHaveBeenCalled();
    fireEvent.error(coverImage);
    expect(within(cover).queryByRole("img")).toBeNull();
    expect(cover.textContent).toContain(image.fileName);
    expect(screen.getByRole("link", { name: "Class report" })).toBeTruthy();
  });

  it.each([null, "removed_field"])("does not render a cover for %s", async (coverFieldSlug) => {
    renderBoard({ filters: [], sorts: [], coverFieldSlug });
    await screen.findByRole("link", { name: "Class report" });
    expect(screen.queryByTestId("kanban-cover")).toBeNull();
    expect(screen.getByRole("img", { name: image.fileName })).toBeTruthy();
  });
});

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
    expect(screen.getByTestId("lookup-field-fourth")).toBeTruthy();
    // Historical views omit the setting: Kanban shows labels, gallery retains
    // its existing compact default. Lookup values must keep their typed UI.
    const card = screen.getByTestId("lookup-field-total").closest("[data-record-id]");
    if (type === "kanban") {
      expect(
        Array.from(card?.querySelectorAll("dt") ?? []).map((label) => label.textContent),
      ).toEqual(["total", "owner", "receipt", "fourth"]);
    } else {
      expect(screen.queryByText("total", { exact: true })).toBeNull();
    }
    fireEvent.click(screen.getByTestId("lookup-sources-total"));
    expect(screen.getByTestId("lookup-source-dialog").textContent).toContain("€12");
    expect(screen.getByRole("link", { name: "Train fare" }).getAttribute("href")).toBe(
      "/base/expenses/train?spaceId=space&view=cards",
    );
  });
});

describe("Kanban card field labels", () => {
  it("opens read-only records from field values while preserving Lookup source actions", async () => {
    const open = vi.fn();
    render(
      harness(
        <BusaBaseKanban
          activeView={view("kanban")}
          base={base}
          fields={fields}
          client={client}
          onOpenRecord={open}
        />,
      ),
    );
    const value = await screen.findByTestId("lookup-field-total");
    fireEvent.click(within(value).getByText("€12.00", { exact: true }));
    expect(open).toHaveBeenCalledWith(record);
    open.mockClear();
    fireEvent.click(screen.getByTestId("lookup-sources-total"));
    const dialog = screen.getByTestId("lookup-source-dialog");
    fireEvent.click(within(dialog).getByText("€12.00", { exact: true }));
    expect(open).not.toHaveBeenCalled();
  });

  it("honors an explicitly disabled label setting without losing typed Lookup content", async () => {
    const activeView = view("kanban");
    activeView.config.showFieldLabels = false;
    const { container } = render(
      harness(
        <BusaBaseKanban activeView={activeView} base={base} fields={fields} client={client} />,
      ),
    );
    await screen.findByTestId("lookup-field-total");
    expect(container.querySelectorAll("dt:not(.sr-only)")).toHaveLength(0);
    expect(container.querySelectorAll("dt.sr-only")).toHaveLength(4);
    expect(screen.getByText("Alice")).toBeTruthy();
    expect(screen.getByRole("link", { name: "receipt.pdf" })).toBeTruthy();
  });

  it.each([
    { showFieldLabels: undefined, locale: "en", amountLabel: "Budget", falseLabel: "No" },
    { showFieldLabels: true, locale: "en", amountLabel: "Budget", falseLabel: "No" },
    { showFieldLabels: false, locale: "en", amountLabel: "Budget", falseLabel: "No" },
    { showFieldLabels: undefined, locale: "zh-CN", amountLabel: "预算", falseLabel: "否" },
  ])(
    "renders ordinary and people values with showFieldLabels=$showFieldLabels in $locale",
    async ({ showFieldLabels, locale, amountLabel, falseLabel }) => {
      const amount = { ...field("amount", "number"), name: { en: "Budget", "zh-CN": "预算" } };
      const completed = { ...field("completed", "checkbox"), name: "Completed" };
      const assignee = { ...field("assignee", "member"), name: "Assignee" };
      const cardFields = [title, state, amount, completed, assignee];
      const cardBase = { ...base, fields: cardFields };
      const cardRecord = {
        ...record,
        base: cardBase,
        headCommit: {
          ...record.headCommit,
          payload: {
            title: "Launch",
            state: "todo",
            amount: 0,
            completed: false,
            assignee: ["alice"],
          },
        },
      };
      const activeView = view("kanban");
      activeView.config.showFieldLabels = showFieldLabels;
      const cardClient = {
        ...client,
        listRecordsPage: vi.fn(async (input) => ({
          records: input.filters?.[0]?.value === "todo" ? [cardRecord] : [],
          total: 1,
          page: 1,
          totalPages: 1,
        })),
      } as BusabaseDashboardApiClient;
      const { container } = render(
        harness(
          <BusaBaseKanban
            activeView={activeView}
            base={cardBase}
            fields={cardFields}
            client={cardClient}
          />,
          locale,
        ),
      );
      await screen.findByText("Alice");
      const card = container.querySelector("[data-record-id='launch']");
      expect(card?.textContent).toContain("0");
      expect(card?.textContent).toContain(falseLabel);
      expect(
        Array.from(card?.querySelectorAll("dt:not(.sr-only)") ?? []).map(
          (label) => label.textContent,
        ),
      ).toEqual(showFieldLabels === false ? [] : [amountLabel, "Completed", "Assignee"]);
      // The primary field remains the title; the stack field remains the column.
      expect(card?.querySelectorAll("dt:not(.sr-only)")).toHaveLength(
        showFieldLabels === false ? 0 : 3,
      );
      expect(screen.getByRole("link", { name: "Launch" })).toBeTruthy();
    },
  );

  it("hides empty ordinary and people fields together with their labels", async () => {
    const emptyFields = [title, state, field("notes", "text"), field("assignee", "member")];
    const emptyBase = { ...base, fields: emptyFields };
    const emptyRecord = {
      ...record,
      base: emptyBase,
      headCommit: {
        ...record.headCommit,
        payload: { title: "Launch", state: "todo", notes: "", assignee: [] },
      },
    };
    const emptyClient = {
      ...client,
      listRecordsPage: vi.fn(async (input) => ({
        records: input.filters?.[0]?.value === "todo" ? [emptyRecord] : [],
        total: 1,
        page: 1,
        totalPages: 1,
      })),
    } as BusabaseDashboardApiClient;
    const { container } = render(
      harness(
        <BusaBaseKanban
          activeView={view("kanban")}
          base={emptyBase}
          fields={emptyFields}
          client={emptyClient}
        />,
      ),
    );
    await screen.findByRole("link", { name: "Launch" });
    expect(container.querySelectorAll("dt")).toHaveLength(0);
  });
});

describe("Kanban relation cards", () => {
  const relation = {
    ...field("dependencies", "relation", { targetBaseId: "expenses" }),
    name: { en: "Dependencies", "zh-CN": "依赖" },
  };
  const linked = (id: string, name: string, archived = false): RecordVO => ({
    ...record,
    id,
    baseId: "expenses",
    base: { ...base, id: "expenses", slug: "expenses", fields: [title] },
    status: archived ? "archived" : "active",
    archivedAt: archived ? base.createdAt : null,
    headCommit: { ...record.headCommit, payload: { title: name } },
  });
  const train = linked("train", "Train fare");
  const hotel = linked("hotel", "Hotel booking", true);
  const fixture = (value: unknown, resolved = [train, hotel]) => {
    // A relation after three other details must no longer be silently omitted.
    const cardFields = [...fields.slice(0, 5), relation];
    const cardBase = { ...base, fields: cardFields };
    const cardRecord = {
      ...record,
      base: cardBase,
      headCommit: {
        ...record.headCommit,
        payload: { ...record.headCommit.payload, dependencies: value },
      },
    };
    const getRecord = vi.fn(async (id: string) => {
      const target = resolved.find((item) => item.id === id);
      if (!target) throw new Error("Access denied or removed");
      return target;
    });
    // The batched read the board actually uses: unknown ids come back missing.
    const getRecords = vi.fn(async (ids: string[]) => ({
      records: resolved.filter((item) => ids.includes(item.id)),
      missingIds: ids.filter((id) => !resolved.some((item) => item.id === id)),
    }));
    const api = {
      ...client,
      getRecord,
      getRecords,
      listRecordsPage: vi.fn(async (input) => ({
        records: input.filters?.[0]?.value === "todo" ? [cardRecord] : [],
        total: 1,
        page: 1,
        totalPages: 1,
      })),
    } as BusabaseDashboardApiClient;
    return { api, cardBase, cardFields, cardRecord, getRecord, getRecords };
  };

  it.each([{ value: "train" }, { value: ["train", "hotel"] }])(
    "resolves scalar/multiple relation $value after the third detail and preserves navigation",
    async ({ value }) => {
      const { api, cardBase, cardFields, cardRecord, getRecord, getRecords } = fixture(value);
      const move = vi.fn(async () => ({ materialized: true as const }));
      const open = vi.fn();
      const { container } = render(
        harness(
          <BusaBaseKanban
            activeView={view("kanban")}
            base={cardBase}
            fields={cardFields}
            client={api}
            onMoveRecord={move}
            onOpenRecord={open}
          />,
        ),
      );
      const trainLink = await screen.findByRole("link", { name: "Train fare" });
      expect(trainLink.getAttribute("href")).toBe("/base/expenses/train?spaceId=space&view=cards");
      fireEvent.click(trainLink);
      expect(open).not.toHaveBeenCalled();
      expect(Array.from(container.querySelectorAll("dt")).map((item) => item.textContent)).toEqual([
        "total",
        "owner",
        "receipt",
        "Dependencies",
      ]);
      if (Array.isArray(value)) {
        const archived = await screen.findByRole("link", { name: "Hotel booking" });
        expect(archived.getAttribute("class")).toContain("line-through");
        expect(archived.getAttribute("title")).toContain("archived");
      }
      // Every linked id of the column in ONE batched read (sorted, deduped).
      expect(getRecords.mock.calls).toEqual([
        [Array.isArray(value) ? ["hotel", "train"] : ["train"]],
      ]);
      expect(getRecord).not.toHaveBeenCalled();
      expect(fireEvent.dragStart(trainLink)).toBe(false);
      fireEvent.drop(screen.getByTestId("kanban-column-done"));
      expect(move).not.toHaveBeenCalled();
      fireEvent.dragStart(trainLink.closest("[data-record-id]") as Element);
      fireEvent.drop(screen.getByTestId("kanban-column-done"));
      await waitFor(() => expect(move).toHaveBeenCalledWith(cardRecord, "state", "done"));
    },
  );

  it("hides empty relations and their labels without requesting linked records", async () => {
    const { api, cardBase, cardFields, getRecord, getRecords } = fixture([]);
    render(
      harness(
        <BusaBaseKanban
          activeView={view("kanban")}
          base={cardBase}
          fields={cardFields}
          client={api}
        />,
      ),
    );
    await screen.findByTestId("lookup-field-total");
    expect(screen.queryByText("Dependencies", { exact: true })).toBeNull();
    expect(getRecord).not.toHaveBeenCalled();
    expect(getRecords).not.toHaveBeenCalled();
  });

  it("retains relation links while visually hiding disabled field labels", async () => {
    const { api, cardBase, cardFields } = fixture("train");
    const activeView = view("kanban");
    activeView.config.showFieldLabels = false;
    const { container } = render(
      harness(
        <BusaBaseKanban activeView={activeView} base={cardBase} fields={cardFields} client={api} />,
      ),
    );
    await screen.findByRole("link", { name: "Train fare" });
    expect(container.querySelectorAll("dt:not(.sr-only)")).toHaveLength(0);
    expect(screen.getByText("Dependencies").className).toBe("sr-only");
  });

  it("uses canonical workspace record queries, refreshes titles and suppresses cached titles after access is revoked", async () => {
    const { api, cardBase, cardFields, getRecord, getRecords } = fixture("train");
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let allowed = true;
    let latest = train;
    const requestedPaths: string[] = [];
    const fetchRecord = vi.fn(async (request: Request) => {
      requestedPaths.push(new URL(request.url).pathname);
      if (!allowed) throw new Error("Access revoked");
      return new Response(JSON.stringify({ json: { records: [latest], missingIds: [] } }), {
        headers: { "content-type": "application/json" },
      });
    });
    const orpc = createBusabaseQueryUtils(
      "http://localhost/api/rpc",
      { batch: false, fetch: fetchRecord },
      "relation-workspace",
    );
    render(
      <QueryClientProvider client={cache}>
        <DashboardOrpcProvider orpc={orpc}>
          <CoreI18nProvider locale="en">
            <BusaBaseKanban
              activeView={view("kanban")}
              base={cardBase}
              fields={cardFields}
              client={api}
            />
          </CoreI18nProvider>
        </DashboardOrpcProvider>
      </QueryClientProvider>,
    );
    await screen.findByRole("link", { name: "Train fare" });
    expect(getRecord).not.toHaveBeenCalled();
    expect(getRecords).not.toHaveBeenCalled();
    expect(requestedPaths).toEqual(["/api/rpc/records/getMany"]);
    // Seeded into the canonical records.get entry, so a detail panel is a hit.
    expect(
      cache.getQueryData(orpc.records.get.queryOptions({ input: { recordId: "train" } }).queryKey),
    ).toMatchObject({ id: "train" });
    latest = linked("train", "Updated train fare");
    await cache.invalidateQueries({ queryKey: orpc.records.get.key() });
    await screen.findByRole("link", { name: "Updated train fare" });
    allowed = false;
    await cache.invalidateQueries({ queryKey: orpc.records.get.key() });
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: "Updated train fare" })).toBeNull(),
    );
    expect(screen.queryByText("Updated train fare")).toBeNull();
    expect(screen.getByTitle(/train — This record is unavailable/)).toBeTruthy();
    expect(fetchRecord).toHaveBeenCalledTimes(3);
  });

  it("does not reuse linked titles across fallback clients sharing record ids", async () => {
    const first = fixture("train");
    const second = fixture("train", []);
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const board = (api: BusabaseDashboardApiClient) => (
      <QueryClientProvider client={cache}>
        <CoreI18nProvider locale="en">
          <BusaBaseKanban
            activeView={view("kanban")}
            base={first.cardBase}
            fields={first.cardFields}
            client={api}
          />
        </CoreI18nProvider>
      </QueryClientProvider>
    );
    const mounted = render(board(first.api));
    await screen.findByRole("link", { name: "Train fare" });
    mounted.rerender(board(second.api));
    await waitFor(() => expect(second.getRecords).toHaveBeenCalledWith(["train"]));
    expect(screen.queryByRole("link", { name: "Train fare" })).toBeNull();
    expect(screen.queryByText("Train fare")).toBeNull();
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
  const move = vi.fn(async () => ({ materialized: true as const }));
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
