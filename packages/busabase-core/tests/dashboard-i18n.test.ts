import { describe, expect, it } from "vitest";
import { FIELD_TYPE_ORDER } from "../src/domains/base/field-types";
import { createAgentSkillPrompt } from "../src/domains/dashboard/components/agent-skill-button";
import { coreMessagesByLocale, coreMessagesEn } from "../src/i18n";

describe("shared dashboard translations", () => {
  it("defines a localized label for every field type", () => {
    for (const messages of Object.values(coreMessagesByLocale)) {
      expect(Object.keys(messages.fieldTypes).sort()).toEqual([...FIELD_TYPE_ORDER].sort());
    }

    expect(coreMessagesByLocale["zh-CN"].fieldTypes.multiselect).toBe("多选");
    expect(coreMessagesByLocale.ja.fieldTypes.relation).toBe("関連レコード");
  });

  it("keeps Agent integration framing copy in every locale catalog", () => {
    expect(coreMessagesByLocale["zh-CN"].integration.copyPrompt).toBe("复制提示词");
    expect(coreMessagesByLocale.ja.integration.copyFailed).toContain("コピー");
    expect(coreMessagesEn.integration.promptLabel).toBe("Agent onboarding prompt");
  });

  it("localizes file metadata and form source labels", () => {
    expect(coreMessagesByLocale["zh-CN"].nodeDetail.contentHash).toBe("内容哈希");
    expect(coreMessagesByLocale.ja.nodeDetail.mediaType).toBe("メディアタイプ");
    expect(coreMessagesByLocale["zh-CN"].form.fieldBindings).toBe("字段绑定");
    expect(coreMessagesByLocale.ja.form.pageSource).toBe("ページソース");
  });
});

describe("Agent setup prompt", () => {
  const skillUrl = "https://busabase.com/SETUP_SKILL.md";

  it("generates localized instructions", () => {
    expect(createAgentSkillPrompt(skillUrl, "en")).toContain("Reply to me in English");
    expect(createAgentSkillPrompt(skillUrl, "zh-CN")).toContain("请用简体中文回复我");
    expect(createAgentSkillPrompt(skillUrl, "ja")).toContain("日本語で返信してください");
  });

  it("includes the selected space without changing the requested language", () => {
    const prompt = createAgentSkillPrompt(skillUrl, "zh-CN", "space_123");

    expect(prompt).toContain("space_123");
    expect(prompt).toContain("x-busabase-space");
    expect(prompt).toContain("请用简体中文回复我");
  });
});
