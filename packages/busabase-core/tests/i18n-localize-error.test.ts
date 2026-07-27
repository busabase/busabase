import { describe, expect, it } from "vitest";
import { coreMessagesEn } from "../src/i18n";
import { dashboardJa } from "../src/i18n/ja";
import { localizeCoreErrorMessage } from "../src/i18n/localize-error";
import { dashboardZhCN } from "../src/i18n/zh-CN";

describe("localizeCoreErrorMessage", () => {
  it("localizes known node permission errors", () => {
    expect(
      localizeCoreErrorMessage(coreMessagesEn, "Requires changeRequest access on this node"),
    ).toBe("Requires changeRequest access on this node");

    expect(
      localizeCoreErrorMessage(dashboardZhCN, "Requires changeRequest access on this node"),
    ).toBe("需要对此节点拥有提交变更权限");

    expect(localizeCoreErrorMessage(dashboardJa, "Requires write access on this node")).toBe(
      "このノードには書き込み権限が必要です",
    );
  });

  it("leaves unknown errors unchanged", () => {
    expect(localizeCoreErrorMessage(dashboardZhCN, "Something else broke")).toBe(
      "Something else broke",
    );
  });
});
