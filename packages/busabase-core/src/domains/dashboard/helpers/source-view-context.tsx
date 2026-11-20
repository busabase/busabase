"use client";

import { createContext, type ReactNode, useContext } from "react";
import { useSearch } from "wouter";
import { mergeSearchIntoHref } from "./link-search";
import { withSourceView } from "./source-view-url";

const SourceViewSlugContext = createContext<string | null>(null);

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
  return useContext(SourceViewSlugContext);
}

/** A record href that keeps the view it was opened from, plus the current page's query. */
export function useRecordHref(path: string): string {
  const search = useSearch();
  const viewSlug = useSourceViewSlug();
  return mergeSearchIntoHref(withSourceView(path, viewSlug), search);
}
