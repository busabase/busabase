import { listNodeTypes } from "busabase-contract/domains";
import { parse } from "parse5";
import type { WorkbenchLinkResolver } from "../../dashboard/utils/workbench-link";

const MESSAGE_TYPE = "busabase:html-preview:navigate";

interface PreviewNavigationConfig {
  parentHref: string;
  sessionId: string;
}

/** Runs inside the opaque-origin frame. Keep this function entirely self-contained. */
function installPreviewNavigation(config: PreviewNavigationConfig) {
  const parentOrigin = new URL(config.parentHref).origin;
  const navigate = (event: MouseEvent) => {
    if (!event.isTrusted || event.defaultPrevented || (event.button !== 0 && event.button !== 1)) {
      return;
    }
    const anchor = event
      .composedPath()
      .find((item): item is HTMLAnchorElement => item instanceof HTMLAnchorElement);
    if (!anchor || anchor.hasAttribute("download")) return;
    const href = anchor.getAttribute("href");
    if (!href) return;
    let url: URL;
    try {
      const base = document.querySelector("base[href]")?.getAttribute("href");
      url = new URL(href, base ? new URL(base, config.parentHref) : config.parentHref);
    } catch {
      return;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    // A plain fragment belongs to this HTML document, including with a <base>.
    if (href.trimStart().startsWith("#")) {
      event.preventDefault();
      window.location.hash = href.trimStart();
      return;
    }
    const target =
      anchor.getAttribute("target") ??
      document.querySelector("base[target]")?.getAttribute("target") ??
      "";
    const newContext =
      event.button === 1 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      (target !== "" && !["_self", "_top", "_parent"].includes(target.toLowerCase()));
    if (newContext) {
      // Keep the native user gesture (and middle/modifier-click semantics).
      // Escape the sandbox only in the newly opened document, never this frame.
      const original = ["target", "rel", "href"].map(
        (name) => [name, anchor.getAttribute(name)] as const,
      );
      anchor.target = "_blank";
      anchor.relList.add("noopener", "noreferrer");
      anchor.href = url.href;
      // Only the current native activation needs these attributes. A later
      // ordinary click on this same anchor should still navigate in place.
      setTimeout(() => {
        for (const [name, value] of original) {
          if (value === null) anchor.removeAttribute(name);
          else anchor.setAttribute(name, value);
        }
      }, 0);
      return;
    }
    event.preventDefault();
    window.parent.postMessage(
      { type: "busabase:html-preview:navigate", sessionId: config.sessionId, href: url.href },
      parentOrigin,
    );
  };
  // Let authored handlers cancel navigation first (for example, a local tab
  // widget). Delegation still picks up anchors added after the document loads.
  document.addEventListener("click", navigate);
  document.addEventListener("auxclick", navigate);
}

/** Add platform behavior to the preview only; never rewrite the saved HTML. */
export function buildHtmlPreviewDocument(source: string, config: PreviewNavigationConfig): string {
  const json = JSON.stringify(config).replace(/</g, "\\u003c");
  const script = `<script>(${installPreviewNavigation.toString()})(${json});</script>`;
  const document = parse(source, { sourceCodeLocationInfo: true });
  const html = document.childNodes.find((node) => node.nodeName === "html");
  const head =
    html && "childNodes" in html
      ? html.childNodes.find((node) => node.nodeName === "head")
      : undefined;
  const headLocation = head?.sourceCodeLocation;
  const doctype = document.childNodes.find((node) => node.nodeName === "#documentType");
  const offset =
    headLocation && "startTag" in headLocation
      ? (headLocation.startTag?.endOffset ?? 0)
      : (doctype?.sourceCodeLocation?.endOffset ?? 0);
  return `${source.slice(0, offset)}${script}${source.slice(offset)}`;
}

const isNodeRoute = (path: string): boolean => {
  const [, type, reference] = /^\/([^/]+)\/([^/?#]+)(?:\/|[?#]|$)/.exec(path) ?? [];
  return Boolean(
    reference && listNodeTypes().some((node) => node.type === type && node.capabilities.hasDetail),
  );
};

/** A missing host resolver only recognizes the exact workspace in the address bar. */
function fallbackNodeRoute(url: URL, current: URL): string | null {
  if (url.origin !== current.origin) return null;
  const prefix = /^\/dashboard\/[^/]+(?=\/)/.exec(current.pathname)?.[0];
  if (!prefix || !url.pathname.startsWith(`${prefix}/`)) return null;
  return url.pathname.slice(prefix.length);
}

export function resolveHtmlPreviewNavigation({
  data,
  sessionId,
  currentHref,
  resolveWorkbenchLink,
}: {
  data: unknown;
  sessionId: string;
  currentHref: string;
  resolveWorkbenchLink?: WorkbenchLinkResolver;
}): { href: string; inPlace: boolean } | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const message = data as Record<string, unknown>;
  if (
    Object.keys(message).length !== 3 ||
    message.type !== MESSAGE_TYPE ||
    message.sessionId !== sessionId ||
    typeof message.href !== "string" ||
    message.href.length > 16_384
  )
    return null;
  let url: URL;
  try {
    url = new URL(message.href);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
  const route = resolveWorkbenchLink
    ? resolveWorkbenchLink(url)
    : fallbackNodeRoute(url, new URL(currentHref));
  return { href: url.href, inPlace: route !== null && isNodeRoute(route) };
}
