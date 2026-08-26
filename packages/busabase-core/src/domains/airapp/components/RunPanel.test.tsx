import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import type { AirAppRunStatus } from "../store/airapp-runner-store";
import { AirAppPreviewPending } from "./RunPanel";

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
