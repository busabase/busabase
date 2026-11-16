// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDocMermaidPreview } from "./doc-mermaid-preview";

const mermaid = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }));
vi.mock("mermaid", () => ({ default: mermaid }));

const messages = {
  codePreviewLabel: "预览",
  codePreviewLoading: "加载中…",
  codePreviewError: "无法显示 Mermaid 图表，请检查语法后重试。",
};

const instances: ReturnType<typeof createDocMermaidPreview>[] = [];
const makePreview = () => {
  const instance = createDocMermaidPreview(messages);
  instances.push(instance);
  return instance;
};

const svg = (text: string) => `<svg xmlns="http://www.w3.org/2000/svg"><text>${text}</text></svg>`;
const deferred = <T,>() => {
  let resolve = (_value: T) => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

/** Crepe clones/sanitizes previews rather than mounting the supplied object.
 * Exercise that contract instead of letting the helper mutate a live element. */
const mount = (element: unknown, host: HTMLElement) => {
  if (!(element instanceof HTMLElement)) throw new Error("Expected an element preview");
  host.replaceChildren(element.cloneNode(true));
};

beforeEach(() => {
  vi.useFakeTimers();
  mermaid.initialize.mockReset();
  mermaid.render.mockReset();
  mermaid.render.mockImplementation(async (_id: string, source: string) => ({ svg: svg(source) }));
  document.documentElement.classList.remove("dark");
});

afterEach(() => {
  for (const instance of instances.splice(0)) instance.destroy();
  document.body.replaceChildren();
  document.documentElement.classList.remove("dark");
  vi.useRealTimers();
});

describe("Doc Mermaid previews", () => {
  it("does not render ordinary code blocks", async () => {
    const preview = makePreview();
    expect(preview.renderPreview("typescript", "const count = 1", vi.fn())).toBeNull();
    await vi.runAllTimersAsync();
    expect(mermaid.initialize).not.toHaveBeenCalled();
    expect(mermaid.render).not.toHaveBeenCalled();
  });

  it("replaces a cloned loading marker with a strict-mode SVG and removes temporary DOM", async () => {
    const preview = makePreview();
    const host = document.createElement("div");
    document.body.append(host);
    const apply = (value: unknown) => mount(value, host);
    mount(preview.renderPreview("mermaid", "flowchart LR", apply), host);

    expect(host.textContent).toBe(messages.codePreviewLoading);
    await vi.runAllTimersAsync();
    await vi.waitFor(() =>
      expect(host.querySelector("svg text")?.textContent).toBe("flowchart LR"),
    );
    expect(mermaid.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        securityLevel: "strict",
        suppressErrorRendering: true,
        startOnLoad: false,
        htmlLabels: false,
      }),
    );
    expect(host.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("Mermaid — 预览");
    expect(document.querySelector(".doc-mermaid-staging")).toBeNull();
  });

  it("does not let an old render replace a newer source or its error recovery", async () => {
    const old = deferred<{ svg: string }>();
    mermaid.render.mockReturnValueOnce(old.promise);
    const preview = makePreview();
    const host = document.createElement("div");
    document.body.append(host);
    const apply = vi.fn((value: unknown) => mount(value, host));
    mount(preview.renderPreview("mermaid", "old", apply), host);
    await vi.runAllTimersAsync();
    expect(mermaid.render).toHaveBeenCalledTimes(1);

    mount(preview.renderPreview("mermaid", "new", apply), host);
    await vi.runAllTimersAsync();
    old.resolve({ svg: svg("old") });
    await vi.waitFor(() => expect(host.querySelector("svg text")?.textContent).toBe("new"));
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("keeps a code block normal when its language changes during an async render", async () => {
    const pending = deferred<{ svg: string }>();
    mermaid.render.mockReturnValueOnce(pending.promise);
    const preview = makePreview();
    const host = document.createElement("div");
    document.body.append(host);
    const apply = vi.fn((value: unknown) => mount(value, host));
    mount(preview.renderPreview("mermaid", "graph", apply), host);
    await vi.runAllTimersAsync();
    expect(preview.renderPreview("javascript", "const answer = 42", apply)).toBeNull();
    host.replaceChildren();
    pending.resolve({ svg: svg("stale") });
    await vi.runAllTimersAsync();
    expect(apply).not.toHaveBeenCalled();
    expect(host.childNodes).toHaveLength(0);
  });

  it("shows a localized recoverable error instead of leaking Mermaid's failure UI", async () => {
    mermaid.render.mockRejectedValueOnce(new Error("invalid author source"));
    const preview = makePreview();
    const host = document.createElement("div");
    document.body.append(host);
    const apply = (value: unknown) => mount(value, host);
    mount(preview.renderPreview("mermaid", "broken", apply), host);
    await vi.runAllTimersAsync();
    await vi.waitFor(() =>
      expect(host.querySelector('[role="alert"]')?.textContent).toBe(messages.codePreviewError),
    );
    expect(host.textContent).not.toContain("invalid author source");
    expect(document.querySelector(".doc-mermaid-staging")).toBeNull();

    mount(preview.renderPreview("mermaid", "fixed", apply), host);
    await vi.runAllTimersAsync();
    await vi.waitFor(() => expect(host.querySelector("svg text")?.textContent).toBe("fixed"));
  });

  it("re-renders mounted previews when the host theme changes", async () => {
    const preview = makePreview();
    const host = document.createElement("div");
    document.body.append(host);
    const apply = vi.fn((value: unknown) => mount(value, host));
    mount(preview.renderPreview("mermaid", "diagram", apply), host);
    await vi.runAllTimersAsync();
    await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));

    document.documentElement.classList.add("dark");
    await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(2));
    expect(mermaid.initialize).toHaveBeenLastCalledWith(expect.objectContaining({ theme: "dark" }));
  });

  it("does not apply a pending render after the Doc is destroyed", async () => {
    const pending = deferred<{ svg: string }>();
    mermaid.render.mockReturnValueOnce(pending.promise);
    const preview = makePreview();
    const host = document.createElement("div");
    document.body.append(host);
    const apply = vi.fn();
    mount(preview.renderPreview("mermaid", "diagram", apply), host);
    await vi.runAllTimersAsync();
    preview.destroy();
    pending.resolve({ svg: svg("late") });
    await vi.runAllTimersAsync();
    expect(apply).not.toHaveBeenCalled();
    expect(preview.renderPreview("mermaid", "again", apply)).toBeNull();
    expect(document.querySelector(".doc-mermaid-staging")).toBeNull();
  });
});
