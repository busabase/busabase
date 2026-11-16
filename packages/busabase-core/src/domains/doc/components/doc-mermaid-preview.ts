import type { CodeBlockConfig } from "@milkdown/kit/component/code-block";
import type { CoreI18nMessages } from "../../../i18n/messages";

type PreviewMessages = Pick<
  CoreI18nMessages["docEditor"],
  "codePreviewLabel" | "codePreviewLoading" | "codePreviewError"
>;

interface PreviewRequest {
  id: string;
  source: string;
  revision: number;
  apply: Parameters<CodeBlockConfig["renderPreview"]>[2];
}

let nextPreviewId = 0;
let renderQueue = Promise.resolve();

/** Mermaid has a shared configuration singleton. Keep initialize + render together,
 * including across two open Docs, so one diagram cannot change another's theme. */
const renderDiagram = async (
  request: PreviewRequest,
  revision: number,
  current: () => boolean,
): Promise<string | null> => {
  const previous = renderQueue;
  let release = () => {};
  renderQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  let staging: HTMLDivElement | undefined;
  try {
    if (!current()) return null;
    const { default: mermaid } = await import("mermaid");
    if (!current()) return null;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      theme: document.documentElement.classList.contains("dark") ? "dark" : "default",
      fontFamily: getComputedStyle(document.body).fontFamily,
      htmlLabels: false,
    });
    // Mermaid measures text in a live DOM. Own that temporary container so an
    // invalid diagram cannot leave an error SVG attached to document.body.
    staging = document.createElement("div");
    staging.className = "doc-mermaid-staging";
    document.body.append(staging);
    const { svg } = await mermaid.render(`${request.id}-svg-${revision}`, request.source, staging);
    return svg;
  } finally {
    staging?.remove();
    release();
  }
};

/** Extends Crepe's own code-block preview without changing its schema or Markdown.
 * Crepe sanitizes and clones preview elements, and does not cancel old async
 * callbacks. A marker surviving that clone identifies the current block result:
 * editing its source/language replaces the marker, invalidating the old render. */
export const createDocMermaidPreview = (messages: PreviewMessages) => {
  const requests = new Map<string, PreviewRequest>();
  const timers = new Set<number>();
  let disposed = false;
  let dark = document.documentElement.classList.contains("dark");

  const mounted = (request: PreviewRequest) =>
    document.querySelector(`[data-doc-mermaid-id="${request.id}"]`) !== null;

  const prune = () => {
    for (const [id, request] of requests) {
      if (!mounted(request)) requests.delete(id);
    }
  };

  const wrapper = (request: PreviewRequest) => {
    const element = document.createElement("div");
    element.className = "doc-mermaid-preview";
    element.dataset.docMermaidId = request.id;
    return element;
  };

  const render = async (request: PreviewRequest) => {
    const revision = ++request.revision;
    const current = () => !disposed && request.revision === revision && mounted(request);
    try {
      const svg = await renderDiagram(request, revision, current);
      if (!svg || !current()) return;
      const element = wrapper(request);
      element.setAttribute("role", "img");
      element.setAttribute("aria-label", `Mermaid — ${messages.codePreviewLabel}`);
      // Parse only Mermaid's strict-mode output, never the author-provided source.
      // Crepe sanitizes this detached element again before mounting its clone.
      const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
      element.append(document.importNode(parsed.documentElement, true));
      request.apply(element);
    } catch {
      if (!current()) return;
      const element = wrapper(request);
      element.classList.add("doc-mermaid-error");
      element.setAttribute("role", "alert");
      element.textContent = messages.codePreviewError;
      request.apply(element);
    } finally {
      if (!mounted(request)) requests.delete(request.id);
    }
  };

  const schedule = (callback: () => void) => {
    // Let Crepe's Vue preview mount its sanitized clone before checking markers.
    const timer = window.setTimeout(() => {
      timers.delete(timer);
      if (!disposed) callback();
    }, 0);
    timers.add(timer);
  };

  const renderPreview: CodeBlockConfig["renderPreview"] = (language, source, apply) => {
    if (disposed) return null;
    schedule(prune);
    if (language.trim().toLowerCase() !== "mermaid") return null;
    const request: PreviewRequest = {
      id: `doc-mermaid-${++nextPreviewId}`,
      source,
      revision: 0,
      apply,
    };
    requests.set(request.id, request);
    const loading = wrapper(request);
    loading.setAttribute("role", "status");
    loading.textContent = messages.codePreviewLoading;
    schedule(() => {
      if (mounted(request)) void render(request);
      else requests.delete(request.id);
    });
    return loading;
  };

  const observer = new MutationObserver(() => {
    const nextDark = document.documentElement.classList.contains("dark");
    if (disposed || nextDark === dark) return;
    dark = nextDark;
    prune();
    for (const request of requests.values()) void render(request);
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

  return {
    renderPreview,
    destroy: () => {
      disposed = true;
      observer.disconnect();
      for (const timer of timers) window.clearTimeout(timer);
      timers.clear();
      requests.clear();
    },
  };
};
