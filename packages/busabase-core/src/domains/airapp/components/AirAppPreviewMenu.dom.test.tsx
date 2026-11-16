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

function Menu({ kind = "site" }: { kind?: "site" | "browser" }) {
  const url = "/api/airapp-preview/app/?__busabase_site_version=v1";
  const previewState = useAirAppPreviewState(url);
  return (
    <CoreI18nProvider locale="en">
      <AirAppPreviewMenu kind={kind} previewState={previewState} url={url} />
    </CoreI18nProvider>
  );
}

const openMenu = () =>
  fireEvent.pointerDown(screen.getByRole("button", { name: "Sites" }), {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });

describe("preview actions in Sites", () => {
  it("falls back to the selectable exact URL if the clipboard API is absent and recovers on retry", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    render(<Menu />);
    openMenu();
    const input = screen.getByRole("textbox", { name: "Preview link" }) as HTMLInputElement;
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy link" }));
    await screen.findByText(/Select the address above/);
    expect(document.activeElement).toBe(input);
    fireEvent.focus(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
    expect(input.value).toBe(
      new URL("/api/airapp-preview/app/?__busabase_site_version=v1", window.location.origin).href,
    );
    fireEvent.keyDown(input, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Copy link" }));
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy link" }));
    await screen.findByRole("menuitem", { name: "Copied" });
    expect(writeText).toHaveBeenCalledExactlyOnceWith(input.value);
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

  it("explains browser-only phone access in the QR submenu without generating a misleading code", async () => {
    render(<Menu kind="browser" />);
    openMenu();
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Preview on your phone" }), {
      key: "ArrowRight",
    });
    await screen.findByText(/prepare a Site preview using Publish Site/);
    expect(encode).not.toHaveBeenCalled();
    expect(screen.queryByRole("img")).toBeNull();
    fireEvent.keyDown(screen.getByRole("menu", { name: "Preview on your phone" }), {
      key: "Escape",
    });
    await waitFor(() =>
      expect(screen.queryByText(/prepare a Site preview using Publish Site/)).toBeNull(),
    );
    expect(screen.getAllByRole("button", { name: "Sites" })).toHaveLength(1);
  });
});
