// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { useAirAppPreviewState } from "../hooks/use-airapp-preview-state";
import { AirAppPreviewMenu } from "./AirAppPreviewMenu";

const encode = vi.hoisted(() => vi.fn(async (url: string) => `data:image/png;base64,${btoa(url)}`));
vi.mock("qrcode", () => ({ default: { toDataURL: encode } }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  encode.mockClear();
});

function Menu({
  kind = "site",
  url = "/api/airapp-preview/app/?__busabase_site_version=v1",
  shareable = false,
  refreshing = false,
}: {
  kind?: "site" | "browser" | "local" | "remote";
  url?: string | null;
  refreshing?: boolean;
  shareable?: boolean;
}) {
  const previewState = useAirAppPreviewState("/api/airapp-preview/app/?__busabase_site_version=v1");
  return (
    <CoreI18nProvider locale="en">
      <AirAppPreviewMenu
        kind={kind}
        previewState={{ ...previewState, refreshing: refreshing || previewState.refreshing }}
        shareable={shareable}
        url={url}
      />
    </CoreI18nProvider>
  );
}

const openMenu = () =>
  fireEvent.pointerDown(screen.getByRole("button", { name: "Preview & publish" }), {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });

describe("preview and publication actions", () => {
  it("makes the exact preview address a native new-tab link without a second open action", () => {
    render(<Menu />);
    openMenu();
    const link = screen.getByRole("link", { name: "Preview link" });
    expect(link.getAttribute("href")).toBe(
      new URL("/api/airapp-preview/app/?__busabase_site_version=v1", window.location.origin).href,
    );
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.queryByRole("menuitem", { name: "Open preview in new window" })).toBeNull();
  });

  it("copies the shared private version in a narrow Sites menu and generates its exact QR", async () => {
    const url =
      "https://workspace.busabase.com/api/airapp-preview/app/?__busabase_site_version=v1&__busabase_preview=bounded-share-link";
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    Element.prototype.scrollIntoView ??= () => undefined;
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    render(<Menu shareable url={url} />);
    openMenu();
    expect(screen.getByRole("link", { name: "Preview link" }).getAttribute("href")).toBe(url);
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith(url));
    fireEvent.click(screen.getByRole("menuitem", { name: "Preview on your phone" }));
    await screen.findByRole("img");
    expect(encode).toHaveBeenCalledExactlyOnceWith(url, expect.any(Object));
    expect(screen.queryByText(/Sign in with the same account/)).toBeNull();
    expect(
      screen.getByText(/Anyone with this link can preview this version for up to 24 hours/),
    ).toBeTruthy();
  });

  it("falls back to the selectable exact URL if the clipboard API is absent and recovers on retry", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    render(<Menu />);
    openMenu();
    const link = screen.getByRole("link", { name: "Preview link" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy link" }));
    await screen.findByText(/Select the address above/);
    expect(document.activeElement).toBe(link);
    expect(link.getAttribute("dir")).toBe("ltr");
    expect(window.getSelection()?.toString()).toBe(link.textContent);
    expect(link.getAttribute("href")).toBe(
      new URL("/api/airapp-preview/app/?__busabase_site_version=v1", window.location.origin).href,
    );
    fireEvent.keyDown(link, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Copy link" }));
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy link" }));
    await screen.findByRole("menuitem", { name: "Copied" });
    expect(writeText).toHaveBeenCalledExactlyOnceWith(link.getAttribute("href"));
    expect(screen.queryByText(/Select the address above/)).toBeNull();
  });

  it("keeps phone QR content inside the same menu on narrow screens", async () => {
    Element.prototype.scrollIntoView ??= () => undefined;
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    render(<Menu />);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Preview on your phone" }));
    const image = await screen.findByRole("img");
    expect(image.closest('[role="menu"]')).toBe(screen.getByRole("menu"));
    expect(screen.getAllByRole("menu")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Copy link" })).toBeTruthy();
  });

  it("hides an open desktop phone submenu when its URL becomes unavailable", async () => {
    const { rerender } = render(<Menu />);
    openMenu();
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Preview on your phone" }), {
      key: "ArrowRight",
    });
    await screen.findByRole("img");
    rerender(<Menu url={null} />);
    await waitFor(() => expect(screen.queryByRole("img")).toBeNull());
    expect(screen.queryByRole("menu", { name: "Preview on your phone" })).toBeNull();
  });

  it("hides an open inline phone QR during refresh without closing the main menu", async () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const { rerender } = render(<Menu />);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Preview on your phone" }));
    await screen.findByRole("img");
    rerender(<Menu refreshing />);
    await waitFor(() => expect(screen.queryByRole("img")).toBeNull());
    expect(screen.getAllByRole("menu")).toHaveLength(1);
    expect(
      screen.getByRole("menuitem", { name: "Preview on your phone" }).getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it.each(
    (["browser", "local", "remote"] as const).flatMap((kind) =>
      [false, true].map((narrow) => ({ kind, narrow })),
    ),
  )("hides unsupported phone QR previews (kind=$kind, narrow=$narrow)", ({ kind, narrow }) => {
    vi.stubGlobal("matchMedia", () => ({
      matches: narrow,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    render(<Menu kind={kind} />);
    openMenu();
    expect(screen.queryByRole("menuitem", { name: "Preview on your phone" })).toBeNull();
    expect(screen.getByRole("menuitemradio", { name: "Mobile" })).toBeTruthy();
    expect(encode).not.toHaveBeenCalled();
  });
});
