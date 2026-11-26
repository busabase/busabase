"use client";

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { ContentNavigationProvider } from "../../dashboard/content-navigation-context";
import type { EmbedTargetNodeVO } from "../types";
import { resolveEmbedContentLink } from "../utils/content-link";
import { getEmbedUiCopy } from "../utils/embed-ui-copy";

/**
 * Keep links authored in the content inside the current embed's reading
 * boundary. Window capture runs before the host's document-capture progress
 * listener, so a blocked route cannot leave a website loading bar running.
 */
export function EmbedContentNavigation({
  children,
  locale,
  node,
}: {
  children: ReactNode;
  locale?: string;
  /** A fixed record/change-request surface omits this to forbid all route changes. */
  node?: EmbedTargetNodeVO;
}) {
  const root = useRef<HTMLDivElement>(null);
  const portalScopes = useRef(new Set<HTMLElement>());
  const [activePortal, setActivePortal] = useState<HTMLElement | null>(null);
  const [notice, setNotice] = useState(0);
  const registerScope = useCallback((element: HTMLElement) => {
    portalScopes.current.add(element);
    setActivePortal(element);
    setNotice(0);
    return () => {
      if (portalScopes.current.delete(element)) {
        setActivePortal(Array.from(portalScopes.current).at(-1) ?? null);
        // A rejected link belongs to the dialog the reader just closed, not
        // to the underlying page or the next preview they open.
        setNotice(0);
      }
    };
  }, []);
  const [route, navigate] = useLocation();
  const search = useSearch();
  const copy = getEmbedUiCopy(locale);
  const resolve = useCallback(
    (href: string) =>
      resolveEmbedContentLink({
        href,
        currentHref: window.location.href,
        currentRoute: route,
        node,
      }),
    [node, route],
  );

  // Buttons can change a Base view or select a file without clicking an anchor.
  // Such a successful reading action dismisses a previous rejected-link notice.
  // biome-ignore lint/correctness/useExhaustiveDependencies: route and search changes are the successful reading actions that clear this notice.
  useEffect(() => setNotice(0), [route, search]);

  const handlePreviewNavigation = useCallback(
    (href: string): boolean => {
      const destination = resolve(href);
      if (destination.kind === "route") {
        setNotice(0);
        navigate(destination.path);
      } else if (destination.kind === "fragment") {
        setNotice(0);
        window.location.hash = destination.hash;
      } else if (
        destination.kind === "external" ||
        destination.kind === "asset" ||
        destination.kind === "contact"
      ) {
        setNotice(0);
        window.open(
          destination.kind === "external" ? destination.href : href,
          "_blank",
          "noopener,noreferrer",
        );
      } else {
        setNotice((current) => current + 1);
      }
      return true;
    },
    [navigate, resolve],
  );

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || (event.button !== 0 && event.button !== 1)) return;
      const anchor = event
        .composedPath()
        .find((entry): entry is HTMLAnchorElement => entry instanceof HTMLAnchorElement);
      if (
        !anchor ||
        (!root.current?.contains(anchor) &&
          !Array.from(portalScopes.current).some((scope) => scope.contains(anchor)))
      )
        return;
      const href = anchor.getAttribute("href");
      if (href === null) return;

      const destination = resolve(href);
      if (destination.kind === "blocked" || destination.kind === "route") {
        event.preventDefault();
        event.stopPropagation();
        if (destination.kind === "route") {
          setNotice(0);
          navigate(destination.path);
        } else {
          setNotice((current) => current + 1);
        }
        return;
      }
      if (destination.kind === "fragment") {
        setNotice(0);
        // A document anchor is always local, even if authored with target=_top
        // or as the full physical URL of this document.
        anchor.setAttribute("href", destination.hash);
        anchor.target = "_self";
        return;
      }

      // Preserve native activation and popup/download behavior. Decorating the
      // anchor before document capture also keeps the website's progress bar
      // from treating a read-only asset link as an App Router navigation.
      setNotice(0);
      anchor.target = "_blank";
      anchor.relList.add("noopener", "noreferrer");
      anchor.referrerPolicy = "no-referrer";
      anchor.dataset.nprogress = "ignore";
    };

    window.addEventListener("click", onClick, true);
    window.addEventListener("auxclick", onClick, true);
    return () => {
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("auxclick", onClick, true);
    };
  }, [navigate, resolve]);

  const feedback =
    notice > 0 ? (
      <div
        aria-atomic="true"
        className="flex shrink-0 items-center justify-between gap-3 border-border border-t bg-background px-4 py-2 text-muted-foreground text-sm"
        key={notice}
        role="status"
      >
        <span>{copy.navigationUnavailable}</span>
        <button
          aria-label={copy.dismiss}
          className="rounded-sm p-1 text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          onClick={() => setNotice(0)}
          type="button"
        >
          ×
        </button>
      </div>
    ) : null;

  return (
    <ContentNavigationProvider
      activeScope={activePortal}
      feedback={feedback}
      navigate={handlePreviewNavigation}
      registerScope={registerScope}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col" ref={root}>
        {children}
        {activePortal === null ? feedback : null}
      </div>
    </ContentNavigationProvider>
  );
}
