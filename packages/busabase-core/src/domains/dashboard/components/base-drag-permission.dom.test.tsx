// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ApiKeyPermissionLevel } from "busabase-contract/access-control/api-key-level";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { BaseFieldVO, BaseVO, RecordVO, ViewVO } from "busabase-contract/types";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { SubmitPermissionProvider } from "./split-submit-button";

vi.mock("wouter", () => ({ useSearch: () => "?spaceId=space" }));
vi.mock("openlib/ui/dashboard", () => ({
  SPALink: ({ children, ...props }: { children: ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));
const { BusaBaseKanban } = await import("./base-kanban");
const { BusaBaseGantt } = await import("./base-gantt");

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
  baseId: "tasks",
  position: 0,
  required: false,
});
const fields = [
  field("title", "text"),
  field("state", "select", {
    choices: [
      { id: "todo", name: "To do" },
      { id: "done", name: "Done" },
    ],
  }),
  field("start", "date"),
  field("end", "date"),
];
const base: BaseVO = {
  id: "tasks",
  nodeId: "nod_tasks",
  slug: "tasks",
  name: "Tasks",
  description: "",
  reviewPolicy: { kind: "single", requiredApprovals: 1 },
  createdAt: "2026-10-01T00:00:00Z",
  fields,
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
  headCommit: {
    id: "head",
    baseId: base.id,
    targetType: "base",
    nodeId: null,
    operationId: null,
    parentCommitId: null,
    payload: { title: "Launch", state: "todo", start: "2026-10-05", end: "2026-10-08" },
    operation: "record_create",
    message: "",
    author: "owner",
    createdAt: base.createdAt,
  },
};
const view = (type: "kanban" | "gantt"): ViewVO => ({
  id: "board",
  baseId: base.id,
  slug: "board",
  name: "Board",
  description: "",
  type,
  config: {
    filters: [],
    sorts: [],
    stackByFieldSlug: "state",
    startFieldSlug: "start",
    endFieldSlug: "end",
  },
  status: "active",
  position: 0,
  createdBy: "owner",
  archivedAt: null,
  createdAt: base.createdAt,
  updatedAt: base.createdAt,
});
const client = {
  groupRecords: vi.fn(async () => ({ groups: [{ value: "todo", count: 1 }] })),
  listRecordsPage: vi.fn(async (input: { filters?: Array<{ value?: unknown }> }) => ({
    records: input.filters?.[0]?.value === "todo" ? [record] : [],
    total: 1,
    page: 1,
    totalPages: 1,
  })),
} as unknown as BusabaseDashboardApiClient;

const harness = (level: ApiKeyPermissionLevel, children: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <CoreI18nProvider locale="en">
      <SubmitPermissionProvider permissionLevel={level}>{children}</SubmitPermissionProvider>
    </CoreI18nProvider>
  </QueryClientProvider>
);
type MoveResult = { materialized: true } | { materialized: false; changeRequestId: string };
const queued = () =>
  vi.fn(
    async (..._args: unknown[]): Promise<MoveResult> => ({
      materialized: false,
      changeRequestId: "crq_move",
    }),
  );
const merged = () =>
  vi.fn(async (..._args: unknown[]): Promise<MoveResult> => ({ materialized: true }));

afterEach(cleanup);

describe("kanban drag follows the viewer's level on the Base", () => {
  const renderBoard = (level: ApiKeyPermissionLevel, onMoveRecord = merged()) => {
    render(
      harness(
        level,
        <BusaBaseKanban
          activeView={view("kanban")}
          base={base}
          client={client}
          fields={fields}
          onMoveRecord={onMoveRecord}
        />,
      ),
    );
    return onMoveRecord;
  };
  const card = async () =>
    (await screen.findByRole("link", { name: "Launch" })).closest("[data-record-id]") as Element;

  it("gives a read grant no draggable cards and ignores a drop", async () => {
    const move = renderBoard("read");
    const target = await card();
    expect(target.getAttribute("draggable")).toBe("false");
    expect(target.className).not.toContain("cursor-grab");
    fireEvent.dragStart(target);
    fireEvent.drop(screen.getByTestId("kanban-column-done"));
    expect(move).not.toHaveBeenCalled();
  });

  it("tells a changeRequest grant the move is pending review and links to it", async () => {
    const move = renderBoard("changeRequest", queued());
    const target = await card();
    expect(target.className).toContain("cursor-grab");
    fireEvent.dragStart(target);
    fireEvent.drop(screen.getByTestId("kanban-column-done"));
    await waitFor(() => expect(move).toHaveBeenCalledWith(record, "state", "done"));
    const notice = await screen.findByTestId("drag-review-notice");
    expect(notice.textContent).toContain("submitted for review");
    expect(screen.getByRole("link", { name: "View request" }).getAttribute("href")).toBe(
      "/inbox/crq_move?spaceId=space",
    );
  });

  it("moves silently for a write grant", async () => {
    const move = renderBoard("write");
    fireEvent.dragStart(await card());
    fireEvent.drop(screen.getByTestId("kanban-column-done"));
    await waitFor(() => expect(move).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("drag-review-notice")).toBeNull();
  });

  it("reports a failed move", async () => {
    renderBoard(
      "write",
      vi.fn(async () => {
        throw new Error("Save failed");
      }),
    );
    fireEvent.dragStart(await card());
    fireEvent.drop(screen.getByTestId("kanban-column-done"));
    expect((await screen.findByRole("alert")).textContent).toContain("Save failed");
  });
});

describe("gantt drag follows the viewer's level on the Base", () => {
  const renderTimeline = (level: ApiKeyPermissionLevel, onPatchRecord = merged()) => {
    render(
      harness(
        level,
        <BusaBaseGantt
          activeView={view("gantt")}
          base={base}
          fields={fields}
          onPatchRecord={onPatchRecord}
          records={[record]}
        />,
      ),
    );
    return onPatchRecord;
  };
  // The bar's title tracks the live preview, so find it by its label span.
  const bar = () =>
    screen.getAllByText("Launch").find((node) => node.tagName === "SPAN")
      ?.parentElement as HTMLElement;
  // Month scale is 5px/day; drag the bar's middle two days to the right.
  const dragBar = () => {
    const target = bar();
    target.getBoundingClientRect = () =>
      ({ left: 0, width: 100, top: 0, height: 20, right: 100, bottom: 20 }) as DOMRect;
    fireEvent.mouseDown(target, { clientX: 50 });
    fireEvent.mouseMove(window, { clientX: 60 });
    fireEvent.mouseUp(bar());
  };

  it("gives a read grant no grab cursor and no reschedule", () => {
    const patch = renderTimeline("read");
    expect(bar().className).not.toContain("cursor-grab");
    dragBar();
    expect(patch).not.toHaveBeenCalled();
  });

  it("tells a changeRequest grant the reschedule is pending review", async () => {
    const patch = renderTimeline("changeRequest", queued());
    expect(bar().className).toContain("cursor-grab");
    dragBar();
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect((await screen.findByTestId("drag-review-notice")).textContent).toContain(
      "submitted for review",
    );
    expect(screen.getByRole("link", { name: "View request" }).getAttribute("href")).toBe(
      "/inbox/crq_move?spaceId=space",
    );
  });

  it("reschedules silently for a write grant", async () => {
    const patch = renderTimeline("write");
    dragBar();
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("drag-review-notice")).toBeNull();
  });
});
