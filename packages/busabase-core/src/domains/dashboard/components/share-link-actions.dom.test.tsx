// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Dialog, DialogContent, DialogTitle } from "kui/dialog";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { ShareLinkActions } from "./share-link-actions";

const encode = vi.hoisted(() => vi.fn(async (url: string) => `data:image/png;base64,${btoa(url)}`));
const errorToast = vi.hoisted(() => vi.fn());
vi.mock("qrcode", () => ({ default: { toDataURL: encode } }));
vi.mock("sonner", () => ({ toast: { error: errorToast } }));
const originalShare = Object.getOwnPropertyDescriptor(navigator, "share");
beforeEach(() => {
  encode.mockReset().mockImplementation(async (url) => `data:image/png;base64,${btoa(url)}`);
  errorToast.mockReset();
  Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (originalShare) Object.defineProperty(navigator, "share", originalShare);
  else delete (navigator as { share?: unknown }).share;
});
const firstUrl = "https://published.busabase.app/?revision=v1";
const nextUrl = "https://published.busabase.app/?revision=v2";
const Actions = ({
  url = firstUrl,
  compact = false,
  description,
}: {
  url?: string;
  compact?: boolean;
  description?: string;
}) => (
  <CoreI18nProvider locale="en">
    <ShareLinkActions
      compact={compact}
      description={description}
      title="Release Studio"
      url={url}
    />
  </CoreI18nProvider>
);

describe("shared public and preview QR surface", () => {
  it("opens a compact portalled surface without expanding the action row and closes with Escape", async () => {
    const { container } = render(
      <Actions compact description="Only the published version is included." />,
    );
    const trigger = screen.getByRole("button", { name: "QR code" });
    trigger.focus();
    fireEvent.click(trigger);
    const popup = await screen.findByRole("dialog", { name: "QR code" });
    expect(container.contains(popup)).toBe(false);
    expect(screen.getByText("Only the published version is included.")).toBeTruthy();
    expect((await screen.findByRole("img")).getAttribute("src")).toBe(
      `data:image/png;base64,${btoa(firstUrl)}`,
    );
    fireEvent.keyDown(popup, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("does not generate or display a QR until requested", () => {
    render(<Actions />);
    expect(encode).not.toHaveBeenCalled();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
  });

  it("downloads the exact currently displayed image", async () => {
    let downloaded: { href: string; name: string } | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloaded = { href: this.href, name: this.download };
    });
    render(<Actions />);
    fireEvent.click(screen.getByRole("button", { name: "QR code" }));
    const image = await screen.findByRole("img");
    fireEvent.click(screen.getByRole("button", { name: "Download PNG" }));
    expect(downloaded).toEqual({ href: image.getAttribute("src"), name: "busabase-qr.png" });
    expect(encode).toHaveBeenCalledExactlyOnceWith(
      firstUrl,
      expect.objectContaining({
        margin: 4,
        width: 512,
        color: { dark: "#000000", light: "#ffffff" },
      }),
    );
  });

  it("hides an old QR immediately during a URL change and ignores a late old generation", async () => {
    let resolveFirst: ((image: string) => void) | undefined;
    let resolveNext: ((image: string) => void) | undefined;
    encode.mockImplementation(
      (url) =>
        new Promise<string>((resolve) => {
          if (url === firstUrl) resolveFirst = resolve;
          else resolveNext = resolve;
        }),
    );
    const { rerender } = render(<Actions />);
    fireEvent.click(screen.getByRole("button", { name: "QR code" }));
    await waitFor(() => expect(resolveFirst).toBeTypeOf("function"));
    rerender(<Actions url={nextUrl} />);
    await waitFor(() => expect(resolveNext).toBeTypeOf("function"));
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByRole("button", { name: "Download PNG" }).hasAttribute("disabled")).toBe(
      true,
    );
    await act(async () => {
      resolveNext?.("data:image/png;base64,bmV3");
    });
    expect((await screen.findByRole("img")).getAttribute("src")).toBe("data:image/png;base64,bmV3");
    await act(async () => {
      resolveFirst?.("data:image/png;base64,b2xk");
    });
    expect(screen.getByRole("img").getAttribute("src")).toBe("data:image/png;base64,bmV3");
  });

  it("removes an already rendered old QR while the next URL is loading", async () => {
    const { rerender } = render(<Actions />);
    fireEvent.click(screen.getByRole("button", { name: "QR code" }));
    await screen.findByRole("img");
    let finish: ((image: string) => void) | undefined;
    encode.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    rerender(<Actions url={nextUrl} />);
    expect(screen.queryByRole("img")).toBeNull();
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    await act(async () => {
      finish?.("data:image/png;base64,bmV3");
    });
    expect((await screen.findByRole("img")).getAttribute("src")).toBe("data:image/png;base64,bmV3");
  });

  it("offers a retry after generation fails without retaining a stale download", async () => {
    encode.mockRejectedValueOnce(new Error("QR generation failed"));
    render(<Actions />);
    fireEvent.click(screen.getByRole("button", { name: "QR code" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Could not generate QR code",
    );
    expect(screen.getByRole("button", { name: "Download PNG" }).hasAttribute("disabled")).toBe(
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("img");
    expect(encode).toHaveBeenCalledTimes(2);
  });

  it("keeps native share cancellation quiet and passes the exact URL", async () => {
    const share = vi.fn().mockRejectedValue(new DOMException("Cancelled", "AbortError"));
    Object.defineProperty(navigator, "share", { configurable: true, value: share });
    render(<Actions compact />);
    fireEvent.click(await screen.findByRole("button", { name: "Share" }));
    await waitFor(() =>
      expect(share).toHaveBeenCalledExactlyOnceWith({ title: "Release Studio", url: firstUrl }),
    );
    expect(errorToast).not.toHaveBeenCalled();
  });

  it("closes a nested QR popup before its share dialog and restores focus", async () => {
    function ShareDialog() {
      const [open, setOpen] = useState(true);
      return (
        <CoreI18nProvider locale="en">
          <Dialog onOpenChange={setOpen} open={open}>
            <DialogContent>
              <DialogTitle>Share app</DialogTitle>
              <ShareLinkActions title="Release Studio" url={firstUrl} />
            </DialogContent>
          </Dialog>
        </CoreI18nProvider>
      );
    }
    render(<ShareDialog />);
    const trigger = screen.getByRole("button", { name: "QR code" });
    fireEvent.click(trigger);
    const popup = await screen.findByRole("dialog", { name: "QR code" });
    await screen.findByRole("img");
    fireEvent.keyDown(popup, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "QR code" })).toBeNull());
    expect(screen.getByRole("dialog", { name: "Share app" })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
