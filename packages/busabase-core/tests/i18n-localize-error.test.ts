import { describe, expect, it } from "vitest";
import { coreMessagesEn } from "../src/i18n";
import { dashboardJa } from "../src/i18n/ja";
import { localizeCoreErrorMessage, presentCoreError } from "../src/i18n/localize-error";
import { dashboardZhCN } from "../src/i18n/zh-CN";
import { dashboardZhTW } from "../src/i18n/zh-TW";

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

  it("localizes duplicate-form conflicts", () => {
    const message = "A form already exists for this node. Use the update form endpoint instead.";

    expect(localizeCoreErrorMessage(coreMessagesEn, message)).toBe(
      "A form already exists for this node. Update the existing form instead of creating another one.",
    );
    expect(localizeCoreErrorMessage(dashboardZhCN, message)).toBe(
      "这个节点已经存在表单，请更新现有表单，不要重复创建。",
    );
    expect(localizeCoreErrorMessage(dashboardJa, message)).toContain("既存のフォーム");
    expect(localizeCoreErrorMessage(dashboardZhTW, message)).toContain("現有表單");
  });

  it("localizes invalid form cursors", () => {
    const message = "The form cursor is invalid.";
    expect(localizeCoreErrorMessage(dashboardZhCN, message)).toBe(
      "表单分页链接无效，请刷新后重试。",
    );
    expect(localizeCoreErrorMessage(dashboardZhTW, message)).toBe(
      "表單分頁連結無效，請重新整理後再試。",
    );
  });
});

describe("presentCoreError", () => {
  it("shows the real server reason in every locale", () => {
    const error = new Error("Failed to fetch: internal trace id 42");
    expect(presentCoreError(coreMessagesEn, "en", error, coreMessagesEn.form.submitFailed)).toBe(
      error.message,
    );
    expect(presentCoreError(dashboardZhCN, "zh-CN", error, dashboardZhCN.form.submitFailed)).toBe(
      error.message,
    );
    expect(presentCoreError(dashboardJa, "ja", error, dashboardJa.form.submitFailed)).toBe(
      error.message,
    );
  });

  it("trims and truncates long server reasons to 300 Unicode characters", () => {
    const message = `  ${"错".repeat(305)}  `;
    const presented = presentCoreError(
      dashboardZhCN,
      "zh-CN",
      new Error(message),
      dashboardZhCN.form.submitFailed,
    );

    expect(Array.from(presented)).toHaveLength(300);
    expect(presented).toBe(`${"错".repeat(299)}…`);
  });

  it("uses the fallback when no real reason is available", () => {
    expect(
      presentCoreError(dashboardZhCN, "zh-CN", new Error("  "), dashboardZhCN.form.submitFailed),
    ).toBe(dashboardZhCN.form.submitFailed);
    expect(
      presentCoreError(dashboardZhCN, "zh-CN", "not an error", dashboardZhCN.form.submitFailed),
    ).toBe(dashboardZhCN.form.submitFailed);
  });

  it("uses specific translated errors where the message has a known mapping", () => {
    expect(
      presentCoreError(
        dashboardZhCN,
        "zh-CN",
        new Error("Requires read access on this node"),
        dashboardZhCN.form.submitFailed,
      ),
    ).toBe(dashboardZhCN.permissions.requiresReadOnNode);
  });

  it("shows the archived-agent server reason instead of the generic translated fallback", () => {
    const error = new Error(
      "This agent is archived. Restore it from Space Settings to use it again.",
    );

    expect(
      presentCoreError(
        dashboardZhCN,
        "zh-CN",
        error,
        dashboardZhCN.agents.continueConversationFailed,
      ),
    ).toBe(error.message);
  });
});
