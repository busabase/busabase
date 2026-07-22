import type { ChangeRequestVO } from "busabase-contract/types";
import { describe, expect, it } from "vitest";
import { coreMessagesEn } from "../../../i18n/messages";
import { describeViewConfig } from "./operation-diff";

const changeRequest = {
  base: {
    fields: [
      { id: "fld_title", slug: "title", name: "Title" },
      { id: "fld_status", slug: "status", name: "Status" },
    ],
  },
} as unknown as ChangeRequestVO;

describe("view configuration diff", () => {
  it("describes field order separately from field membership and includes widths", () => {
    const rules = describeViewConfig(
      changeRequest,
      {
        filters: [],
        sorts: [],
        visibleFieldSlugs: ["status", "title"],
        fieldWidths: { title: 280 },
      },
      coreMessagesEn,
    );

    expect(rules.filter((rule) => rule.kind === "field").map((rule) => rule.key)).toEqual([
      "field:status",
      "field:title",
    ]);
    expect(rules.find((rule) => rule.kind === "order")?.label).toBe("Status → Title");
    expect(rules.find((rule) => rule.kind === "width")?.label).toBe("Title · 280px");
  });
});
