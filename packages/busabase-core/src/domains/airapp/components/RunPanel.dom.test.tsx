// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider, type CoreLocale } from "../../../i18n";
import {
  type AirAppRunnerState,
  AirAppRunPreview,
  AirAppServiceWorkerUnsupported,
  useAirAppFullscreen,
} from "./RunPanel";

/**
 * `AirAppServiceWorkerUnsupported` is the recovery state for
 * `SERVICE_WORKER_UNAVAILABLE` (e.g. iOS in-app browsers such as WeCom, which
 * expose no `navigator.serviceWorker` at all). No in-app retry can fix this —
 * the only path forward is copying the current URL into a real browser — so
 * the copy action and its jsdom-unmockable fallback need a real DOM and a
 * real click; `renderToStaticMarkup` cannot exercise either.
 */
const renderUnsupported = (locale: CoreLocale = "en") =>
  render(
    <CoreI18nProvider locale={locale}>
      <AirAppServiceWorkerUnsupported />
    </CoreI18nProvider>,
  );

let written: string[] = [];

beforeEach(() => {
  written = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: (text: string) => {
        written.push(text);
        return Promise.resolve();
      },
    },
  });
});

afterEach(() => {
  cleanup();
});

describe("AirAppServiceWorkerUnsupported", () => {
  it("replaces the generic run failure when the runner reports the capability error", () => {
    const runner = {
      status: "error",
      logLines: [],
      previewUrl: null,
      error: "generic error that should not render",
      errorCode: "SERVICE_WORKER_UNAVAILABLE",
      run: vi.fn(),
      stop: vi.fn(),
      isBusy: false,
      isLive: false,
    } satisfies AirAppRunnerState;

    render(
      <CoreI18nProvider locale="en">
        <AirAppRunPreview airapp={null} runner={runner} showToolbar={false} />
      </CoreI18nProvider>,
    );

    expect(document.querySelector("[data-airapp-sw-unsupported]")).toBeTruthy();
    expect(screen.queryByText("generic error that should not render")).toBeNull();
    expect(screen.queryByText("Preview unavailable")).toBeNull();
  });

  it("copies the current page URL when the clipboard write succeeds", async () => {
    renderUnsupported();

    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));

    await vi.waitFor(() => expect(written).toHaveLength(1));
    expect(written[0]).toBe(window.location.href);
    // Success has no manual-copy fallback to fall back to.
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it.each([
    ["en", "Copy link", "Couldn't copy the link. Select and copy it manually:"],
    ["zh-CN", "复制链接", "链接复制失败，请手动选中并复制："],
    ["zh-TW", "複製連結", "連結複製失敗，請手動選取並複製："],
    ["ja", "リンクをコピー", "リンクをコピーできませんでした。以下を選択してコピーしてください："],
  ] satisfies [CoreLocale, string, string][])(
    "falls back to a selectable link when the clipboard write rejects, in %s",
    async (locale, copyLabel, fallbackMessage) => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: () => Promise.reject(new Error("denied")),
        },
      });
      renderUnsupported(locale);

      fireEvent.click(screen.getByRole("button", { name: copyLabel }));

      const input = (await screen.findByRole("textbox")) as HTMLInputElement;
      expect(await screen.findByText(fallbackMessage)).toBeTruthy();
      expect(input.value).toBe(window.location.href);
      expect(input).toHaveProperty("readOnly", true);
      expect(document.activeElement).toBe(input);
      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe(input.value.length);
    },
  );
});

/**
 * Regression cover for the reload trap: `?fullscreen=1` restores the
 * full-viewport overlay immediately, but the runner restarts from `idle`, so
 * `previewUrl` is null for as long as install/start takes — and forever if the
 * run fails. The exit control used to be gated on that same `previewUrl`,
 * which left the user pinned behind a full-screen surface with no visible way
 * back. Readiness may gate *entering* fullscreen; it must never gate leaving.
 */
const notReadyRunner = (
  status: AirAppRunnerState["status"],
  error: string | null = null,
): AirAppRunnerState => ({
  status,
  logLines: [],
  previewUrl: null,
  error,
  errorCode: null,
  run: vi.fn(),
  stop: vi.fn(),
  isBusy: status === "installing" || status === "starting",
  isLive: false,
});

/** Mirrors AirAppDetailView's URL-backed wiring (`syncWithUrl: true`). */
function UrlBackedPreview({ runner }: { runner: AirAppRunnerState }) {
  const fullscreenState = useAirAppFullscreen({ syncWithUrl: true });
  return (
    <AirAppRunPreview
      airapp={null}
      fullscreenState={fullscreenState}
      runner={runner}
      showToolbar={false}
    />
  );
}

describe("AirAppRunPreview fullscreen exit", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it.each([
    ["installing", null],
    ["starting", null],
    ["error", "boom"],
  ] satisfies [AirAppRunnerState["status"], string | null][])(
    "keeps the exit control reachable while the preview is not ready (status=%s)",
    (status, error) => {
      const setFullscreen = vi.fn();

      render(
        <CoreI18nProvider locale="en">
          <AirAppRunPreview
            airapp={null}
            fullscreenState={{ fullscreen: true, setFullscreen }}
            runner={notReadyRunner(status, error)}
            showToolbar={false}
          />
        </CoreI18nProvider>,
      );

      const exit = screen.getByRole("button", { name: "Exit fullscreen" });
      fireEvent.click(exit);
      expect(setFullscreen).toHaveBeenCalledWith(false);
    },
  );

  it("offers a way out after a reload restores fullscreen from the URL", () => {
    window.history.replaceState(null, "", "/airapps/demo?fullscreen=1");

    render(
      <CoreI18nProvider locale="en">
        <UrlBackedPreview runner={notReadyRunner("installing")} />
      </CoreI18nProvider>,
    );

    // The overlay really is covering the viewport, so the exit control is the
    // only affordance left — the detail-view header is behind it.
    expect(document.querySelector('[data-airapp-fullscreen="true"]')).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Exit fullscreen" }));

    expect(new URLSearchParams(window.location.search).get("fullscreen")).toBeNull();
    expect(document.querySelector('[data-airapp-fullscreen="true"]')).toBeNull();
  });

  it("still refuses to offer *entering* fullscreen before the preview is ready", () => {
    render(
      <CoreI18nProvider locale="en">
        <AirAppRunPreview
          airapp={null}
          fullscreenState={{ fullscreen: false, setFullscreen: vi.fn() }}
          runner={notReadyRunner("installing")}
          showToolbar
        />
      </CoreI18nProvider>,
    );

    expect(screen.queryByRole("button", { name: "Enter fullscreen" })).toBeNull();
  });
});
