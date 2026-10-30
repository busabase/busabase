// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "kui/dropdown-menu";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { ConfirmActionDialog } from "./primitives";

function Confirmation({ pending = false, onConfirm = vi.fn() }) {
  const [open, setOpen] = useState(false);
  return (
    <CoreI18nProvider locale="en">
      <header style={{ backdropFilter: "blur(8px)", overflow: "hidden", height: 40 }}>
        <button onClick={() => setOpen(true)} type="button">
          Archive project
        </button>
        <ConfirmActionDialog
          body="Project Alpha can be restored from Trash."
          confirmLabel="Move to Trash"
          onCancel={() => setOpen(false)}
          onConfirm={onConfirm}
          open={open}
          pending={pending}
          title="Move Project Alpha to Trash?"
        />
      </header>
    </CoreI18nProvider>
  );
}

function MenuConfirmation() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <CoreI18nProvider locale="en">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button ref={triggerRef} type="button">
            More actions
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => setOpen(true)}>Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {open && (
        <ConfirmActionDialog
          body="Project Alpha can be restored from Trash."
          confirmLabel="Move to Trash"
          onCancel={() => setOpen(false)}
          onConfirm={() => undefined}
          open
          returnFocusRef={triggerRef}
          title="Move Project Alpha to Trash?"
        />
      )}
    </CoreI18nProvider>
  );
}

const openConfirmation = () => {
  const trigger = screen.getByRole("button", { name: "Archive project" });
  trigger.focus();
  fireEvent.click(trigger);
  return trigger;
};

afterEach(cleanup);

describe("ConfirmActionDialog", () => {
  it("returns focus to a real dropdown trigger after its selected menu item unmounts", async () => {
    render(<MenuConfirmation />);
    const trigger = screen.getByRole("button", { name: "More actions" });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
    await screen.findByRole("dialog");
    expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
    const cancel = screen.getByRole("button", { name: "Cancel" });
    await waitFor(() => expect(document.activeElement).toBe(cancel));
    fireEvent.keyDown(cancel, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("escapes a clipped header, describes the exact action, and cancels without submitting", async () => {
    const onConfirm = vi.fn();
    render(<Confirmation onConfirm={onConfirm} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    const trigger = openConfirmation();
    const dialog = await screen.findByRole("dialog", { name: "Move Project Alpha to Trash?" });
    expect(dialog.closest("header")).toBeNull();
    expect(
      document.getElementById(dialog.getAttribute("aria-describedby") ?? "")?.textContent,
    ).toBe("Project Alpha can be restored from Trash.");
    const cancel = screen.getByRole("button", { name: "Cancel" });
    await waitFor(() => expect(document.activeElement).toBe(cancel));
    fireEvent.click(cancel);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onConfirm).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
  });

  it("allows Escape to cancel and only the explicit confirm action submits", async () => {
    const onConfirm = vi.fn();
    render(<Confirmation onConfirm={onConfirm} />);
    openConfirmation();
    await screen.findByRole("dialog");
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onConfirm).not.toHaveBeenCalled();
    openConfirmation();
    fireEvent.click(await screen.findByRole("button", { name: "Move to Trash" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("keeps an in-flight operation visible and prevents cancellation or duplicate submits", async () => {
    const onConfirm = vi.fn();
    render(<Confirmation onConfirm={onConfirm} pending />);
    openConfirmation();
    const dialog = await screen.findByRole("dialog");
    const confirm = screen.getByRole("button", { name: "Working..." });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    expect((cancel as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(confirm);
    fireEvent.click(cancel);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
