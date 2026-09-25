import { BUILTIN_NODE_TYPES } from "busabase-contract/domains";
import { describe, expect, it } from "vitest";
import { coreMessagesEn } from "../../../i18n/messages";
import { dashboardZhCN } from "../../../i18n/zh-CN";
import { getNodeDetailBreadcrumbItems } from "./breadcrumbs";

describe("getNodeDetailBreadcrumbItems", () => {
  it("gives every registry-driven detail type a workspace breadcrumb", () => {
    const detailTypes = BUILTIN_NODE_TYPES.filter(
      (definition) => definition.capabilities.hasDetail && definition.type !== "base",
    );

    expect(detailTypes.length).toBeGreaterThan(0);
    for (const definition of detailTypes) {
      const items = getNodeDetailBreadcrumbItems(
        { slug: `${definition.type}-slug`, type: definition.type },
        null,
        coreMessagesEn,
      );

      expect(items, definition.type).toEqual([
        { href: "/home", label: "Workspace" },
        // `isNode` marks the crumb the topbar hangs the node's emphasis and
        // Info button on — here it is the last one, but on a Base view/record
        // route it is not, which is why the flag exists at all.
        { isNode: true, label: definition.label },
      ]);
    }
  });

  it("uses the loaded node name for the current page", () => {
    expect(
      getNodeDetailBreadcrumbItems(
        { slug: "quarterly-report", type: "doc" },
        {
          id: "node-doc",
          name: "Quarterly Report",
          slug: "quarterly-report",
          type: "doc",
        },
        coreMessagesEn,
      ),
    ).toEqual([
      { href: "/home", label: "Workspace" },
      { isNode: true, label: "Quarterly Report" },
    ]);
  });

  it("keeps the type fallback localized while a direct link loads", () => {
    expect(
      getNodeDetailBreadcrumbItems({ slug: "quarterly-report", type: "doc" }, null, dashboardZhCN),
    ).toEqual([
      { href: "/home", label: "工作区" },
      { isNode: true, label: "文档" },
    ]);
  });

  it("ignores stale loaded-node state from a previous route", () => {
    const items = getNodeDetailBreadcrumbItems(
      { slug: "current-doc", type: "doc" },
      { id: "old-doc", name: "Previous Document", slug: "old-doc", type: "doc" },
      coreMessagesEn,
    );

    expect(items?.at(-1)).toEqual({ isNode: true, label: "Doc" });
  });

  it("leaves Base and unknown routes to their dedicated fallbacks", () => {
    expect(
      getNodeDetailBreadcrumbItems({ slug: "customers", type: "base" }, null, coreMessagesEn),
    ).toBeNull();
    expect(
      getNodeDetailBreadcrumbItems({ slug: "unknown", type: "plugin" }, null, coreMessagesEn),
    ).toBeNull();
    expect(
      getNodeDetailBreadcrumbItems({ slug: "unknown", type: "toString" }, null, coreMessagesEn),
    ).toBeNull();
  });
});
