/**
 * Links inside user content — a Doc's Markdown, a whiteboard element — that
 * point back into the workbench on screen.
 *
 * The workbench is a single-page app under one host page, so following such a
 * link with a native navigation reloads everything: the sidebar, open panels,
 * running AirApps and every cached query are thrown away just to show another
 * node of the same space. These helpers decide when a link can instead be
 * routed in place.
 */

/**
 * Maps a link to the workbench route it opens — relative to the router base,
 * query and hash kept — or null when following it really does leave this
 * workbench (another site, another space, a page outside the dashboard).
 *
 * Supplied by the host: only it knows every URL shape that names the space on
 * screen (Cloud links carry the space id while its address bar may use the
 * slug). A host that passes none keeps every link a native navigation.
 */
export type WorkbenchLinkResolver = (url: URL) => string | null;

/**
 * Resolver for a host whose links name the space exactly the way its router
 * base does (open source: `/dashboard/local`): a same-origin link under `base`
 * opens the route below it.
 */
export const resolveWorkbenchLinkUnderBase = (
  url: URL,
  base: string,
  origin: string,
): string | null => {
  if (!base || url.origin !== origin) return null;
  if (url.pathname !== base && !url.pathname.startsWith(`${base}/`)) return null;
  return `${url.pathname.slice(base.length) || "/"}${url.search}${url.hash}`;
};

/**
 * The workbench route a raw `href` opens, resolved against the current page.
 * In-page anchors (`#heading`) and non-web schemes (`mailto:`) stay with the
 * browser: neither reloads the page.
 */
export const resolveWorkbenchLinkHref = (
  href: string,
  currentHref: string,
  resolve: WorkbenchLinkResolver,
): string | null => {
  if (!href || href.startsWith("#")) return null;
  let url: URL;
  try {
    url = new URL(href, currentHref);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return resolve(url);
};

/**
 * A click the browser should keep handling itself is anything but a plain
 * primary click: ⌘/Ctrl/Shift/Alt-click opens a new tab or window, or
 * downloads, and the user asked for exactly that.
 */
export const isPlainPrimaryClick = (
  event: Pick<MouseEvent, "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
): boolean =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
