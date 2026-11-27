"use client";

import { RECORD_PAGE_DEPTH_LIMIT } from "busabase-contract/domains/base/contract/record-schemas";
import { Button } from "kui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "kui/select";
import { cn } from "kui/utils";
import { RotateCcw } from "lucide-react";
import { fmt, useCoreI18n } from "../../../i18n";
import { clampPaginationPage, getPaginationRange } from "../helpers/pagination";
import type { RecordPageSize } from "../helpers/record-pagination-url";
import { PaginationNav } from "./pagination-nav";

/** Inbox page sizes. A Base passes its own, larger list. */
export const RECORD_PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
export type { RecordPageSize };

export interface RecordsPaginationBarProps<T extends number = RecordPageSize> {
  className?: string;
  error?: string | null;
  getPageHref?: (page: number) => string;
  isFetching?: boolean;
  isLoading?: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: T) => void;
  onRetry?: () => void;
  page: number;
  pageSize: T;
  /** Defaults to 25/50/100. A Base table passes the larger record-page list. */
  pageSizeOptions?: readonly T[];
  total: number;
  totalPages: number;
  /** `total` is a lower bound: shown as "1000000+". */
  totalCapped?: boolean;
  /** Records past the first RECORD_PAGE_DEPTH_LIMIT have no page number. */
  pagesCapped?: boolean;
}

export function RecordsPaginationBar<T extends number>({
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
  pageSizeOptions,
  total,
  totalPages,
  totalCapped = false,
  pagesCapped = false,
}: RecordsPaginationBarProps<T>) {
  const options = (pageSizeOptions ?? RECORD_PAGE_SIZE_OPTIONS) as unknown as readonly T[];
  const messages = useCoreI18n();
  const safeTotalPages = Math.max(Math.trunc(totalPages) || 1, 1);
  const safePage = clampPaginationPage(page, safeTotalPages);
  const recordRange = getPaginationRange(safePage, pageSize, total);
  const isBusy = isLoading || isFetching;

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
          {error
            ? messages.shell.operationFailed
            : fmt(messages.base.paginationRange, {
                from: recordRange.from,
                to: recordRange.to,
                total: `${Math.max(total, 0)}${totalCapped ? "+" : ""}`,
              })}
        </p>
        <div className="flex items-center gap-2 whitespace-nowrap text-muted-foreground text-sm">
          <span>{messages.base.paginationRowsPerPage}</span>
          <Select
            disabled={isBusy}
            onValueChange={(value) => {
              const next = Number(value);
              if ((options as readonly number[]).includes(next)) onPageSizeChange(next as T);
            }}
            value={String(pageSize)}
          >
            <SelectTrigger
              aria-label={messages.base.paginationRowsPerPage}
              className="h-8 w-24"
              data-testid="record-page-size"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex min-w-0 flex-col items-end gap-2 self-end sm:ml-auto">
        <PaginationNav
          ariaLabel={messages.base.paginationLabel}
          className="justify-end"
          disabled={isBusy}
          getPageHref={getPageHref}
          onPageChange={onPageChange}
          page={safePage}
          totalPages={safeTotalPages}
        />

        {pagesCapped && !error ? (
          <p className="text-right text-muted-foreground text-xs">
            {fmt(messages.base.paginationDepthLimit, { limit: RECORD_PAGE_DEPTH_LIMIT })}
          </p>
        ) : null}

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
