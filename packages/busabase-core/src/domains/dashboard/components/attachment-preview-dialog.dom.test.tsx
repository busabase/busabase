// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Dialog, DialogContent, DialogTitle } from "kui/dialog";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { DEFAULT_SIDE_PANEL_WIDTH } from "../side-panel-layout";
import { useSidePanelStore } from "../store/side-panel-store";
import { AttachmentPreviewDialog, type AttachmentPreviewEntry } from "./attachment-preview-dialog";

const state = vi.hoisted(() => ({ mobile: false, mount: vi.fn(), unmount: vi.fn() }));

vi.mock("../hooks/use-side-panel-viewport", () => ({
  useSidePanelViewport: () => state.mobile,
}));
vi.mock("./attachment-viewer", () => ({
  AttachmentViewer: ({ file }: { file: { name: string; url: string } }) => {
    useEffect(() => {
      state.mount(file.name);
      return () => state.unmount(file.name);
    }, [file.name]);
    return <video aria-label={file.name} muted src={file.url} />;
  },
}));

const entries: AttachmentPreviewEntry[] = ["first.mp4", "second.pdf", "third.png"].map(
  (fileName, index) => ({
    key: String(index),
    item: { id: String(index), fileName, mimeType: "video/mp4", size: 100, url: `/${fileName}` },
    url: `/${fileName}`,
  }),
);

const show = (overrides: Partial<Parameters<typeof AttachmentPreviewDialog>[0]> = {}) => (
  <CoreI18nProvider locale="en">
    <AttachmentPreviewDialog
      entries={entries}
      onOpenChange={vi.fn()}
      onSelect={vi.fn()}
      open
      selectedKey="0"
      {...overrides}
    />
  </CoreI18nProvider>
);

interface ControlledPreviewProps {
  onOpenChange: (open: boolean) => void;
}

const ControlledPreview = ({ onOpenChange }: ControlledPreviewProps) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Preview attachment
      </button>
      {show({
        open,
        onOpenChange: (nextOpen) => {
          onOpenChange(nextOpen);
          setOpen(nextOpen);
        },
      })}
    </>
  );
};

const waitForOutsidePointerListener = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const pressPreviewOverlay = async () => {
  await waitForOutsidePointerListener();
  const overlay = screen.getByTestId("attachment-preview-dialog").previousElementSibling;
  if (!(overlay instanceof HTMLElement)) throw new Error("Missing attachment preview overlay");
  fireEvent.pointerDown(overlay, { button: 0, ctrlKey: false, pointerType: "mouse" });
  fireEvent.pointerUp(overlay, { button: 0, pointerType: "mouse" });
  fireEvent.click(overlay, { button: 0, ctrlKey: false });
};

afterEach(() => {
  cleanup();
  state.mobile = false;
  state.mount.mockClear();
  state.unmount.mockClear();
});

describe("attachment preview file panel", () => {
  it("opens at the shared width and keeps the viewer and workspace state across panel toggles", () => {
    useSidePanelStore.setState({ isOpen: true, width: 600 });
    const workspace = useSidePanelStore.getState();
    render(show());
    const panel = screen.getByTestId("attachment-preview-panel");
    const video = screen.getByLabelText("first.mp4", { selector: "video" });
    expect(panel.style.width).toBe(`${DEFAULT_SIDE_PANEL_WIDTH}px`);
    expect(panel.hidden).toBe(false);
    expect(within(panel).getAllByRole("button")).toHaveLength(3);
    expect(panel.querySelector("[data-attachment-list-count]")?.textContent).toBe("3 items");
    expect(within(panel).getByRole("link", { name: "Download file: second.pdf" })).toBeTruthy();
    expect(screen.queryByRole("searchbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Collapse side panel" }));
    expect(panel.hidden).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Open side panel" }));
    expect(screen.getByLabelText("first.mp4", { selector: "video" })).toBe(video);
    expect(state.mount).toHaveBeenCalledTimes(1);
    expect(state.unmount).not.toHaveBeenCalled();
    expect(useSidePanelStore.getState()).toBe(workspace);
  });

  it("selects a named file without collapsing the desktop panel", () => {
    const onSelect = vi.fn();
    render(show({ onSelect }));
    fireEvent.click(screen.getByRole("button", { name: "third.png" }));
    expect(onSelect).toHaveBeenCalledWith("2");
    expect(screen.getByTestId("attachment-preview-panel").hidden).toBe(false);
  });

  it("hides panel navigation for a single file and resets the default when reopened", () => {
    const view = render(show());
    fireEvent.click(screen.getByRole("button", { name: "Collapse side panel" }));
    view.rerender(show({ open: false }));
    view.rerender(show());
    expect(screen.getByTestId("attachment-preview-panel").hidden).toBe(false);
    view.rerender(show({ entries: entries.slice(0, 1) }));
    expect(screen.queryByTestId("attachment-preview-panel")).toBeNull();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Collapse side panel" })).toBeNull();
  });

  it("opens a narrow-screen drawer and Escape closes only that drawer with focus restored", async () => {
    state.mobile = true;
    const onOpenChange = vi.fn();
    render(show({ onOpenChange }));
    expect(screen.queryByTestId("attachment-preview-drawer")).toBeNull();
    const toggle = screen.getByRole("button", { name: "Open side panel" });
    fireEvent.click(toggle);
    expect(screen.getByTestId("attachment-preview-drawer").style.width).toBe("420px");
    expect(
      screen.getByTestId("attachment-preview-drawer").querySelector("[data-attachment-list-count]")
        ?.textContent,
    ).toBe("3 items");
    fireEvent.keyDown(document.activeElement ?? document, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("attachment-preview-drawer")).toBeNull());
    expect(screen.getByTestId("attachment-preview-dialog")).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(toggle));
  });

  it("closes the drawer after selection and retains the same viewer across a breakpoint", async () => {
    const onSelect = vi.fn();
    const view = render(show({ onSelect }));
    const video = screen.getByLabelText("first.mp4", { selector: "video" });
    state.mobile = true;
    view.rerender(show({ onSelect }));
    expect(screen.getByLabelText("first.mp4", { selector: "video" })).toBe(video);
    fireEvent.click(screen.getByRole("button", { name: "Open side panel" }));
    fireEvent.click(screen.getByRole("button", { name: "second.pdf" }));
    expect(onSelect).toHaveBeenCalledWith("1");
    await waitFor(() => expect(screen.queryByTestId("attachment-preview-drawer")).toBeNull());
    state.mobile = false;
    view.rerender(show({ onSelect }));
    expect(screen.getByTestId("attachment-preview-panel").hidden).toBe(false);
    expect(state.mount).toHaveBeenCalledTimes(1);
  });

  it("dismisses an open drawer when returning to desktop and does not reopen it on mobile", async () => {
    state.mobile = true;
    const view = render(show());
    fireEvent.click(screen.getByRole("button", { name: "Open side panel" }));
    expect(screen.getByTestId("attachment-preview-drawer")).toBeTruthy();
    state.mobile = false;
    view.rerender(show());
    await waitFor(() => expect(screen.queryByTestId("attachment-preview-drawer")).toBeNull());
    expect(screen.getByTestId("attachment-preview-panel").hidden).toBe(false);
    state.mobile = true;
    view.rerender(show());
    expect(screen.queryByTestId("attachment-preview-drawer")).toBeNull();
    expect(screen.getByRole("button", { name: "Open side panel" })).toBeTruthy();
    expect(state.mount).toHaveBeenCalledTimes(1);
  });
});

describe("attachment preview dismissal", () => {
  beforeEach(() => {
    if (typeof window.PointerEvent === "undefined") vi.stubGlobal("PointerEvent", MouseEvent);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("requests closing after a desktop overlay pointerdown and click", async () => {
    const onOpenChange = vi.fn();
    render(show({ onOpenChange }));

    await pressPreviewOverlay();

    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("keeps the preview open after a pointerdown and click inside its content", async () => {
    const onOpenChange = vi.fn();
    render(show({ onOpenChange }));
    await waitForOutsidePointerListener();
    const viewer = screen.getByLabelText("first.mp4", { selector: "video" });

    fireEvent.pointerDown(viewer, { button: 0, ctrlKey: false, pointerType: "mouse" });
    fireEvent.pointerUp(viewer, { button: 0, pointerType: "mouse" });
    fireEvent.click(viewer);

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("attachment-preview-dialog")).toBeTruthy();

    await pressPreviewOverlay();
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("requests closing through the header Close button", () => {
    const onOpenChange = vi.fn();
    render(show({ onOpenChange }));

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it.each(["overlay", "Close"] as const)(
    "removes the controlled preview and restores opener focus after %s dismissal",
    async (dismissal) => {
      const onOpenChange = vi.fn();
      render(<ControlledPreview onOpenChange={onOpenChange} />);
      const opener = screen.getByRole("button", { name: "Preview attachment" });
      opener.focus();
      fireEvent.click(opener);
      expect(screen.getByTestId("attachment-preview-dialog")).toBeTruthy();
      await waitFor(() => {
        expect(
          screen.getByTestId("attachment-preview-dialog").contains(document.activeElement),
        ).toBe(true);
      });

      if (dismissal === "overlay") {
        await pressPreviewOverlay();
      } else {
        fireEvent.click(screen.getByRole("button", { name: "Close" }));
      }

      expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
      await waitFor(() => expect(screen.queryByTestId("attachment-preview-dialog")).toBeNull());
      await waitFor(() => expect(document.activeElement).toBe(opener));
    },
  );

  it("closes only the nested preview on its overlay and restores focus inside the record dialog", async () => {
    const onRecordOpenChange = vi.fn();
    const onPreviewOpenChange = vi.fn();
    render(
      <Dialog defaultOpen onOpenChange={onRecordOpenChange}>
        <DialogContent aria-describedby={undefined} showCloseButton={false}>
          <DialogTitle>Record details</DialogTitle>
          <ControlledPreview onOpenChange={onPreviewOpenChange} />
        </DialogContent>
      </Dialog>,
    );
    const record = screen.getByRole("dialog", { name: "Record details" });
    const opener = within(record).getByRole("button", { name: "Preview attachment" });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByTestId("attachment-preview-dialog")).toBeTruthy();

    await pressPreviewOverlay();

    expect(onPreviewOpenChange).toHaveBeenCalledExactlyOnceWith(false);
    expect(onRecordOpenChange).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId("attachment-preview-dialog")).toBeNull());
    expect(screen.getByRole("dialog", { name: "Record details" })).toBe(record);
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});
