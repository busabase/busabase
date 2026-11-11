import { fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DocxViewer from "./DocxViewer";
import { ViewerLayoutProvider } from "./viewer-layout";

vi.mock("docx-preview", () => ({ renderAsync: vi.fn(async () => undefined) }));

describe("DocxViewer download guard", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Blob(["docx"]), { status: 200 })),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  const container = (root: HTMLElement) =>
    root.querySelector<HTMLElement>(".docx-viewer-container") as HTMLElement;

  it("stops copying, saving and printing on a share link that forbids downloads", () => {
    const { container: root } = render(
      <DocxViewer fileUrl="/f/plan.docx" fileName="plan.docx" noDownload />,
    );

    expect(container(root).className).toContain("select-none");
    const save = new KeyboardEvent("keydown", { key: "s", ctrlKey: true, cancelable: true });
    document.dispatchEvent(save);
    expect(save.defaultPrevented).toBe(true);
    expect(fireEvent.copy(container(root))).toBe(false);
  });

  it("leaves the text selectable when embedded, where the host owns downloading", () => {
    const { container: root } = render(
      <ViewerLayoutProvider layout="fill">
        <DocxViewer fileUrl="/f/plan.docx" fileName="plan.docx" noDownload />
      </ViewerLayoutProvider>,
    );

    expect(container(root).className).not.toContain("select-none");
    const save = new KeyboardEvent("keydown", { key: "s", ctrlKey: true, cancelable: true });
    document.dispatchEvent(save);
    expect(save.defaultPrevented).toBe(false);
  });
});
