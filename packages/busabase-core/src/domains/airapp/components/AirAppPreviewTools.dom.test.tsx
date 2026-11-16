// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import {
  AirAppPreviewTools,
  type AirAppPreviewViewport,
  absolutePreviewUrl,
} from "./AirAppPreviewTools";

const encode = vi.hoisted(() => vi.fn(async (url: string) => `data:image/png;base64,${btoa(url)}`));
vi.mock("qrcode", () => ({ default: { toDataURL: encode } }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  encode.mockClear();
});

function Preview({
  url = "/api/airapp-preview/app/?__busabase_site_version=v1",
  kind = "site",
}: {
  url?: string | null;
  kind?: "site" | "browser";
}) {
  const [viewport, setViewport] = useState<AirAppPreviewViewport>("desktop");
  return (
    <CoreI18nProvider locale="en">
      <AirAppPreviewTools kind={kind} setViewport={setViewport} url={url} viewport={viewport} />
    </CoreI18nProvider>
  );
}

describe("preview device access", () => {
  it("opens the exact versioned preview in an isolated separate window", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(<Preview />);
    fireEvent.click(screen.getByRole("button", { name: "Open preview in new window" }));
    expect(open).toHaveBeenCalledWith(
      expect.stringContaining("/api/airapp-preview/app/?__busabase_site_version=v1"),
      "_blank",
      "noopener,noreferrer,popup",
    );
  });

  it("shows a directly copyable exact URL with success feedback before opening the QR", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<Preview />);
    const input = screen.getByRole("textbox", { name: "Preview link" }) as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    expect(input.value).toContain("__busabase_site_version=v1");
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await screen.findByRole("button", { name: "Copied" });
    expect(writeText).toHaveBeenCalledExactlyOnceWith(input.value);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(encode).not.toHaveBeenCalled();
  });

  it("offers an authenticated absolute preview QR with a selectable copy fallback", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("clipboard denied")) },
    });
    render(<Preview />);
    fireEvent.click(screen.getByRole("button", { name: "Preview on your phone" }));
    await screen.findByRole("img");
    const input = screen.getByRole("textbox", { name: "Preview link" }) as HTMLInputElement;
    expect(input.value).toBe(
      new URL("/api/airapp-preview/app/?__busabase_site_version=v1", window.location.origin).href,
    );
    expect(encode).toHaveBeenCalledWith(input.value, expect.objectContaining({ margin: 4 }));
    expect(screen.getByText(/Sign in with the same account/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await screen.findByText(/Select the address above/);
    fireEvent.focus(input);
    expect(input.selectionEnd).toBe(input.value.length);
    expect(screen.getByRole("button", { name: "Open preview in new window" })).toBeTruthy();
  });

  it("opens a non-modal QR popup and closes it with Escape, its trigger, or the close control", async () => {
    render(<Preview />);
    const trigger = screen.getByRole("button", { name: "Preview on your phone" });
    expect(trigger.getAttribute("title")).toBeNull();
    trigger.focus();
    fireEvent.click(trigger);
    const popup = await screen.findByRole("dialog", { name: "Preview on your phone" });
    expect(popup.getAttribute("aria-modal")).not.toBe("true");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(popup, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    fireEvent.click(trigger);
    await screen.findByRole("dialog");
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(trigger);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("keeps one selected viewport and supports keyboard movement between device options", async () => {
    render(<Preview />);
    const desktop = screen.getByRole("radio", { name: "Desktop" });
    const mobile = screen.getByRole("radio", { name: "Mobile" });
    expect(desktop.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(desktop);
    expect(desktop.getAttribute("aria-checked")).toBe("true");
    desktop.focus();
    fireEvent.keyDown(desktop, { key: "ArrowRight" });
    await waitFor(() => expect(document.activeElement).toBe(mobile));
    fireEvent.click(mobile);
    expect(mobile.getAttribute("aria-checked")).toBe("true");
    expect(desktop.getAttribute("aria-checked")).toBe("false");
    expect(desktop.textContent).toBe("Desktop");
    expect(mobile.textContent).toBe("Mobile");
  });

  it("replaces an open QR when the prepared preview version changes", async () => {
    const { rerender } = render(<Preview />);
    fireEvent.click(screen.getByRole("button", { name: "Preview on your phone" }));
    const previousImage = await screen.findByRole("img");
    const previousSrc = previousImage.getAttribute("src");
    rerender(<Preview url="/api/airapp-preview/app/?__busabase_site_version=v2" />);
    await waitFor(() => expect(screen.getByRole("img").getAttribute("src")).not.toBe(previousSrc));
    expect(encode).toHaveBeenLastCalledWith(
      expect.stringContaining("__busabase_site_version=v2"),
      expect.any(Object),
    );
  });

  it("explains browser-only phone access without producing a misleading QR", () => {
    render(<Preview kind="browser" />);
    fireEvent.click(screen.getByRole("button", { name: "Preview on your phone" }));
    expect(screen.getByText(/prepare a Site preview using Publish Site/)).toBeTruthy();
    expect(encode).not.toHaveBeenCalled();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("explains why a phone cannot open a loopback preview address", async () => {
    render(<Preview url="http://127.0.0.1:15470/api/airapp-preview/app/" />);
    fireEvent.click(screen.getByRole("button", { name: "Preview on your phone" }));
    expect(screen.getByText(/A phone cannot reach this computer/)).toBeTruthy();
    await screen.findByRole("img");
  });

  it("keeps controls unavailable until a safe ready URL exists", () => {
    render(<Preview url={null} />);
    for (const button of [...screen.getAllByRole("button"), ...screen.getAllByRole("radio")])
      expect(button.hasAttribute("disabled")).toBe(true);
    expect(absolutePreviewUrl("javascript:alert(1)", "https://app.test")).toBeNull();
    expect(absolutePreviewUrl("https://secret@example.test", "https://app.test")).toBeNull();
  });
});
