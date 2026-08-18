// @vitest-environment jsdom

import type { FileTreeNodeVO } from "busabase-contract/types";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useFileTreeController } from "./use-file-tree-controller";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const fileTree = {
  entryFile: "README.md",
  visibility: "workspace",
  version: "1.0.0",
  files: [
    {
      path: "README.md",
      name: "README.md",
      size: 7,
      updatedAt: null,
      mimeType: "text/markdown",
      assetId: "asset-readme",
      displayName: null,
    },
  ],
} as unknown as FileTreeNodeVO;

const roots: Root[] = [];

const renderHook = <T>(hook: () => T) => {
  const result: { current: T | undefined } = { current: undefined };
  const container = document.createElement("div");
  const root = createRoot(container);
  roots.push(root);

  const HookHarness = () => {
    result.current = hook();
    return null;
  };

  act(() => root.render(createElement(HookHarness)));
  if (result.current === undefined) {
    throw new Error("Hook did not render");
  }
  return { result: result as { current: T } };
};

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) {
      root.unmount();
    }
  });
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const createOptions = (overrides: Partial<Parameters<typeof useFileTreeController>[0]> = {}) => ({
  entityLabel: "Drive" as const,
  fileTree,
  onReadFile: vi.fn(async () => ({ content: "# Readme", contentHash: "hash-1" })),
  onCreateChangeRequest: vi.fn(async () => ({ id: "cr-1" })),
  onChangeRequestCreated: vi.fn(),
  ...overrides,
});

describe("useFileTreeController", () => {
  it("keeps the content hash through file loading and update submission", async () => {
    const read = deferred<{ content: string; contentHash: string }>();
    const create = deferred<{ id: string }>();
    const onReadFile = vi.fn(() => read.promise);
    const onCreateChangeRequest = vi.fn(() => create.promise);
    const onChangeRequestCreated = vi.fn();
    const { result } = renderHook(() =>
      useFileTreeController(
        createOptions({ onReadFile, onCreateChangeRequest, onChangeRequestCreated }),
      ),
    );

    const file = result.current.fileItems[0];
    if (!file) {
      throw new Error("Expected the README fixture");
    }
    let openPromise: Promise<void> | undefined;
    act(() => {
      openPromise = result.current.openFileForPreview(file);
    });
    expect(result.current.openFile).toMatchObject({ path: "README.md", loading: true });

    await act(async () => {
      read.resolve({ content: "# Original", contentHash: "hash-original" });
      await openPromise;
    });
    expect(result.current.openFile).toMatchObject({
      content: "# Original",
      contentHash: "hash-original",
      loading: false,
      original: "# Original",
    });

    act(() => {
      result.current.startEditingFile();
      result.current.updateFileContent("# Updated");
      result.current.setFileChangeMessage("Update documentation");
    });
    act(() => result.current.submitOpenFile());
    expect(result.current.saving).toBe(true);
    expect(onCreateChangeRequest).toHaveBeenCalledWith({
      message: "Update documentation",
      submittedBy: "mobile-editor",
      operations: [
        {
          kind: "update",
          path: "README.md",
          content: "# Updated",
          baseContentHash: "hash-original",
        },
      ],
    });

    act(() => result.current.submitOpenFile());
    expect(onCreateChangeRequest).toHaveBeenCalledTimes(1);

    await act(async () => {
      create.resolve({ id: "cr-update" });
      await create.promise;
    });
    expect(result.current.openFile).toBeNull();
    expect(result.current.fileChangeMessage).toBe("");
    expect(result.current.fileEditorMode).toBe("preview");
    expect(result.current.saving).toBe(false);
    expect(onChangeRequestCreated).toHaveBeenCalledWith("cr-update");
  });

  it("requires confirmation before discarding a changed new file", () => {
    const { result } = renderHook(() => useFileTreeController(createOptions()));

    act(() => result.current.startNewFile());
    act(() => {
      result.current.updateNewFilePath("docs/new.md");
      result.current.updateFileContent("draft");
    });
    act(() => {
      result.current.closeEditor();
    });
    expect(result.current.discardEditorOpen).toBe(true);
    expect(result.current.newFile).toEqual({ path: "docs/new.md", content: "draft" });

    act(() => result.current.discardEditorChanges());
    expect(result.current.discardEditorOpen).toBe(false);
    expect(result.current.newFile).toBeNull();
    expect(result.current.fileEditorMode).toBe("preview");
  });

  it("preserves metadata drafts until discard is confirmed", () => {
    const { result } = renderHook(() => useFileTreeController(createOptions()));

    act(() => result.current.startMetadataEdit());
    act(() => {
      result.current.updateMetadataVersion("2.0.0");
      result.current.setMetadataChangeMessage("Publish version 2");
    });
    act(() => {
      result.current.closeMetadataEditor();
    });
    expect(result.current.discardMetadataOpen).toBe(true);
    expect(result.current.metadataDraft?.version).toBe("2.0.0");

    act(() => result.current.discardMetadataChanges());
    expect(result.current.discardMetadataOpen).toBe(false);
    expect(result.current.metadataDraft).toBeNull();
    expect(result.current.metadataChangeMessage).toBe("");
  });
});
