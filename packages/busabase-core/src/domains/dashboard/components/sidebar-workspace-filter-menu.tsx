"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "kui/dropdown-menu";
import { Check, ChevronDown } from "lucide-react";
import type { WorkspaceFilterKey } from "../helpers/sidebar-workspace-filter";
import { WORKSPACE_FILTERS } from "../helpers/sidebar-workspace-filter";

interface Props {
  value: WorkspaceFilterKey;
  onChange: (value: WorkspaceFilterKey) => void;
  /**
   * Which options to render, defaulting to all of them. Passed in because one
   * of them ("Shared") is permission-gated: `nodes.share.list` is a
   * manage-level procedure, so for a viewer the entry would open onto nothing
   * it can read. Hidden, not disabled — a greyed row that cannot explain
   * itself is worse than an option that simply is not on offer.
   */
  filters?: readonly WorkspaceFilterKey[];
  /**
   * Already-localized copy: one label per filter, plus the trigger's accessible
   * name. Passed in rather than read from the i18n context here because the
   * shell that renders this resolves its own catalog by `locale` prop (it sits
   * outside `BusabaseDashboard`'s provider) — reading the context here would
   * silently fall back to English in exactly that host.
   */
  labels: {
    trigger: string;
    options: Record<WorkspaceFilterKey, string>;
  };
}

/**
 * The sidebar "Workspace" group label, turned into a filter. Renders INSIDE
 * `SidebarGroupLabel` (via `NavGroup.labelSlot`), so it deliberately declares
 * no font size / weight / uppercase / colour of its own — all of that is
 * inherited, which is what keeps it reading as the section heading it replaced
 * rather than as a control bolted on top of one.
 *
 * Intrinsic width, never `w-full`: the group's `+` action is a sibling
 * `SidebarGroupAction` positioned over the label row's right edge, and a
 * full-width trigger would sit under it and swallow the click.
 */
export function SidebarWorkspaceFilterMenu({
  value,
  onChange,
  labels,
  filters = WORKSPACE_FILTERS,
}: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={labels.trigger}
        className="inline-flex items-center gap-1 rounded transition-colors hover:text-sidebar-foreground"
        title={labels.trigger}
        type="button"
      >
        <span>{labels.options[value]}</span>
        <ChevronDown className="size-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {filters.map((key) => (
          <DropdownMenuItem key={key} onSelect={() => onChange(key)}>
            <span className="flex-1">{labels.options[key]}</span>
            {key === value ? <Check className="size-3.5" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
