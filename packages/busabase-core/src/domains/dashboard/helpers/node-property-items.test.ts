import type { NodeDetailVO } from "busabase-contract/contract/node-detail-schemas";
import { EMPTY_WORKFLOW_DOCUMENT } from "busabase-contract/domains/rich-node/types";
import { describe, expect, it } from "vitest";
import { coreMessagesByLocale } from "../../../i18n/catalog";
import { characterCount, formatByteSize, getNodeInfoSections } from "./node-property-items";

const messages = coreMessagesByLocale.en;

const node = (overrides: Record<string, unknown> = {}) => ({
  id: "nod_handbook",
  parentId: null,
  type: "doc",
  slug: "handbook",
  name: "Handbook",
  description: "Team reference",
  metadata: {},
  settings: {},
  explicitVisibility: null,
  icon: null,
  position: 0,
  createdAt: "2026-09-15T00:00:00.000Z",
  updatedAt: "2026-09-16T00:00:00.000Z",
  baseId: null,
  children: [],
  ...overrides,
});

describe("node info sections", () => {
  it("counts Unicode characters, not UTF-16 code units", () => {
    expect(characterCount("你好")).toBe(2);
    expect(characterCount("a😀b")).toBe(3);
  });

  it("formats byte sizes the way the file row does", () => {
    expect(formatByteSize(512)).toBe("512 B");
    expect(formatByteSize(1536)).toBe("1.5 KB");
    expect(formatByteSize(2048)).toBe("2.0 KB");
  });

  it("gives every node its kind, id, slug, link, and default visibility", () => {
    const detail: NodeDetailVO = {
      type: "doc",
      body: "你好",
      storagePrefix: "busabase/nodes/nod_handbook/doc/",
      node: node(),
    };
    const sections = getNodeInfoSections(detail, messages, "https://busabase.test/doc/handbook");
    expect(sections.identity.map((item) => [item.label, item.value])).toEqual([
      [messages.richNodes.type, messages.nodeDetail.doc],
      [messages.nodeDetail.nodeId, "nod_handbook"],
      [messages.common.slug, "handbook"],
    ]);
    expect(sections.identity.find((item) => item.key === "id")?.copyable).toBe(true);
    expect(sections.link).toMatchObject({
      value: "/doc/handbook",
      href: "https://busabase.test/doc/handbook",
      copyValue: "https://busabase.test/doc/handbook",
    });
    expect(sections.access[0]?.value).toBe(messages.nodeDetail.visibilityDefault);
    expect(sections.specifics).toEqual([{ label: messages.nodeDetail.characters, value: "2" }]);
  });

  it("uses a file tree's own visibility, version, entry file, and total size", () => {
    const detail = {
      type: "skill",
      node: node({ type: "skill", slug: "weekly", id: "nod_weekly", explicitVisibility: null }),
      entryFile: "SKILL.md",
      visibility: "private",
      version: "1.2.0",
      files: [
        {
          path: "SKILL.md",
          name: "SKILL.md",
          size: 1536,
          updatedAt: null,
          mimeType: "text/markdown",
          assetId: "ast_1",
          displayName: null,
        },
        {
          path: "notes.txt",
          name: "notes.txt",
          size: 512,
          updatedAt: null,
          mimeType: "text/plain",
          assetId: "ast_2",
          displayName: null,
        },
      ],
      skippedGitignorePaths: [],
    } as NodeDetailVO;
    const sections = getNodeInfoSections(detail, messages);
    expect(sections.access[0]?.value).toBe(messages.form.private);
    expect(sections.specifics.map((item) => item.value)).toEqual([
      "2",
      "2.0 KB",
      "v1.2.0",
      "SKILL.md",
    ]);
  });

  it("names an AirApp engine override and otherwise says the app decides", () => {
    const base = {
      type: "airapp" as const,
      node: node({ type: "airapp", settings: { airappEngine: "remote" as const } }),
      entryFile: "index.html",
      visibility: "workspace" as const,
      version: "0.1.0",
      files: [],
      skippedGitignorePaths: [],
    };
    expect(
      getNodeInfoSections(base, messages).specifics.find(
        (item) => item.label === messages.airapp.engineLabel,
      )?.value,
    ).toBe(messages.airapp.engineRemote);
    expect(
      getNodeInfoSections(
        { ...base, node: node({ type: "airapp", settings: {} }) },
        messages,
      ).specifics.find((item) => item.label === messages.airapp.engineLabel)?.value,
    ).toBe(messages.airapp.engineFollowApp);
  });

  it("surfaces workflow execution settings from the saved document", () => {
    const detail: NodeDetailVO = {
      type: "workflow",
      node: node({ type: "workflow", slug: "publish" }),
      document: {
        ...EMPTY_WORKFLOW_DOCUMENT,
        edges: [{ id: "e1", source: "trigger", target: "end", label: "", outcome: "default" }],
        settings: {
          ...EMPTY_WORKFLOW_DOCUMENT.settings,
          executionMode: "event",
          errorPolicy: "continue",
          concurrency: 2,
          timeoutMs: 5000,
        },
      },
    };
    const values = Object.fromEntries(
      getNodeInfoSections(detail, messages).specifics.map((item) => [item.label, item.value]),
    );
    expect(values[messages.nodeDetail.steps]).toBe(String(EMPTY_WORKFLOW_DOCUMENT.nodes.length));
    expect(values[messages.nodeDetail.connections]).toBe("1");
    expect(values[messages.richNodes.executionMode]).toBe(messages.richNodes.event);
    expect(values[messages.richNodes.errorPolicy]).toBe(messages.richNodes.continue);
    expect(values[messages.richNodes.concurrency]).toBe("2");
    expect(values[messages.richNodes.timeoutMs]).toBe("5000");
  });

  it("counts folder children and whiteboard elements from the payload", () => {
    const folder: NodeDetailVO = {
      type: "folder",
      node: node({ type: "folder" }),
      children: [node({ id: "nod_child", type: "doc", slug: "child" })],
      storagePrefix: "busabase/nodes/nod_folder/folder/",
      body: "",
    };
    expect(getNodeInfoSections(folder, messages).specifics[0]).toMatchObject({
      label: messages.nodeDetail.contents,
      value: "1",
    });
    const board: NodeDetailVO = {
      type: "whiteboard",
      node: node({ type: "whiteboard" }),
      document: { version: 1, elements: [{ id: "a" }, { id: "b" }], appState: {} },
    };
    expect(getNodeInfoSections(board, messages).specifics[0]?.value).toBe("2");
  });
});
