"use client";

import { Button } from "kui/button";
import { Pagination, PaginationContent, PaginationItem, PaginationLink } from "kui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "kui/select";
import { cn } from "kui/utils";
import { ChevronLeft, ChevronRight, MoreHorizontal, RotateCcw } from "lucide-react";
import type { MouseEvent } from "react";
import { fmt, useCoreI18n } from "../../../i18n";
import { clampPaginationPage, getPaginationItems, getPaginationRange } from "../helpers/pagination";

export const RECORD_PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
export type RecordPageSize = (typeof RECORD_PAGE_SIZE_OPTIONS)[number];

export interface RecordsPaginationBarProps {
  className?: string;
  error?: string | null;
  getPageHref?: (page: number) => string;
  isFetching?: boolean;
  isLoading?: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: RecordPageSize) => void;
  onRetry?: () => void;
  page: number;
  pageSize: RecordPageSize;
  total: number;
  totalPages: number;
}

export function RecordsPaginationBar({
  className,
  error,
  getPageHref,
  isFetching = false,
  isLoading = false,
  onPageChange,
  onPageSizeChange,
  onRetry,
  page,
  pageSize,
  total,
  totalPages,
}: RecordsPaginationBarProps) {
  const messages = useCoreI18n();
  const safeTotalPages = Math.max(Math.trunc(totalPages) || 1, 1);
  const safePage = clampPaginationPage(page, safeTotalPages);
  const pageItems = getPaginationItems(safePage, safeTotalPages);
  const recordRange = getPaginationRange(safePage, pageSize, total);
  const isBusy = isLoading || isFetching;

  const changePage = (nextPage: number) => {
    const clampedPage = clampPaginationPage(nextPage, safeTotalPages);
    if (!isBusy && clampedPage !== safePage) {
      onPageChange(clampedPage);
    }
  };

  const handlePageLink = (event: MouseEvent<HTMLAnchorElement>, nextPage: number) => {
    event.preventDefault();
    changePage(nextPage);
  };

  const pageHref = (targetPage: number) => getPageHref?.(targetPage) ?? "#";
  const previousDisabled = isBusy || safePage <= 1;
  const nextDisabled = isBusy || safePage >= safeTotalPages;

  return (
    <div
      aria-busy={isBusy}
      className={cn(
        "flex flex-col gap-3 border-border border-t px-3 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <p className="whitespace-nowrap text-muted-foreground text-sm tabular-nums">
          {fmt(messages.base.paginationRange, {
            from: recordRange.from,
            to: recordRange.to,
            total: Math.max(total, 0),
          })}
        </p>
        <div className="flex items-center gap-2 whitespace-nowrap text-muted-foreground text-sm">
          <span>{messages.base.paginationRowsPerPage}</span>
          <Select
            disabled={isBusy}
            onValueChange={(value) => onPageSizeChange(Number(value) as RecordPageSize)}
            value={String(pageSize)}
          >
            <SelectTrigger aria-label={messages.base.paginationRowsPerPage} className="h-8 w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RECORD_PAGE_SIZE_OPTIONS.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex min-w-0 flex-col items-end gap-2 self-end sm:ml-auto">
        <Pagination
          aria-label={messages.base.paginationLabel}
          className="w-auto max-w-full justify-end"
        >
          <PaginationContent className="gap-0.5 sm:gap-1">
            <PaginationItem>
              <PaginationLink
                aria-disabled={previousDisabled}
                aria-label={messages.base.paginationPreviousPage}
                className={cn("gap-1 px-2", previousDisabled && "pointer-events-none opacity-50")}
                href={pageHref(Math.max(safePage - 1, 1))}
                onClick={(event) => handlePageLink(event, safePage - 1)}
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
                    aria-disabled={isBusy}
                    className={cn(isBusy && "pointer-events-none opacity-50")}
                    href={pageHref(item)}
                    isActive={item === safePage}
                    onClick={(event) => handlePageLink(event, item)}
                    size="icon-sm"
                    tabIndex={isBusy ? -1 : undefined}
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
                onClick={(event) => handlePageLink(event, safePage + 1)}
                size="default"
                tabIndex={nextDisabled ? -1 : undefined}
              >
                <span className="hidden sm:inline">{messages.base.paginationNext}</span>
                <ChevronRight className="size-4" />
              </PaginationLink>
            </PaginationItem>
          </PaginationContent>
        </Pagination>

        {error ? (
          <div className="flex min-w-0 items-center gap-2 text-destructive text-sm" role="alert">
            <span className="truncate" title={error}>
              {error}
            </span>
            {onRetry ? (
              <Button disabled={isBusy} onClick={onRetry} size="sm" type="button" variant="outline">
                <RotateCcw aria-hidden />
                {messages.base.paginationRetry}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
