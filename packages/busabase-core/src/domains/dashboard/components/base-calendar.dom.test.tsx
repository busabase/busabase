// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { BaseFieldVO, BaseVO, RecordVO, ViewVO } from "busabase-contract/types";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";

const query = vi.hoisted(() => ({ records: [] as RecordVO[] }));
const drag = vi.hoisted(() => ({
  mouse: vi.fn(),
  touch: vi.fn(),
  keyboard: vi.fn(),
  isDragging: false,
}));
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
    isDragging: drag.isDragging,
    listeners: { onMouseDown: drag.mouse, onTouchStart: drag.touch, onKeyDown: drag.keyboard },
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
  const element = () => (
    <CoreI18nProvider locale="en">
      <BusaBaseCalendar
        activeView={view}
        base={base(field)}
        client={{} as BusabaseDashboardApiClient}
        fields={[titleField, field]}
        onPatchRecord={onPatchRecord}
      />
    </CoreI18nProvider>
  );
  const result = render(element());
  return { ...result, onPatchRecord, refresh: () => result.rerender(element()) };
}

afterEach(cleanup);
beforeEach(() => {
  drag.isDragging = false;
  drag.mouse.mockClear();
  drag.touch.mockClear();
  drag.keyboard.mockClear();
});

describe("calendar drag to reschedule", () => {
  it("routes mouse activation across the middle and right of a card and only once on its handle", () => {
    renderCalendar(dateField());
    const link = screen.getByRole("link", { name: "Launch story" });
    fireEvent.mouseDown(link, { clientX: 70, clientY: 10, button: 0 });
    fireEvent.mouseDown(link, { clientX: 145, clientY: 10, button: 0 });
    fireEvent.mouseDown(screen.getByRole("button", { name: "Move Launch story to another day" }), {
      button: 0,
    });
    expect(drag.mouse).toHaveBeenCalledTimes(3);
    expect(drag.mouse.mock.calls[0]?.[0].clientX).toBe(70);
    expect(drag.mouse.mock.calls[1]?.[0].clientX).toBe(145);
  });

  it("keeps touch scrolling and keyboard activation off the link and on the handle", () => {
    renderCalendar(dateField());
    const link = screen.getByRole("link", { name: "Launch story" });
    fireEvent.touchStart(link);
    fireEvent.keyDown(link, { key: " " });
    expect(drag.touch).not.toHaveBeenCalled();
    expect(drag.keyboard).not.toHaveBeenCalled();
    const handle = screen.getByRole("button", { name: "Move Launch story to another day" });
    fireEvent.touchStart(handle);
    fireEvent.keyDown(handle, { key: " " });
    expect(drag.touch).toHaveBeenCalledTimes(1);
    expect(drag.keyboard).toHaveBeenCalledTimes(1);
  });

  it("preserves ordinary clicks, blocks native link dragging and suppresses clicks after actual drag", () => {
    const { refresh } = renderCalendar(dateField());
    const link = screen.getByRole("link", { name: "Launch story" });
    expect(link.getAttribute("draggable")).toBe("false");
    expect(fireEvent.dragStart(link)).toBe(false);
    fireEvent.mouseDown(link, { button: 0 });
    expect(fireEvent.click(link)).toBe(true);
    drag.isDragging = true;
    refresh();
    drag.isDragging = false;
    refresh();
    expect(fireEvent.click(link)).toBe(false);
    fireEvent.mouseDown(link, { button: 0 });
    expect(fireEvent.click(link)).toBe(true);
  });

  it("does not activate desktop drag on read-only date cards", () => {
    renderCalendar(dateField("created_time"));
    fireEvent.mouseDown(screen.getByRole("link", { name: "Launch story" }), { button: 0 });
    expect(drag.mouse).not.toHaveBeenCalled();
  });

  it("does not swallow a new keyboard activation after a finished or cancelled drag", () => {
    const { refresh } = renderCalendar(dateField());
    const link = screen.getByRole("link", { name: "Launch story" });
    drag.isDragging = true;
    refresh();
    fireEvent.keyDown(link, { key: "Escape" });
    drag.isDragging = false;
    refresh();
    fireEvent.keyDown(link, { key: "Enter" });
    expect(fireEvent.click(link, { detail: 0 })).toBe(true);
    expect(drag.keyboard).not.toHaveBeenCalled();
  });

  it("allows a new touch tap after cancellation without enabling whole-card touch drag", () => {
    const { refresh } = renderCalendar(dateField());
    const link = screen.getByRole("link", { name: "Launch story" });
    drag.isDragging = true;
    refresh();
    fireEvent.touchStart(link);
    drag.isDragging = false;
    refresh();
    expect(fireEvent.click(link)).toBe(false);
    drag.isDragging = true;
    refresh();
    drag.isDragging = false;
    refresh();
    fireEvent.touchStart(link);
    expect(fireEvent.click(link)).toBe(true);
    expect(drag.touch).not.toHaveBeenCalled();
  });
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
