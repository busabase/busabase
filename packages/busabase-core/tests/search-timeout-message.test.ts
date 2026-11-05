import { describe, expect, it } from "vitest";
import { localizeCoreErrorMessage } from "../src/i18n/localize-error";
import { coreMessagesEn } from "../src/i18n/messages";
import { dashboardZhCN } from "../src/i18n/zh-CN";

const SERVER_MESSAGE = "Search took too long. Narrow the search to a Base or folder and try again.";

describe("search timeout message", () => {
  it("reaches a Chinese user in Chinese and points at a control they can use", () => {
    const localized = localizeCoreErrorMessage(dashboardZhCN, SERVER_MESSAGE);
    expect(localized).toBe(dashboardZhCN.search.timedOut);
    expect(localized).toContain("高级搜索");
  });

  it("stays in step with the message the server throws", () => {
    expect(localizeCoreErrorMessage(coreMessagesEn, SERVER_MESSAGE)).toBe(
      coreMessagesEn.search.timedOut,
    );
  });
});
