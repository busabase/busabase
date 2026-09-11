import { listNodeTypes } from "busabase-contract/domains";
import { describe, expect, it } from "vitest";
import { FIELD_TYPE_ORDER } from "../src/domains/base/field-types";
import {
  createAgentSkillPrompt,
  createSetupSkillUrl,
} from "../src/domains/dashboard/components/agent-skill-button";
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
    expect(coreMessagesByLocale["zh-CN"].integration.plugin).toBe("插件");
    expect(coreMessagesEn.integration.pluginIntro).toContain("coding agent");
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

  it("builds explicit preference and confirmed setup URLs", () => {
    const homepageCloud = new URL(createSetupSkillUrl("https://busabase.com", "cloud", false));
    const dashboardCloud = new URL(
      createSetupSkillUrl("https://busabase.com", "cloud", true, "space_123"),
    );
    const dashboardDesktop = new URL(
      createSetupSkillUrl("https://busabase.com", "desktop", true, "must_not_leak"),
    );

    expect(homepageCloud.searchParams.get("edition")).toBe("cloud");
    expect(homepageCloud.searchParams.has("editionConfirmed")).toBe(false);
    expect(dashboardCloud.searchParams.get("editionConfirmed")).toBe("1");
    expect(dashboardCloud.searchParams.get("space")).toBe("space_123");
    expect(dashboardDesktop.searchParams.get("editionConfirmed")).toBe("1");
    expect(dashboardDesktop.searchParams.has("space")).toBe(false);
  });
});

/**
 * The create picker is the one screen every user passes through, and it used to
 * render the registry's hardcoded English `label` — so a zh-CN user met eleven
 * English words with no explanation. It now reads its copy from these catalogs,
 * which means a node type added without copy would silently produce a tile with
 * no name and no hint. Catch that here instead.
 */
describe("node type picker copy", () => {
  const creatableTypes = listNodeTypes()
    .filter((definition) => definition.capabilities.creatable && !definition.capabilities.hidden)
    .map((definition) => definition.type);

  it("names and explains every offered type, in every locale", () => {
    expect(creatableTypes.length).toBeGreaterThan(0);
    for (const [locale, messages] of Object.entries(coreMessagesByLocale)) {
      for (const type of creatableTypes) {
        const name = (messages.nodeDetail as Record<string, string>)[type];
        const hint = (messages.createNode.typeHints as Record<string, string>)[type];
        expect(name, `${locale} is missing a name for "${type}"`).toBeTruthy();
        expect(hint, `${locale} is missing a hint for "${type}"`).toBeTruthy();
      }
    }
  });

  it("translates the names rather than passing the English identifier through", () => {
    // The exact bug that was reported: "Folder" shown verbatim on a Chinese UI.
    expect(coreMessagesByLocale["zh-CN"].nodeDetail.folder).toBe("文件夹");
    expect(coreMessagesByLocale["zh-CN"].nodeDetail.doc).toBe("文档");
    expect(coreMessagesByLocale.ja.nodeDetail.folder).toBe("フォルダー");
    // Base is a typed record table, not a Postgres instance — 数据表, not 数据库.
    expect(coreMessagesByLocale["zh-CN"].nodeDetail.base).toBe("数据表");
    expect(coreMessagesByLocale["zh-TW"].nodeDetail.base).toBe("資料表");
  });

  it("keeps a non-empty 'common' group that is a strict subset of what is offered", () => {
    const common = listNodeTypes()
      .filter(
        (definition) =>
          definition.capabilities.creatable &&
          !definition.capabilities.hidden &&
          definition.capabilities.commonlyCreated,
      )
      .map((definition) => definition.type);
    expect(common.length).toBeGreaterThan(0);
    // A group covering everything would make the "More types" disclosure a lie.
    expect(common.length).toBeLessThan(creatableTypes.length);
    expect(creatableTypes).toEqual(expect.arrayContaining(common));
  });
});

/**
 * Catches UTF-8-decoded-as-Latin-1 corruption in a translation catalog.
 *
 * This is not hypothetical: a scripted edit to these files round-tripped a
 * Chinese string through the wrong codec and turned
 * "像表格一样填" into "åè¡¨æ ¼ä¸æ ·å¡«". It type-checks, it lints, every other
 * test passes, and it renders as garbage to exactly the users the string was
 * written for. The signature is a run of characters in the Latin-1 Supplement
 * block, which no genuine CJK or English UI string produces.
 */
describe("translation catalog encoding", () => {
  const MOJIBAKE = /[À-ÿ]{2,}/;

  const walk = (value: unknown, path: string, hits: string[]) => {
    if (typeof value === "string") {
      if (MOJIBAKE.test(value)) hits.push(`${path}: ${value}`);
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`, hits);
    }
  };

  it("has no mojibake in any locale", () => {
    for (const [locale, messages] of Object.entries(coreMessagesByLocale)) {
      const hits: string[] = [];
      walk(messages, locale, hits);
      expect(hits, `corrupted strings in ${locale}`).toEqual([]);
    }
  });
});
