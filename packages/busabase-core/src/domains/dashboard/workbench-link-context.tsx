"use client";

import {
  createContext,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useContext,
  useRef,
} from "react";
import { useLocation, useSearch } from "wouter";
import { mergeSearchIntoHref } from "./helpers/link-search";
import {
  isPlainPrimaryClick,
  resolveWorkbenchLinkHref,
  type WorkbenchLinkResolver,
} from "./utils/workbench-link";

/**
 * The host's answer to "is this link a route of the workbench on screen?" (see
 * `WorkbenchLinkResolver`), reachable from the content surfaces that render
 * user-written links: the Doc reader, the whiteboard canvases.
 *
 * Optional (`undefined` by default): a host that never wired one — a public
 * share, an embed — keeps every link a native navigation, which is what they
 * all were before.
 */
const WorkbenchLinkContext = createContext<WorkbenchLinkResolver | undefined>(undefined);

export function WorkbenchLinkProvider({
  children,
  resolveWorkbenchLink,
}: {
  children: ReactNode;
  resolveWorkbenchLink?: WorkbenchLinkResolver;
}) {
  return (
    <WorkbenchLinkContext.Provider value={resolveWorkbenchLink}>
      {children}
    </WorkbenchLinkContext.Provider>
  );
}

/**
 * Opens `href` in place when it names a route of the workbench on screen, and
 * says whether it did — false means the caller should let the browser follow
 * the link as usual. The page's query is carried over like every other in-app
 * link (`mergeSearchIntoHref`). Stable identity: Excalidraw re-renders its whole
 * canvas on every new `onLinkOpen`.
 */
export function useOpenWorkbenchLink(): (href: string) => boolean {
  const resolve = useContext(WorkbenchLinkContext);
  const [, setLocation] = useLocation();
  const currentSearch = useSearch();
  const latest = useRef({ resolve, setLocation, currentSearch });
  latest.current = { resolve, setLocation, currentSearch };

  return useCallback((href: string) => {
    const { resolve, setLocation, currentSearch } = latest.current;
    if (!resolve) return false;
    const path = resolveWorkbenchLinkHref(href, window.location.href, resolve);
    if (path === null) return false;
    const hashIndex = path.indexOf("#");
    const route = hashIndex === -1 ? path : path.slice(0, hashIndex);
    const hash = hashIndex === -1 ? "" : path.slice(hashIndex);
    setLocation(`${mergeSearchIntoHref(route, currentSearch)}${hash}`);
    return true;
  }, []);
}

/**
 * `onClick` for a container of rendered user content (a Doc in reading mode):
 * a plain click on one of its workbench links routes in place instead of
 * reloading the page. Links that open elsewhere — another site, a new tab, a
 * download — are left alone.
 */
export function useWorkbenchLinkClickHandler(): (event: MouseEvent<HTMLElement>) => void {
  const openWorkbenchLink = useOpenWorkbenchLink();
  return useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (event.defaultPrevented || !isPlainPrimaryClick(event)) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || !event.currentTarget.contains(anchor)) return;
      if ((anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;
      if (openWorkbenchLink(anchor.getAttribute("href") ?? "")) event.preventDefault();
    },
    [openWorkbenchLink],
  );
}

type ClickModifiers = Pick<MouseEvent, "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">;

/**
 * Excalidraw's `onLinkOpen`. Without it, Excalidraw opens a same-site link with
 * `window.open(url, "_self")` — a full page load — from both the canvas link
 * icon and the link popup; cancelling the event is how it is told not to.
 */
export function useWorkbenchLinkOpenHandler(): (
  element: { link: string | null },
  event: CustomEvent<{ nativeEvent: ClickModifiers }>,
) => void {
  const openWorkbenchLink = useOpenWorkbenchLink();
  return useCallback(
    (element: { link: string | null }, event: CustomEvent<{ nativeEvent: ClickModifiers }>) => {
      if (!element.link || !isPlainPrimaryClick(event.detail.nativeEvent)) return;
      if (openWorkbenchLink(element.link)) event.preventDefault();
    },
    [openWorkbenchLink],
  );
}
