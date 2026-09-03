import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CoreI18nProvider, coreMessagesByLocale, coreMessagesEn } from "../../../i18n";
import type { AirAppRunStatus } from "../store/airapp-runner-store";
import {
  AirAppPreviewPending,
  AirAppRunError,
  airAppAutoRunDelay,
  createEligibleAirAppRunner,
  noEligibleAirAppEngineMessage,
} from "./RunPanel";

const renderPending = (status: AirAppRunStatus, locale: "en" | "zh-CN") =>
  renderToStaticMarkup(
    <CoreI18nProvider locale={locale}>
      <AirAppPreviewPending status={status} />
    </CoreI18nProvider>,
  );

describe("AirAppPreviewPending", () => {
  it.each([
    ["loading-files", "Loading files…"],
    ["installing", "Installing dependencies…"],
    ["starting", "Starting dev server…"],
  ] satisfies [AirAppRunStatus, string][])('renders the English "%s" phase', (status, label) => {
    const markup = renderPending(status, "en");

    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain(label);
    expect(markup).toContain("The live preview will appear here shortly.");
  });

  it.each([
    ["loading-files", "正在加载文件…"],
    ["installing", "正在安装依赖…"],
    ["starting", "正在启动开发服务器…"],
  ] satisfies [AirAppRunStatus, string][])('renders the Chinese "%s" phase', (status, label) => {
    const markup = renderPending(status, "zh-CN");

    expect(markup).toContain(label);
    expect(markup).toContain("实时预览即将显示在这里。");
  });
});

describe("AirApp auto-run preference hydration", () => {
  it("does not start in-browser before persisted engine preferences are restored", () => {
    expect(airAppAutoRunDelay(false, "browser")).toBeNull();
    expect(airAppAutoRunDelay(false, "remote")).toBeNull();
    expect(airAppAutoRunDelay(true, "browser")).toBe(0);
    expect(airAppAutoRunDelay(true, "remote")).toBeGreaterThan(0);
  });
});

describe("AirApp runtime engine eligibility", () => {
  it("does not construct a runner for Python when only the browser engine is available", () => {
    const createRunner = vi.fn((kind: string) => ({ kind }));

    const result = createEligibleAirAppRunner({
      runtime: "python",
      userChose: false,
      wantedKind: "browser",
      availableEngines: ["browser"],
      createRunner,
    });

    expect(result).toEqual({ runnerKind: null, runner: null });
    expect(createRunner).not.toHaveBeenCalled();

    const error = noEligibleAirAppEngineMessage(coreMessagesEn, "python");
    expect(renderToStaticMarkup(<AirAppRunError error={error} />)).toContain("Configure Sandock");
  });

  it("automatically constructs the remote engine for Python when Sandock is available", () => {
    const createRunner = vi.fn((kind: string) => ({ kind }));

    const result = createEligibleAirAppRunner({
      runtime: "python",
      userChose: false,
      wantedKind: "browser",
      availableEngines: ["browser", "remote"],
      createRunner,
    });

    expect(result).toEqual({ runnerKind: "remote", runner: { kind: "remote" } });
    expect(createRunner).toHaveBeenCalledOnce();
    expect(createRunner).toHaveBeenCalledWith("remote");
  });

  it("lets an airapp.json preference decide when the user has chosen nothing", () => {
    const createRunner = vi.fn((kind: string) => ({ kind }));

    const result = createEligibleAirAppRunner({
      runtime: "node",
      preferredEngine: "remote",
      userChose: false,
      wantedKind: "browser",
      availableEngines: ["browser", "remote"],
      createRunner,
    });

    expect(result.runnerKind).toBe("remote");
  });

  it("lets the person outrank the file once they have chosen", () => {
    // The failure this fixes: a user sets "In browser" in node settings, on an
    // app whose manifest pins something else, and gets the manifest's engine —
    // with nothing in the dialog or the logs saying the file had an opinion.
    const createRunner = vi.fn((kind: string) => ({ kind }));

    const result = createEligibleAirAppRunner({
      runtime: "node",
      preferredEngine: "remote",
      userChose: true,
      wantedKind: "browser",
      availableEngines: ["browser", "remote"],
      createRunner,
    });

    expect(result.runnerKind).toBe("browser");
  });

  it("still falls back when the user's choice cannot run this runtime", () => {
    // Outranking the manifest is not outranking physics: a Python app cannot
    // run in a browser no matter who asked for it.
    const createRunner = vi.fn((kind: string) => ({ kind }));

    const result = createEligibleAirAppRunner({
      runtime: "python",
      preferredEngine: "remote",
      userChose: true,
      wantedKind: "browser",
      availableEngines: ["browser", "remote"],
      createRunner,
    });

    expect(result.runnerKind).toBe("remote");
  });

  it("keeps the Python configuration prompt localized in supported Cloud locales", () => {
    expect(noEligibleAirAppEngineMessage(coreMessagesByLocale.en, "python")).toContain(
      "Configure Sandock",
    );
    expect(noEligibleAirAppEngineMessage(coreMessagesByLocale["zh-CN"], "python")).toBe(
      "不支持 Python AirApp，需要配置 Sandock。",
    );
    expect(noEligibleAirAppEngineMessage(coreMessagesByLocale.ja, "python")).toContain(
      "Sandock を設定",
    );
  });
});
