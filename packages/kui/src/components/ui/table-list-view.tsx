"use client";

import { type LucideIcon, Plus, Search } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "./button";
import { ButtonGroup } from "./button-group";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./empty";
import { Input } from "./input";
import { StatsCard } from "./stats-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table";

/**
 * Generic configuration for list view filters
 */
export interface FilterConfig<T extends string> {
  id: T | "all";
  label: string;
}

/**
 * Generic configuration for stat cards
 */
export interface StatConfig {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  variant?: "default" | "primary" | "success" | "info";
}

/**
 * Generic list item interface - extend this for specific use cases
 */
export interface TableListItem {
  id: string;
  [key: string]: unknown;
}

/**
 * Configuration for badge display
 */
export interface BadgeConfig {
  label: string;
  variant?: "default" | "secondary" | "outline" | "destructive";
  color?: string;
}

/**
 * Column configuration for the table
 */
export interface ColumnConfig<TItem extends TableListItem> {
  key: string;
  label: string;
  width?: string;
  render: (item: TItem) => ReactNode;
}

/**
 * Props for the generic TableListView component
 */
export interface TableListViewProps<
  TItem extends TableListItem,
  TTypeFilter extends string = never,
  TStatusFilter extends string = never,
> {
  // Header
  title: string;
  description: string;
  onCreateNew?: () => void;
  createButtonLabel?: string;

  // Data
  items: TItem[];
  stats: StatConfig[];
  columns: ColumnConfig<TItem>[];

  // Search & Filter
  searchPlaceholder?: string;
  searchFields?: (keyof TItem)[];
  typeFilters?: FilterConfig<TTypeFilter>[];
  statusFilters?: FilterConfig<TStatusFilter>[];

  // Item rendering
  onRowClick?: (item: TItem) => void;

  // Empty state
  emptyIcon?: LucideIcon;
  emptyTitle?: string;
  emptyDescription?: string;
}

/**
 * Generic TableListView component for Issues with a Linear-inspired design
 *
 * This component provides:
 * - Header with title, description, and create button
 * - Stats cards
 * - Search and filter controls
 * - Table-based list with customizable columns
 * - Empty state
 */
export function TableListView<
  TItem extends TableListItem,
  TTypeFilter extends string = never,
  TStatusFilter extends string = never,
>({
  title,
  description,
  onCreateNew,
  createButtonLabel = "New Item",
  items,
  stats,
  columns,
  searchPlaceholder = "Search...",
  searchFields = ["id", "title", "description"] as (keyof TItem)[],
  typeFilters,
  statusFilters,
  onRowClick,
  emptyIcon: EmptyIcon = Search,
  emptyTitle = "No items found",
  emptyDescription = "Try adjusting your search or filters to find what you're looking for.",
}: TableListViewProps<TItem, TTypeFilter, TStatusFilter>) {
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TTypeFilter | "all">("all" as const);
  const [statusFilter, setStatusFilter] = useState<TStatusFilter | "all">("all" as const);

  // Filter items based on search and filters
  const filteredItems = items.filter((item) => {
    // Search filter
    const matchesSearch =
      !searchQuery ||
      searchFields.some((field) => {
        const value = item[field];
        if (typeof value === "string") {
          return value.toLowerCase().includes(searchQuery.toLowerCase());
        }
        return false;
      });

    const matchesType =
      !typeFilters || typeFilter === "all" || (item as Record<string, unknown>).type === typeFilter;

    const matchesStatus =
      !statusFilters ||
      statusFilter === "all" ||
      (item as Record<string, unknown>).status === statusFilter;

    return matchesSearch && matchesType && matchesStatus;
  });

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="border-b border-border/50 bg-background px-6 py-5">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="text-sm text-muted-foreground mt-1">{description}</p>
          </div>
          {onCreateNew && (
            <Button onClick={onCreateNew}>
              <Plus className="w-4 h-4 mr-2" />
              {createButtonLabel}
            </Button>
          )}
        </div>

        {/* Stats */}
        <div
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
          style={{ gridTemplateColumns: `repeat(${Math.min(stats.length, 4)}, minmax(0, 1fr))` }}
        >
          {stats.map((stat) => (
            <StatsCard
              key={stat.label}
              icon={stat.icon}
              label={stat.label}
              value={stat.value}
              variant={stat.variant}
            />
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="border-b border-border/50 bg-background px-6 py-3">
        <div className="flex items-center gap-4">
          {/* Search */}
          <div className="flex-1 relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder={searchPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Type Filters */}
          {typeFilters && typeFilters.length > 0 && (
            <ButtonGroup>
              {typeFilters.map((filter) => (
                <Button
                  key={filter.id}
                  variant={typeFilter === filter.id ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTypeFilter(filter.id as TTypeFilter | "all")}
                >
                  {filter.label}
                </Button>
              ))}
            </ButtonGroup>
          )}

          {/* Status Filters */}
          {statusFilters && statusFilters.length > 0 && (
            <ButtonGroup>
              {statusFilters.map((filter) => (
                <Button
                  key={filter.id}
                  variant={statusFilter === filter.id ? "default" : "outline"}
                  size="sm"
                  onClick={() => setStatusFilter(filter.id as TStatusFilter | "all")}
                >
                  {filter.label}
                </Button>
              ))}
            </ButtonGroup>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto bg-background">
        {filteredItems.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((column) => (
                  <TableHead key={column.key} style={{ width: column.width }}>
                    {column.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredItems.map((item) => (
                <TableRow
                  key={item.id}
                  onClick={() => onRowClick?.(item)}
                  className={onRowClick ? "cursor-pointer" : ""}
                >
                  {columns.map((column) => (
                    <TableCell key={column.key}>{column.render(item)}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="flex items-center justify-center h-full p-8">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <EmptyIcon />
                </EmptyMedia>
                <EmptyTitle>{emptyTitle}</EmptyTitle>
                <EmptyDescription>{emptyDescription}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        )}
      </div>
    </div>
  );
}
