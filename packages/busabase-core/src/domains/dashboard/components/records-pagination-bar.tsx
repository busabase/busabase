"use client";

import { Button } from "kui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "kui/select";
import { cn } from "kui/utils";
import { RotateCcw } from "lucide-react";
import { fmt, useCoreI18n } from "../../../i18n";
import { clampPaginationPage, getPaginationRange } from "../helpers/pagination";
import { PaginationNav } from "./pagination-nav";

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
        <PaginationNav
          ariaLabel={messages.base.paginationLabel}
          className="justify-end"
          disabled={isBusy}
          getPageHref={getPageHref}
          onPageChange={onPageChange}
          page={safePage}
          totalPages={safeTotalPages}
        />

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
