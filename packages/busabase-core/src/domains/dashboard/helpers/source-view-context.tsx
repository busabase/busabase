"use client";

import { createContext, type ReactNode, useContext } from "react";
import { useSearch } from "wouter";
import { mergeSearchIntoHref } from "./link-search";
import { readSourceViewSlug, withSourceView } from "./source-view-url";

const SourceViewSlugContext = createContext<string | null | undefined>(undefined);

/** The view whose records are on screen, so a record link can name it. */
export function SourceViewProvider({
  slug,
  children,
}: {
  slug?: string | null;
  children: ReactNode;
}) {
  return (
    <SourceViewSlugContext.Provider value={slug || null}>{children}</SourceViewSlugContext.Provider>
  );
}

export function useSourceViewSlug(): string | null {
  const provided = useContext(SourceViewSlugContext);
  const search = useSearch();
  // Full record pages carry their source in the URL. An explicit null from a
  // provider still means "no source" (for example, a cross-Base preview).
  return provided === undefined ? readSourceViewSlug(search) : provided;
}

/** A record href that keeps the view it was opened from, plus the current page's query. */
export function useRecordHref(path: string): string {
  const search = useSearch();
  const viewSlug = useSourceViewSlug();
  return mergeSearchIntoHref(withSourceView(path, viewSlug), search);
}
