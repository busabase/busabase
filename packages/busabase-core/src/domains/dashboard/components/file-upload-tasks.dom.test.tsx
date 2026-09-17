// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import type { FileUploadTask } from "../helpers/file-upload-task";
import {
  FileUploadTaskPanel,
  MERGED_UPLOAD_AUTO_DISMISS_DELAY_MS,
  useAutoDismissMergedUploadTasks,
} from "./file-upload-tasks";

Object.assign(globalThis, { React });

const makeTask = (overrides: Partial<FileUploadTask> = {}): FileUploadTask => ({
  changeRequestId: null,
  createdAt: 1,
  error: null,
  files: [
    {
      error: null,
      id: "file-1",
      name: "brief.pdf",
      path: "brief.pdf",
      progress: 40,
      size: 100,
      status: "uploading",
    },
  ],
  folder: "",
  id: "task-1",
  merged: false,
  mode: "immediate",
  nodeId: "drive-1",
  nodeName: "Team Files",
  nodeType: "drive",
  retryable: true,
  status: "uploading",
  ...overrides,
});

const renderPanel = (task: FileUploadTask, locale: "en" | "zh-CN" = "en") => {
  const callbacks = {
    onCancel: vi.fn(),
    onDismiss: vi.fn(),
    onExpandedChange: vi.fn(),
    onRetry: vi.fn(),
    onReview: vi.fn(),
  };
  render(
    <CoreI18nProvider locale={locale}>
      <FileUploadTaskPanel expanded tasks={[task]} {...callbacks} />
    </CoreI18nProvider>,
  );
  return callbacks;
};

describe("FileUploadTaskPanel", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows batch and per-file progress and can cancel an active upload", () => {
    const callbacks = renderPanel(makeTask());

    expect(screen.getByRole("complementary", { name: "Uploads" })).toBeTruthy();
    expect(screen.getByText("Team Files")).toBeTruthy();
    expect(screen.getByText("Uploading 40%")).toBeTruthy();
    expect(screen.getByText("Uploading files").getAttribute("aria-live")).toBe("polite");
    expect(screen.getByRole("progressbar", { name: "brief.pdf upload 40% complete" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(callbacks.onCancel).toHaveBeenCalledWith("task-1");
  });

  it("offers retry for a failed localized task", () => {
    const callbacks = renderPanel(
      makeTask({
        error: "连接中断",
        files: [
          {
            error: "连接中断",
            id: "file-1",
            name: "brief.pdf",
            path: "brief.pdf",
            progress: 40,
            size: 100,
            status: "failed",
          },
        ],
        status: "failed",
      }),
      "zh-CN",
    );

    expect(screen.getByText("上传失败")).toBeTruthy();
    expect(screen.getByText("连接中断")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(callbacks.onRetry).toHaveBeenCalledWith("task-1");
  });

  it("keeps a review-mode success non-disruptive until Review is chosen", () => {
    const callbacks = renderPanel(
      makeTask({
        changeRequestId: "cr-1",
        files: [
          {
            error: null,
            id: "file-1",
            name: "brief.pdf",
            path: "brief.pdf",
            progress: 100,
            size: 100,
            status: "succeeded",
          },
        ],
        mode: "changeRequest",
        status: "succeeded",
      }),
    );

    expect(screen.getByText("Upload ready for review")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(callbacks.onReview).toHaveBeenCalledWith("task-1");
  });

  it("hides retry when Change Request submission has an uncertain outcome", () => {
    renderPanel(
      makeTask({
        error: "Could not verify the change request. Check Inbox before trying again.",
        retryable: false,
        status: "failed",
      }),
    );

    expect(
      screen.getByText("Could not verify the change request. Check Inbox before trying again."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });
});

const AutoDismissHarness = ({
  onDismiss,
  tasks,
}: {
  onDismiss: (taskId: string) => void;
  tasks: FileUploadTask[];
}) => {
  useAutoDismissMergedUploadTasks(tasks, onDismiss);
  return null;
};

const mergedTask = (id: string): FileUploadTask =>
  makeTask({
    files: [
      {
        error: null,
        id: `${id}-file`,
        name: `${id}.pdf`,
        path: `${id}.pdf`,
        progress: 100,
        size: 100,
        status: "succeeded",
      },
    ],
    id,
    merged: true,
    status: "succeeded",
  });

describe("merged upload auto-dismiss", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("dismisses only merged successes after the UX delay", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(
      <AutoDismissHarness
        onDismiss={onDismiss}
        tasks={[
          mergedTask("merged"),
          makeTask({ id: "review", mode: "changeRequest", status: "succeeded" }),
          makeTask({ id: "failed", status: "failed" }),
          makeTask({ id: "cancelled", status: "cancelled" }),
          makeTask({ id: "active", status: "uploading" }),
        ]}
      />,
    );

    act(() => vi.advanceTimersByTime(MERGED_UPLOAD_AUTO_DISMISS_DELAY_MS - 1));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledWith("merged");
  });

  it("tracks concurrent successes independently", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const { rerender } = render(
      <AutoDismissHarness onDismiss={onDismiss} tasks={[mergedTask("first")]} />,
    );

    const staggerMs = 500;
    act(() => vi.advanceTimersByTime(staggerMs));
    rerender(
      <AutoDismissHarness
        onDismiss={onDismiss}
        tasks={[mergedTask("first"), mergedTask("second")]}
      />,
    );
    act(() => vi.advanceTimersByTime(MERGED_UPLOAD_AUTO_DISMISS_DELAY_MS - staggerMs));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledWith("first");
    act(() => vi.advanceTimersByTime(staggerMs));
    expect(onDismiss).toHaveBeenNthCalledWith(2, "second");
  });

  it("cleans up timers after manual dismissal and unmount", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const { rerender, unmount } = render(
      <AutoDismissHarness
        onDismiss={onDismiss}
        tasks={[mergedTask("manual"), mergedTask("unmounted")]}
      />,
    );

    rerender(<AutoDismissHarness onDismiss={onDismiss} tasks={[mergedTask("unmounted")]} />);
    unmount();
    act(() => vi.runAllTimers());

    expect(onDismiss).not.toHaveBeenCalled();
  });
});
