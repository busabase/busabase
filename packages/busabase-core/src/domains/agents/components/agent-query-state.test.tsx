import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { AgentQueryErrorState } from "./agent-query-state";

Object.assign(globalThis, { React });

describe("AgentQueryErrorState", () => {
  it("keeps diagnostic errors in English", () => {
    const markup = renderToStaticMarkup(
      <CoreI18nProvider locale="en">
        <AgentQueryErrorState
          error={new Error("Connection timed out")}
          title="Couldn't load the agent catalog"
          onRetry={() => {}}
        />
      </CoreI18nProvider>,
    );

    expect(markup).toContain("Connection timed out");
    expect(markup).toContain(">Retry</button>");
  });

  it("uses localized controls while preserving the real server error", () => {
    const markup = renderToStaticMarkup(
      <CoreI18nProvider locale="zh-CN">
        <AgentQueryErrorState
          error={new Error("Connection timed out")}
          title="无法加载 Agent 目录"
          onRetry={() => {}}
        />
      </CoreI18nProvider>,
    );

    expect(markup).toContain("无法加载 Agent 目录");
    expect(markup).toContain("Connection timed out");
    expect(markup).toContain(">重试</button>");
    expect(markup).not.toContain("请重试。");
  });
});
