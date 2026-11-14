"use client";

/**
 * Previous · numbered pages · Next — the page links alone, with no range text
 * or page-size picker around them.
 *
 * Shared by the records table (`RecordsPaginationBar`), the Template Center
 * and the public templates gallery, so all three page the same way and read
 * the same to a screen reader. Every control is a real `<a href>`: a caller
 * that passes `onPageChange` gets in-app paging (the click is intercepted), a
 * caller that does not — a statically rendered public page — gets plain links
 * a crawler can follow and that work with JavaScript off.
 */

import { Pagination, PaginationContent, PaginationItem, PaginationLink } from "kui/pagination";
import { cn } from "kui/utils";
import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import type { MouseEvent } from "react";
import { fmt, useCoreI18n } from "../../../i18n";
import { clampPaginationPage, getPaginationItems } from "../helpers/pagination";

export interface PaginationNavProps {
  page: number;
  totalPages: number;
  /** The landmark's name — "Record pages", "Template pages", … */
  ariaLabel: string;
  /** Each page's address. Without it the links point at `#` and only `onPageChange` moves. */
  getPageHref?: (page: number) => string;
  /** In-app paging. When given, a click is intercepted instead of navigating. */
  onPageChange?: (page: number) => void;
  /** A request in flight: links stay visible but cannot be activated. */
  disabled?: boolean;
  className?: string;
}

export function PaginationNav({
  page,
  totalPages,
  ariaLabel,
  getPageHref,
  onPageChange,
  disabled = false,
  className,
}: PaginationNavProps) {
  const messages = useCoreI18n();
  const safeTotalPages = Math.max(Math.trunc(totalPages) || 1, 1);
  const safePage = clampPaginationPage(page, safeTotalPages);
  const pageItems = getPaginationItems(safePage, safeTotalPages);

  const handlePageLink = onPageChange
    ? (event: MouseEvent<HTMLAnchorElement>, nextPage: number) => {
        event.preventDefault();
        const clampedPage = clampPaginationPage(nextPage, safeTotalPages);
        if (!disabled && clampedPage !== safePage) onPageChange(clampedPage);
      }
    : undefined;

  const pageHref = (targetPage: number) => getPageHref?.(targetPage) ?? "#";
  const previousDisabled = disabled || safePage <= 1;
  const nextDisabled = disabled || safePage >= safeTotalPages;

  return (
    <Pagination aria-label={ariaLabel} className={cn("w-auto max-w-full", className)}>
      <PaginationContent className="gap-0.5 sm:gap-1">
        <PaginationItem>
          <PaginationLink
            aria-disabled={previousDisabled}
            aria-label={messages.base.paginationPreviousPage}
            className={cn("gap-1 px-2", previousDisabled && "pointer-events-none opacity-50")}
            href={pageHref(Math.max(safePage - 1, 1))}
            onClick={handlePageLink && ((event) => handlePageLink(event, safePage - 1))}
            rel={safePage > 1 ? "prev" : undefined}
            size="default"
            tabIndex={previousDisabled ? -1 : undefined}
          >
            <ChevronLeft className="size-4" />
            <span className="hidden sm:inline">{messages.base.paginationPrevious}</span>
          </PaginationLink>
        </PaginationItem>

        {pageItems.map((item) =>
          typeof item === "number" ? (
            <PaginationItem key={item}>
              <PaginationLink
                aria-label={fmt(
                  item === safePage
                    ? messages.base.paginationCurrentPage
                    : messages.base.paginationPage,
                  { page: item },
                )}
                aria-disabled={disabled}
                // Square for short numbers, wider for "1999": a Base of 100,000
                // records numbers its pages into the thousands.
                className={cn(
                  "w-auto min-w-8 px-1.5",
                  disabled && "pointer-events-none opacity-50",
                )}
                href={pageHref(item)}
                isActive={item === safePage}
                onClick={handlePageLink && ((event) => handlePageLink(event, item))}
                size="icon-sm"
                tabIndex={disabled ? -1 : undefined}
              >
                {item}
              </PaginationLink>
            </PaginationItem>
          ) : (
            <PaginationItem className="hidden sm:block" key={item}>
              <span aria-hidden className="flex size-9 items-center justify-center">
                <MoreHorizontal className="size-4" />
              </span>
              <span className="sr-only">{messages.base.paginationMorePages}</span>
            </PaginationItem>
          ),
        )}

        <PaginationItem>
          <PaginationLink
            aria-disabled={nextDisabled}
            aria-label={messages.base.paginationNextPage}
            className={cn("gap-1 px-2", nextDisabled && "pointer-events-none opacity-50")}
            href={pageHref(Math.min(safePage + 1, safeTotalPages))}
            onClick={handlePageLink && ((event) => handlePageLink(event, safePage + 1))}
            rel={safePage < safeTotalPages ? "next" : undefined}
            size="default"
            tabIndex={nextDisabled ? -1 : undefined}
          >
            <span className="hidden sm:inline">{messages.base.paginationNext}</span>
            <ChevronRight className="size-4" />
          </PaginationLink>
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}
