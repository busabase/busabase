import type { BaseFieldVO } from "busabase-contract/types";
import { describe, expect, it } from "vitest";
import { extractRecordFindHtmlText, getRecordFindTexts } from "./record-find-text";

const field = (type: BaseFieldVO["type"], options: BaseFieldVO["options"] = {}): BaseFieldVO => ({
  id: "field",
  baseId: "base",
  slug: "value",
  name: "Value",
  type,
  required: false,
  position: 0,
  options,
});

describe("record find text", () => {
  it.each([
    ["text", "华星客户", "华星客户"],
    ["longtext", "Delivery notes", "Delivery notes"],
    ["number", 1234.5, "1234.5"],
    ["email", "buyer@example.com", "buyer@example.com"],
    ["url", "https://example.com/customer", "https://example.com/customer"],
    ["embed", "https://example.com/video", "https://example.com/video"],
    ["phone", "+86 138-0000-0000", "+86 138-0000-0000"],
    ["ai_summary", "Generated delivery summary", "Generated delivery summary"],
  ] as const)(
    "matches the stored business text of %s without extra lookups",
    (type, value, expected) => {
      expect(getRecordFindTexts(field(type), value)).toEqual([expected]);
      expect(getRecordFindFieldSupport(field(type))).toMatchObject({
        supported: true,
        default: true,
      });
    },
  );

  it("explains unsupported date, computed and reverse-relation field choices", () => {
    expect(getRecordFindFieldSupport(field("date"))).toMatchObject({
      supported: false,
      reason: "filter",
    });
    for (const type of ["formula", "lookup"] as const) {
      expect(getRecordFindFieldSupport(field(type))).toMatchObject({
        supported: false,
        reason: "dynamic",
      });
    }
    expect(
      getRecordFindFieldSupport(field("relation", { reverseOfFieldId: "forward" })),
    ).toMatchObject({
      supported: false,
      reason: "reverse",
    });
    expect(getRecordFindFieldSupport(field("json"))).toMatchObject({
      supported: true,
      default: false,
    });
  });
  it("finds body phrases across inline tags and entities without matching scripts or attributes", () => {
    const text = extractRecordFindHtmlText(
      "<html><head><title>HiddenTitle</title><style>HiddenStyle</style></head><body>" +
        '<p data-secret="HiddenAttribute">华<strong>星</strong>&nbsp;客户</p>' +
        "<p>Next</p><script>HiddenScript</script><!--HiddenComment--></body></html>",
    );
    expect(text).toBe("华星 客户 Next");
  });

  it("searches Markdown content, alt text and code while omitting link destinations", () => {
    const texts = getRecordFindTexts(
      field("markdown"),
      "# **华星**\n[交付](https://destination-secret.example)\n![流程图](image-secret.png)\n`code_value`",
    );
    expect(texts.join(" ")).toContain("华星");
    expect(texts.join(" ")).toContain("交付");
    expect(texts.join(" ")).toContain("流程图");
    expect(texts.join(" ")).toContain("code_value");
    expect(texts.join(" ")).not.toContain("destination-secret");
    expect(texts.join(" ")).not.toContain("image-secret");
  });

  it("uses option labels and independent multi-values rather than ids or JSON punctuation", () => {
    const options = { choices: [{ id: "opaque-option", name: "重点客户" }] };
    expect(getRecordFindTexts(field("select", options), "opaque-option")).toEqual(["重点客户"]);
    expect(getRecordFindTexts(field("multiselect", options), ["opaque-option", "Other"])).toEqual([
      "重点客户",
      "Other",
    ]);
    expect(getRecordFindTexts(field("ai_tags"), ["one", "two"])).toEqual(["one", "two"]);
  });

  it("searches attachment filenames without indexing storage identities or signed URLs", () => {
    expect(
      getRecordFindTexts(field("attachment"), [
        { fileName: "华星交付.pdf", assetId: "opaque", url: "https://secret?signature=hidden" },
      ]),
    ).toEqual(["华星交付.pdf"]);
  });

  it("retains complete source text and supports the displayed automatic-number prefix", () => {
    const raw = `${"x".repeat(12_000)}tailneedle`;
    expect(getRecordFindTexts(field("longtext"), raw)).toEqual([raw]);
    expect(getRecordFindTexts(field("json"), '{"escape":"\\u534e"}')).toEqual([
      '{"escape":"\\u534e"}',
    ]);
    expect(getRecordFindTexts(field("auto_number"), 437)).toEqual(["437", "#437"]);
    expect(getRecordFindTexts(field("text"), null)).toEqual([]);
  });
});

import { getRecordFindFieldSupport } from "busabase-contract/domains/base/contract/record-find";
