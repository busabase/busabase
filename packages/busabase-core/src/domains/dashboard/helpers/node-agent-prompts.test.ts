import { describe, expect, it } from "vitest";
import type { CoreLocale } from "../../../i18n";
import { dashboardJa } from "../../../i18n/ja";
import type { CoreI18nMessages } from "../../../i18n/messages";
import { coreMessagesEn } from "../../../i18n/messages";
import { dashboardZhCN } from "../../../i18n/zh-CN";
import { dashboardZhTW } from "../../../i18n/zh-TW";
import { buildNodeAgentPrompts, type NodePromptContext } from "./node-agent-prompts";

/**
 * Scoping of the Agent-prompt set.
 *
 * The dialog is one component reused at four widths, so the ONLY thing that
 * distinguishes them is what `buildNodeAgentPrompts` returns: how the target
 * line names the thing, which curated scenarios apply, and which operations are
 * still meaningful. Getting that wrong is invisible in the UI — every scope
 * renders a plausible-looking list — so it is pinned here.
 *
 * The load-bearing case is `cell`: it is the intersection of `field` and
 * `record`, and the failure mode is silently offering it one of their prompt
 * sets ("clean up this column") while the user believes they pointed at one value.
 */

const BASE_CONTEXT: NodePromptContext = {
  nodeId: "nod_base_blog",
  nodeName: "Posts",
  nodeType: "base",
  spaceId: "local",
};

const build = (scope?: NodePromptContext["scope"]) =>
  buildNodeAgentPrompts({ ...BASE_CONTEXT, scope }, "en", coreMessagesEn);

const FIELD = { fieldName: "Title", fieldSlug: "title", fieldType: "text" } as const;
const RECORD = { recordId: "rec_1", recordTitle: "Launch plan" } as const;

describe("buildNodeAgentPrompts scoping", () => {
  it("names the whole node and offers the node's own scenarios by default", () => {
    const { scenarios, capabilities } = build();
    expect(scenarios.map((prompt) => prompt.key)).toContain("base-bulk-import");
    for (const prompt of scenarios) {
      expect(prompt.body).toContain('the Busabase Base "Posts" (nodeId: nod_base_blog)');
      expect(prompt.body).not.toContain("ONE field only");
      expect(prompt.body).not.toContain("ONE record only");
      expect(prompt.body).not.toContain("ONE value only");
    }
    // Unscoped keeps the generic node-tree operations.
    expect(capabilities.map((prompt) => prompt.key)).toContain("node_move");
  });

  it("field scope pins the column and drops node-tree operations", () => {
    const { scenarios, capabilities } = build({ kind: "field", ...FIELD });
    expect(scenarios.map((prompt) => prompt.key)).toEqual([
      "field-clean-values",
      "field-fill-blanks",
      "field-audit",
      "field-redesign",
    ]);
    expect(scenarios[0]?.body).toContain(
      'Work on ONE field only: "Title" (fieldSlug: title, type: text)',
    );
    const kinds = capabilities.map((prompt) => prompt.key);
    expect(kinds).not.toContain("node_move");
    expect(kinds).toContain("record_update");
  });

  it("record scope pins the row and keeps only record operations", () => {
    const { scenarios, capabilities } = build({ kind: "record", ...RECORD });
    expect(scenarios.map((prompt) => prompt.key)).toEqual([
      "record-complete",
      "record-rewrite",
      "record-explain",
    ]);
    expect(scenarios[0]?.body).toContain(
      'Work on ONE record only: "Launch plan" (recordId: rec_1)',
    );
    for (const prompt of capabilities) {
      expect(prompt.key.startsWith("record_")).toBe(true);
    }
  });

  // The one that is easy to get wrong.
  it("cell scope pins BOTH coordinates and narrows to updating a value", () => {
    const { scenarios, capabilities } = build({ kind: "cell", ...RECORD, ...FIELD });

    expect(scenarios.map((prompt) => prompt.key)).toEqual([
      "cell-rewrite",
      "cell-derive",
      "cell-explain",
    ]);
    const body = scenarios[0]?.body ?? "";
    expect(body).toContain('the "Title" field (fieldSlug: title, type: text)');
    expect(body).toContain('the record "Launch plan" (recordId: rec_1)');
    // Both fences, so the agent cannot read it as "the column" or "the row".
    expect(body).toContain("Do not touch any other field of this record");
    expect(body).toContain("do not touch this field on any other record");

    // Creating or deleting a record is a different scope wearing the same word.
    expect(capabilities.map((prompt) => prompt.key)).toEqual(["record_update"]);
  });

  it("keeps approval-first guidance on mutating scenarios and every capability", () => {
    for (const scope of [
      undefined,
      { kind: "field", ...FIELD } as const,
      { kind: "record", ...RECORD } as const,
      { kind: "cell", ...RECORD, ...FIELD } as const,
    ]) {
      const { scenarios, capabilities } = build(scope);
      expect(scenarios[0]?.body).toContain("never merge it without my approval");
      for (const prompt of capabilities) {
        expect(prompt.body).toContain("never merge it without my approval");
      }
    }
  });
});

const DOC_CONTEXT: NodePromptContext = {
  nodeId: "nod_doc_launch",
  nodeName: "Launch brief",
  nodeType: "doc",
  spaceId: "spc_acme",
  spaceName: "Acme",
};

const LOCALE_EXPECTATIONS: Record<
  CoreLocale,
  {
    messages: CoreI18nMessages;
    label: string;
    readInFull: string;
    readOnly: string;
    ready: string;
    replyLanguage: string;
    approvalInstruction: string;
    contentGroup: string;
  }
> = {
  en: {
    messages: coreMessagesEn,
    label: "Read doc",
    readInFull: "Read this document's current content in full",
    readOnly: "do not modify the document, create a ChangeRequest, or merge anything",
    ready: "briefly confirm that you are ready",
    replyLanguage: "Reply to me in English",
    approvalInstruction: "Submit the change as a ChangeRequest",
    contentGroup: "Content",
  },
  "zh-CN": {
    messages: dashboardZhCN,
    label: "读取文档",
    readInFull: "完整读取这篇文档的当前内容",
    readOnly: "不要修改文档，不要创建 ChangeRequest，也不要合并任何内容",
    ready: "简短确认你已经准备好",
    replyLanguage: "请用简体中文回复我",
    approvalInstruction: "以 ChangeRequest 提交改动",
    contentGroup: "内容",
  },
  "zh-TW": {
    messages: dashboardZhTW,
    label: "讀取文件",
    readInFull: "完整讀取這篇文件的目前內容",
    readOnly: "不要修改文件，不要建立 ChangeRequest，也不要合併任何內容",
    ready: "簡短確認你已經準備好",
    replyLanguage: "請用繁體中文回覆我",
    approvalInstruction: "以 ChangeRequest 提交變更",
    contentGroup: "內容",
  },
  ja: {
    messages: dashboardJa,
    label: "文書を読む",
    readInFull: "この文書の現在の内容をすべて読み",
    readOnly: "文書を変更したり、ChangeRequest を作成したり、何かをマージしたりしないでください",
    ready: "準備ができたことを簡潔に確認してください",
    replyLanguage: "日本語で返信してください",
    approvalInstruction: "変更は ChangeRequest として提出し",
    contentGroup: "コンテンツ",
  },
};

describe("Doc read prompt", () => {
  it("is a Content capability rather than a scenario and keeps mutating Doc prompts approval-first", () => {
    const { scenarios, capabilities } = buildNodeAgentPrompts(DOC_CONTEXT, "en", coreMessagesEn);

    expect(scenarios.map((prompt) => prompt.key)).toEqual(["doc-draft", "doc-review"]);
    expect(scenarios.map((prompt) => prompt.key)).not.toContain("doc-read");
    const contentPrompts = capabilities.filter((prompt) => prompt.group === "Content");
    expect(contentPrompts[0]?.key).toBe("doc-read");
    expect(contentPrompts[0]?.tier).toBe("capability");
    expect(contentPrompts[0]?.body).not.toContain("Submit the change as a ChangeRequest");
    expect(scenarios.find((prompt) => prompt.key === "doc-draft")?.body).toContain(
      "Submit the change as a ChangeRequest and never merge it without my approval",
    );
  });

  it.each(Object.entries(LOCALE_EXPECTATIONS))(
    "builds a complete, read-only %s prompt with target IDs and reply guidance",
    (locale, expected) => {
      const { capabilities } = buildNodeAgentPrompts(
        DOC_CONTEXT,
        locale as CoreLocale,
        expected.messages,
      );
      const prompt = capabilities.find((candidate) => candidate.key === "doc-read");

      expect(prompt?.label).toBe(expected.label);
      expect(prompt?.group).toBe(expected.contentGroup);
      expect(prompt?.body).toContain("nodeId: nod_doc_launch");
      expect(prompt?.body).toContain("spaceId: spc_acme");
      expect(prompt?.body).toContain(expected.readInFull);
      expect(prompt?.body).toContain(expected.readOnly);
      expect(prompt?.body).toContain(expected.ready);
      expect(prompt?.body).toContain(expected.replyLanguage);
      expect(prompt?.body).not.toContain(expected.approvalInstruction);
    },
  );
});
