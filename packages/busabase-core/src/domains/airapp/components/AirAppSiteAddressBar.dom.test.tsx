// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { AirAppSiteAddressBar } from "./AirAppSiteAddressBar";

const sharedUrl =
  "https://workspace.busabase.com/api/airapp-preview/app/?__busabase_site_version=v2&__busabase_preview=bounded-share";
const liveUrl = "https://published.sites.test/orders?from=workspace";

function Address({
  url = sharedUrl,
  refreshing = false,
}: {
  url?: string | null;
  refreshing?: boolean;
}) {
  return (
    <CoreI18nProvider locale="en">
      <AirAppSiteAddressBar label="Selected website address" refreshing={refreshing} url={url} />
    </CoreI18nProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Site destination address", () => {
  it("copies and opens the exact displayed selected URL, including its version and capability", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const view = render(<Address />);
    const input = screen.getByRole("textbox", {
      name: "Selected website address",
    }) as HTMLInputElement;
    expect(input.value).toBe(sharedUrl);
    expect(input.readOnly).toBe(true);
    const open = screen.getByRole("link", { name: "Open in new tab" });
    expect(open.getAttribute("href")).toBe(sharedUrl);
    expect(open.getAttribute("target")).toBe("_blank");
    expect(open.getAttribute("rel")).toBe("noopener noreferrer");
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await screen.findByRole("button", { name: "Copied" });
    expect(writeText).toHaveBeenCalledExactlyOnceWith(sharedUrl);

    view.rerender(<Address url={liveUrl} />);
    expect(input.value).toBe(liveUrl);
    expect(screen.getByRole("link", { name: "Open in new tab" }).getAttribute("href")).toBe(
      liveUrl,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(liveUrl));
    expect(writeText).toHaveBeenCalledTimes(2);
  });

  it("selects the full exact address after a denied clipboard write, then recovers", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<Address />);
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await screen.findByRole("status");
    const input = screen.getByRole("textbox", {
      name: "Selected website address",
    }) as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(sharedUrl.length);
    input.scrollLeft = 180;
    fireEvent.blur(input);
    expect(input.scrollLeft).toBe(0);
    writeText.mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await screen.findByRole("button", { name: "Copied" });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("does not focus or select a new destination when copying the previous URL fails later", async () => {
    let rejectCopy!: (error: Error) => void;
    const writeText = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectCopy = reject;
        }),
    );
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const view = render(<Address />);
    const copy = screen.getByRole("button", { name: "Copy link" });
    copy.focus();
    fireEvent.click(copy);
    expect(writeText).toHaveBeenCalledExactlyOnceWith(sharedUrl);
    view.rerender(<Address url={liveUrl} />);
    await act(async () => rejectCopy(new Error("denied after switching views")));
    expect(document.activeElement).toBe(copy);
    expect(screen.getByRole("textbox")).toHaveProperty("value", liveUrl);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("link", { name: "Open in new tab" }).getAttribute("href")).toBe(
      liveUrl,
    );
  });

  it.each(["success", "failure"] as const)(
    "clears previous copy feedback after switching away and back (%s)",
    async (outcome) => {
      const writeText = vi.fn(() =>
        outcome === "success" ? Promise.resolve() : Promise.reject(new Error("denied")),
      );
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
      const view = render(<Address />);
      fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
      if (outcome === "success") await screen.findByRole("button", { name: "Copied" });
      else await screen.findByRole("status");
      view.rerender(<Address url={liveUrl} />);
      expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
      expect(screen.queryByRole("status")).toBeNull();
      view.rerender(<Address />);
      expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
      expect(screen.queryByRole("status")).toBeNull();
    },
  );

  it.each(["success", "failure"] as const)(
    "ignores a pending copy from an earlier visit to the same URL (%s)",
    async (outcome) => {
      let finishCopy!: () => void;
      let failCopy!: (error: Error) => void;
      const writeText = vi.fn(
        () =>
          new Promise<void>((resolve, reject) => {
            finishCopy = resolve;
            failCopy = reject;
          }),
      );
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
      const view = render(<Address />);
      fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
      view.rerender(<Address url={liveUrl} />);
      view.rerender(<Address />);
      await act(async () => {
        if (outcome === "success") finishCopy();
        else failCopy(new Error("denied after returning to preview"));
      });
      expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
      expect(screen.queryByRole("status")).toBeNull();
      expect(screen.getByRole("textbox")).not.toBe(document.activeElement);
    },
  );

  it.each([
    { url: null, refreshing: false },
    { url: sharedUrl, refreshing: true },
    { url: "javascript:alert(1)", refreshing: false },
    { url: "https://user:secret@published.sites.test/", refreshing: false },
  ])(
    "disables copy and external navigation while unavailable ($url, refreshing=$refreshing)",
    ({ url, refreshing }) => {
      render(<Address refreshing={refreshing} url={url} />);
      expect(screen.getByRole("textbox")).toHaveProperty("disabled", true);
      expect(screen.getByRole("button", { name: "Copy link" })).toHaveProperty("disabled", true);
      const open = screen.getByRole("link", { name: "Open in new tab" });
      expect(open.getAttribute("href")).toBeNull();
      expect(open.getAttribute("aria-disabled")).toBe("true");
      expect(open.getAttribute("tabindex")).toBe("-1");
    },
  );

  it("resolves an owner preview URL against the current workspace origin", () => {
    const relative = "/api/airapp-preview/app/?__busabase_site_version=v2";
    render(<Address url={relative} />);
    const absolute = new URL(relative, window.location.origin).href;
    expect(screen.getByRole("textbox")).toHaveProperty("value", absolute);
    expect(screen.getByRole("link", { name: "Open in new tab" }).getAttribute("href")).toBe(
      absolute,
    );
  });
});
