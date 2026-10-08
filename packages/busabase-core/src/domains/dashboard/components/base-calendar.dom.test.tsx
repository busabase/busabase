// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { BaseFieldVO, BaseVO, RecordVO, ViewVO } from "busabase-contract/types";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";

const query = vi.hoisted(() => ({ records: [] as RecordVO[] }));
vi.mock("@tanstack/react-query", () => ({
  useInfiniteQuery: () => ({
    data: { pages: [{ records: query.records }] },
    hasNextPage: false,
    isFetchingNextPage: false,
    isPending: false,
  }),
}));
vi.mock("wouter", () => ({ useSearch: () => "" }));
vi.mock("@dnd-kit/core", () => ({
  DndContext: ({
    children,
    onDragEnd,
  }: {
    children: ReactNode;
    onDragEnd: (event: unknown) => void;
  }) => (
    <div>
      {children}
      <button
        data-testid="drop-on-target-day"
        onClick={() => onDragEnd({ active: { id: "rec_calendar" }, over: { id: targetDay } })}
        type="button"
      >
        Drop
      </button>
    </div>
  ),
  DragOverlay: ({ children }: { children: ReactNode }) => children,
  KeyboardSensor: class {},
  MouseSensor: class {},
  TouchSensor: class {},
  pointerWithin: () => [],
  rectIntersection: () => [],
  useDraggable: () => ({
    attributes: {},
    isDragging: false,
    listeners: {},
    setActivatorNodeRef: () => {},
    setNodeRef: () => {},
  }),
  useDroppable: () => ({ isOver: false, setNodeRef: () => {} }),
  useSensor: () => ({}),
  useSensors: () => [],
}));
vi.mock("openlib/ui/dashboard", () => ({
  SPALink: ({ children, ...props }: { children: ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));

const { BusaBaseCalendar } = await import("./base-calendar");
const dateField = (type: BaseFieldVO["type"] = "date"): BaseFieldVO => ({
  id: "fld_date",
  baseId: "bas_calendar",
  slug: "publish_date",
  name: "Publish date",
  type,
  required: false,
  position: 1,
  options: {},
});
const titleField: BaseFieldVO = {
  id: "fld_title",
  baseId: "bas_calendar",
  slug: "title",
  name: "Title",
  type: "text",
  required: true,
  position: 0,
  options: {},
};
const base = (field: BaseFieldVO) =>
  ({
    id: "bas_calendar",
    nodeId: "nod_calendar",
    slug: "calendar",
    name: "Calendar",
    description: "",
    reviewPolicy: { kind: "single", requiredApprovals: 1 },
    createdAt: "2026-10-01T00:00:00Z",
    fields: [titleField, field],
  }) satisfies BaseVO;
const view = {
  id: "viw_calendar",
  baseId: "bas_calendar",
  slug: "calendar",
  name: "Calendar",
  description: "",
  type: "calendar",
  config: { filters: [], sorts: [], dateFieldSlug: "publish_date" },
  status: "active",
  createdBy: "usr_test",
  archivedAt: null,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
} satisfies ViewVO;

const today = new Date();
const startDay = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-10`;
const targetDay = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-11`;

const record = (field: BaseFieldVO): RecordVO => ({
  id: "rec_calendar",
  baseId: "bas_calendar",
  headCommitId: "cmt_calendar",
  parentRecordId: null,
  parentCommitId: null,
  status: "active",
  createdBy: "usr_test",
  archivedAt: null,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  base: base(field),
  headCommit: {
    id: "cmt_calendar",
    baseId: "bas_calendar",
    targetType: "base",
    nodeId: null,
    operationId: null,
    parentCommitId: null,
    payload: { title: "Launch story", publish_date: startDay, notes: "keep this" },
    operation: "record_create",
    message: "",
    author: "usr_test",
    createdAt: "2026-10-01T00:00:00Z",
  },
});

function renderCalendar(
  field: BaseFieldVO,
  onPatchRecord = vi.fn().mockResolvedValue({ materialized: true }),
) {
  query.records = [record(field)];
  const result = render(
    <CoreI18nProvider locale="en">
      <BusaBaseCalendar
        activeView={view}
        base={base(field)}
        client={{} as BusabaseDashboardApiClient}
        fields={[titleField, field]}
        onPatchRecord={onPatchRecord}
      />
    </CoreI18nProvider>,
  );
  return { ...result, onPatchRecord };
}

afterEach(cleanup);

describe("calendar drag to reschedule", () => {
  it("patches only the selected date and preserves other record fields", async () => {
    const { onPatchRecord } = renderCalendar(dateField());
    const link = screen.getByRole("link", { name: "Launch story" });
    expect(screen.getByRole("button", { name: "Move Launch story to another day" })).toBeTruthy();
    fireEvent.click(screen.getByTestId("drop-on-target-day"));
    await waitFor(() => expect(onPatchRecord).toHaveBeenCalledTimes(1));
    expect(onPatchRecord).toHaveBeenCalledWith(expect.objectContaining({ id: "rec_calendar" }), {
      title: "Launch story",
      notes: "keep this",
      publish_date: targetDay,
    });
    expect(link.getAttribute("href")).toContain("rec_calendar");
  });

  it("keeps generated timestamps read-only and reports a failed update", async () => {
    renderCalendar(dateField("created_time"));
    expect(screen.queryByRole("button", { name: "Move Launch story to another day" })).toBeNull();
    cleanup();
    const failed = vi.fn().mockRejectedValue(new Error("Save failed"));
    renderCalendar(dateField(), failed);
    fireEvent.click(screen.getByTestId("drop-on-target-day"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  });

  it("shows a review link when write access only submits a change request", async () => {
    const queued = vi
      .fn()
      .mockResolvedValue({ materialized: false, changeRequestId: "crq_queued" });
    renderCalendar(dateField(), queued);
    fireEvent.click(screen.getByTestId("drop-on-target-day"));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("sent for review"),
    );
    expect(screen.getByRole("link", { name: "Reviews" }).getAttribute("href")).toContain(
      "/inbox/crq_queued",
    );
  });
});
