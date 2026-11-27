/**
 * @vitest-environment jsdom
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "kui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "kui/dialog";
import { Input } from "kui/input";
import { SidebarProvider } from "kui/sidebar";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpaceSelector } from "./SpaceSelector";

const spaces = [
  { id: "space-1", name: "Workspace", logo: "/logo.svg", plan: "free" },
  { id: "space-2", name: "Another workspace", logo: "/logo.svg", plan: "free" },
];
const actions = ["Add space", "Settings", "Invite members"] as const;
type ModalAction = (typeof actions)[number];

interface HarnessProps {
  onAction?: (action: ModalAction, focusedElement: Element | null) => void;
  onSpaceChange?: () => void;
  restoreWorkspaceFocus?: boolean;
}

const Harness = ({ onAction, onSpaceChange, restoreWorkspaceFocus = false }: HarnessProps) => {
  const [modal, setModal] = useState<ModalAction | null>(null);
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const openModal = (action: ModalAction) => {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    onAction?.(action, document.activeElement);
    setName("");
    setModal(action);
  };

  return (
    <SidebarProvider>
      <Dialog open={modal !== null} onOpenChange={(open) => !open && setModal(null)}>
        {!restoreWorkspaceFocus && (
          <DialogTrigger asChild>
            <button type="button">Other dialog trigger</button>
          </DialogTrigger>
        )}
        <SpaceSelector
          spaces={spaces}
          activeSpace={spaces[0]}
          onAddSpace={() => openModal("Add space")}
          onSettingsClick={() => openModal("Settings")}
          onInviteMembersClick={() => openModal("Invite members")}
          onSpaceChange={onSpaceChange}
        />
        <DialogContent
          onCloseAutoFocus={
            restoreWorkspaceFocus
              ? (event) => {
                  event.preventDefault();
                  returnFocusRef.current?.focus();
                }
              : undefined
          }
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <DialogTitle>{modal}</DialogTitle>
          <DialogDescription>Workspace action</DialogDescription>
          <Input
            ref={inputRef}
            aria-label="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <DialogClose asChild>
            <Button>Cancel</Button>
          </DialogClose>
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  );
};

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const openMenu = async () => {
  const trigger = screen.getByRole("button", { name: /Workspace/ });
  await userEvent.click(trigger);
  return { trigger, menu: await screen.findByRole("menu") };
};

const activateAction = async (action: ModalAction) => {
  const { trigger, menu } = await openMenu();
  await userEvent.click(
    screen.getByRole(action === "Add space" ? "menuitem" : "button", { name: action }),
  );
  return { trigger, menu };
};

const suspendMenuExit = () => {
  const getComputedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudoElement) => {
    const styles = getComputedStyle(element, pseudoElement);
    if (element.getAttribute("role") === "menu") {
      Object.defineProperty(styles, "animationName", {
        get: () =>
          element.getAttribute("data-state") === "closed"
            ? "space-selector-exit"
            : "space-selector-enter",
      });
    }
    return styles;
  });
  if (!window.CSS?.escape) {
    vi.stubGlobal("CSS", { ...window.CSS, escape: (value: string) => value });
  }
};

const finishMenuExit = (menu: HTMLElement) => {
  const animationEnd = new Event("animationend", { bubbles: true });
  Object.defineProperty(animationEnd, "animationName", { value: "space-selector-exit" });
  fireEvent(menu, animationEnd);
};

describe("SpaceSelector real Radix focus handoff", () => {
  it.each(actions)(
    "returns focus before opening %s and preserves typed prefixes",
    async (action) => {
      const onAction = vi.fn();
      render(<Harness onAction={onAction} />);
      const { trigger } = await activateAction(action);
      const input = (await screen.findByRole("textbox", { name: "Name" })) as HTMLInputElement;

      expect(onAction).toHaveBeenCalledExactlyOnceWith(action, trigger);
      expect(screen.queryByRole("menu", { hidden: true })).toBeNull();
      expect(document.activeElement).toBe(input);
      await userEvent.keyboard("pre");
      expect(input.value).toBe("pre");
      expect(input.selectionStart).toBe(3);
      expect(input.selectionEnd).toBe(3);
      await userEvent.keyboard("fix");
      expect(input.value).toBe("prefix");
      expect(document.activeElement).toBe(input);
    },
  );

  it.each(actions)(
    "waits for the real Presence exit lifecycle before opening %s",
    async (action) => {
      suspendMenuExit();
      const onAction = vi.fn();
      render(<Harness onAction={onAction} />);
      const { trigger, menu } = await activateAction(action);

      expect(menu.isConnected).toBe(true);
      expect(menu.getAttribute("data-state")).toBe("closed");
      expect(onAction).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog")).toBeNull();

      finishMenuExit(menu);
      const input = (await screen.findByRole("textbox", { name: "Name" })) as HTMLInputElement;
      expect(menu.isConnected).toBe(false);
      expect(onAction).toHaveBeenCalledExactlyOnceWith(action, trigger);
      await userEvent.keyboard("pre");
      expect(input.selectionStart).toBe(3);
      expect(input.selectionEnd).toBe(3);
      await userEvent.keyboard("fix");
      expect(input.value).toBe("prefix");
      expect(document.activeElement).toBe(input);
    },
  );

  it.each(actions)("hands keyboard activation of %s over after restoring focus", async (action) => {
    const onAction = vi.fn();
    render(<Harness onAction={onAction} />);
    const { trigger } = await openMenu();
    const actionElement = screen.getByRole(action === "Add space" ? "menuitem" : "button", {
      name: action,
    });
    actionElement.focus();
    await userEvent.keyboard("{Enter}");

    await screen.findByRole("textbox", { name: "Name" });
    expect(onAction).toHaveBeenCalledExactlyOnceWith(action, trigger);
  });

  it("keeps Escape's normal focus restoration without opening a modal", async () => {
    const onAction = vi.fn();
    render(<Harness onAction={onAction} />);
    const { trigger } = await openMenu();
    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(screen.queryByRole("menu", { hidden: true })).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps workspace selection's normal focus restoration", async () => {
    const onAction = vi.fn();
    const onSpaceChange = vi.fn();
    render(<Harness onAction={onAction} onSpaceChange={onSpaceChange} />);
    const { trigger } = await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: /Another workspace/ }));

    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(onSpaceChange).toHaveBeenCalledExactlyOnceWith(spaces[1]);
    expect(onAction).not.toHaveBeenCalled();
  });

  it("preserves the dialog's own return target after Cancel", async () => {
    render(<Harness />);
    await activateAction("Add space");
    await screen.findByRole("dialog");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Other dialog trigger" }),
      ),
    );
  });

  it.each(actions)(
    "lets a host without DialogTrigger return from %s to the captured workspace trigger",
    async (action) => {
      render(<Harness restoreWorkspaceFocus />);
      const { trigger } = await activateAction(action);
      await screen.findByRole("dialog");
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

      await waitFor(() => expect(document.activeElement).toBe(trigger));
      expect(screen.queryByRole("dialog")).toBeNull();
    },
  );

  it("consumes pending actions once across immediate Cancel and reopen", async () => {
    const onAction = vi.fn();
    render(<Harness onAction={onAction} restoreWorkspaceFocus />);

    for (const action of actions) {
      const { trigger } = await activateAction(action);
      await screen.findByRole("textbox", { name: "Name" });
      expect(onAction).toHaveBeenLastCalledWith(action, trigger);
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await waitFor(() => expect(document.activeElement).toBe(trigger));
    }

    const { trigger } = await openMenu();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(onAction.mock.calls.map(([action]) => action)).toEqual(actions);
  });

  it("discards a pending action when the menu reopens before its exit completes", async () => {
    suspendMenuExit();
    const onAction = vi.fn();
    render(<Harness onAction={onAction} />);
    const { trigger, menu } = await activateAction("Add space");
    expect(onAction).not.toHaveBeenCalled();

    await userEvent.click(trigger);
    expect(menu.getAttribute("data-state")).toBe("open");
    await userEvent.keyboard("{Escape}");
    finishMenuExit(menu);

    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it.each(actions)("discards pending %s when its selector unmounts during exit", async (action) => {
    suspendMenuExit();
    const onAction = vi.fn();
    const { unmount } = render(<Harness onAction={onAction} />);
    const { menu } = await activateAction(action);
    const onCloseAutoFocus = vi.fn();
    menu.addEventListener("focusScope.autoFocusOnUnmount", onCloseAutoFocus);
    expect(onAction).not.toHaveBeenCalled();

    unmount();
    await waitFor(() => expect(onCloseAutoFocus).toHaveBeenCalledOnce());
    expect(onAction).not.toHaveBeenCalled();
  });

  it("discards an already queued modal action when trigger focus unmounts the selector", async () => {
    suspendMenuExit();
    const onAction = vi.fn();
    const { unmount } = render(<Harness onAction={onAction} />);
    const { trigger, menu } = await activateAction("Add space");
    const onCloseAutoFocus = vi.fn();
    menu.addEventListener("focusScope.autoFocusOnUnmount", onCloseAutoFocus);
    trigger.addEventListener("focus", () => act(unmount), { once: true });

    finishMenuExit(menu);
    await waitFor(() => expect(onCloseAutoFocus).toHaveBeenCalledOnce());
    expect(onAction).not.toHaveBeenCalled();
  });
});
