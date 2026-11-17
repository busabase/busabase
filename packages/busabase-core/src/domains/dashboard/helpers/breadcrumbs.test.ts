import { BUILTIN_NODE_TYPES } from "busabase-contract/domains";
import { describe, expect, it } from "vitest";
import { coreMessagesEn } from "../../../i18n/messages";
import { dashboardZhCN } from "../../../i18n/zh-CN";
import {
  ancestorFolderBreadcrumbItems,
  ancestorFoldersFromTree,
  getNodeDetailBreadcrumbItems,
  narrowCollapsedBreadcrumbIndexes,
  withAncestorFolders,
} from "./breadcrumbs";

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

  it("inserts every ancestor folder between Workspace and the node", () => {
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
        [
          { id: "fld_projects", name: "Projects", slug: "projects", type: "folder" },
          { id: "fld_acme", name: "Acme", slug: "acme", type: "folder" },
        ],
      ),
    ).toEqual([
      { href: "/home", label: "Workspace" },
      { href: "/folder/projects", label: "Projects" },
      { href: "/folder/acme", label: "Acme" },
      { isNode: true, label: "Quarterly Report" },
    ]);
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

describe("ancestor folder breadcrumbs", () => {
  const tree = [
    {
      id: "root",
      parentId: null,
      name: "Workspace",
      slug: "root",
      type: "folder",
      children: [
        {
          id: "fld_projects",
          parentId: "root",
          name: "Projects",
          slug: "projects",
          type: "folder",
          children: [
            {
              id: "fld_acme",
              parentId: "fld_projects",
              name: "Acme",
              slug: "acme",
              type: "folder",
              children: [
                {
                  id: "base_tasks",
                  parentId: "fld_acme",
                  name: "Tasks",
                  slug: "personal-tasks",
                  type: "base",
                  children: [],
                },
              ],
            },
            {
              id: "fld_other",
              parentId: "fld_projects",
              name: "Other",
              slug: "other",
              type: "folder",
              children: [
                {
                  id: "base_tasks_other",
                  parentId: "fld_other",
                  name: "Tasks",
                  slug: "other-tasks",
                  type: "base",
                  children: [],
                },
              ],
            },
          ],
        },
      ],
    },
  ];

  it("walks the loaded tree and drops the workspace root", () => {
    expect(ancestorFoldersFromTree(tree, { type: "base", slug: "personal-tasks" })).toEqual([
      { id: "fld_projects", name: "Projects", slug: "projects", type: "folder" },
      { id: "fld_acme", name: "Acme", slug: "acme", type: "folder" },
    ]);
    expect(ancestorFoldersFromTree(tree, { type: "folder", slug: "projects" })).toEqual([]);
    expect(ancestorFoldersFromTree(tree, { type: "base", slug: "missing" })).toEqual([]);
  });

  it("distinguishes two same-named nodes by their folder path", () => {
    const acme = ancestorFolderBreadcrumbItems(
      ancestorFoldersFromTree(tree, { type: "base", slug: "personal-tasks" }),
    );
    const other = ancestorFolderBreadcrumbItems(
      ancestorFoldersFromTree(tree, { type: "base", slug: "other-tasks" }),
    );

    expect(acme.map((item) => item.label)).toEqual(["Projects", "Acme"]);
    expect(other.map((item) => item.label)).toEqual(["Projects", "Other"]);
  });

  it("places folders after Workspace and before the Base view", () => {
    expect(
      withAncestorFolders(
        [
          { href: "/home", label: "Workspace" },
          { href: "/base/personal-tasks", isNode: true, label: "Tasks" },
          { label: "Board" },
        ],
        [
          { id: "fld_projects", name: "Projects", slug: "projects", type: "folder" },
          { id: "fld_acme", name: "Acme", slug: "acme", type: "folder" },
          { id: "base_ignored", name: "Not a folder", slug: "nope", type: "base" },
        ],
      ),
    ).toEqual([
      { href: "/home", label: "Workspace" },
      { href: "/folder/projects", label: "Projects" },
      { href: "/folder/acme", label: "Acme" },
      { href: "/base/personal-tasks", isNode: true, label: "Tasks" },
      { label: "Board" },
    ]);
  });

  it("collapses only the middle of a long trail", () => {
    expect(narrowCollapsedBreadcrumbIndexes(4)).toEqual([]);
    expect(narrowCollapsedBreadcrumbIndexes(5)).toEqual([1, 2]);
    expect(narrowCollapsedBreadcrumbIndexes(6)).toEqual([1, 2, 3]);
  });
});
