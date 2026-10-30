import { describe, expect, it } from "vitest";
import { coreMessagesByLocale } from "../src/i18n/catalog";
import { localizeCoreErrorMessage } from "../src/i18n/localize-error";
import { coreMessagesEn } from "../src/i18n/messages";
import { dashboardZhCN } from "../src/i18n/zh-CN";

const SERVER_MESSAGE =
  'The folder slug "ops" is already used in this workspace. Choose a different slug.';

describe("localizeCoreErrorMessage slug conflict", () => {
  it("translates the server's slug-conflict sentence and keeps the slug", () => {
    expect(localizeCoreErrorMessage(dashboardZhCN, SERVER_MESSAGE)).toContain("ops");
    expect(localizeCoreErrorMessage(dashboardZhCN, SERVER_MESSAGE)).not.toContain("already used");
  });

  it("matches every node type", () => {
    const base = SERVER_MESSAGE.replace("folder", "base");
    expect(localizeCoreErrorMessage(coreMessagesEn, base)).toContain('"ops"');
  });

  it("has a translation in every locale", () => {
    for (const messages of Object.values(coreMessagesByLocale)) {
      expect(messages.common.slugTaken).toContain("{slug}");
    }
  });

  it("leaves unrelated messages untouched", () => {
    expect(localizeCoreErrorMessage(dashboardZhCN, "Something else")).toBe("Something else");
  });
});
