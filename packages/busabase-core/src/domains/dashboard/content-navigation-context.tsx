"use client";

import { createContext, type ReactNode, useCallback, useContext, useRef } from "react";

/** A content host can consume a link before a sandboxed preview leaves it. */
export type ContentNavigationHandler = (href: string) => boolean;

interface ContentNavigation {
  navigate: ContentNavigationHandler;
  registerScope?: (element: HTMLElement) => () => void;
  activeScope?: HTMLElement | null;
  feedback?: ReactNode;
}

const ContentNavigationContext = createContext<ContentNavigation | undefined>(undefined);

export function ContentNavigationProvider({
  children,
  activeScope,
  feedback,
  navigate,
  registerScope,
}: {
  children: ReactNode;
  activeScope?: HTMLElement | null;
  feedback?: ReactNode;
  navigate: ContentNavigationHandler;
  registerScope?: ContentNavigation["registerScope"];
}) {
  return (
    <ContentNavigationContext.Provider value={{ navigate, registerScope, activeScope, feedback }}>
      {children}
    </ContentNavigationContext.Provider>
  );
}

export const useContentNavigationHandler = (): ContentNavigationHandler | undefined =>
  useContext(ContentNavigationContext)?.navigate;

/**
 * A dialog portal still belongs to its content host. Register only its own
 * DOM subtree and keep navigation feedback inside the modal's accessible tree.
 * Hosts without a navigation boundary retain their existing DOM unchanged.
 */
export function ContentNavigationScope({ children }: { children: ReactNode }) {
  const context = useContext(ContentNavigationContext);
  const registerScope = context?.registerScope;
  const unregister = useRef<(() => void) | undefined>(undefined);
  const scope = useRef<HTMLDivElement | null>(null);
  const setRoot = useCallback(
    (element: HTMLDivElement | null) => {
      unregister.current?.();
      scope.current = element;
      unregister.current = element ? registerScope?.(element) : undefined;
    },
    [registerScope],
  );
  if (!registerScope) return children;
  return (
    <div className="contents" ref={setRoot}>
      {children}
      {context?.feedback && context.activeScope === scope.current ? (
        // Dialogs already size their reading area and footer to the viewport.
        // Feedback floats inside the positioned dialog instead of adding a
        // row that can be clipped below that existing content.
        <div className="absolute inset-x-4 bottom-4 z-10 overflow-hidden rounded-md bg-background shadow-lg ring-1 ring-border">
          {context.feedback}
        </div>
      ) : null}
    </div>
  );
}
