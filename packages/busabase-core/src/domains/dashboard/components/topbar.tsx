import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "kui/breadcrumb";
import { SPALink as Link } from "openlib/ui/dashboard";
import { Fragment } from "react";
import { useCoreI18n } from "../../../i18n";
import type { BusabaseBreadcrumbItem } from "../helpers/view-types";
import { useTopbarNodeActionsStore } from "../store/topbar-node-actions-store";

export function BusabaseTopbarBreadcrumb({ items }: { items: BusabaseBreadcrumbItem[] }) {
  const messages = useCoreI18n();
  const visibleItems = items.length > 0 ? items : [{ label: messages.inbox.title }];

  return (
    <Breadcrumb className="min-w-0 flex-1">
      <BreadcrumbList className="flex-nowrap gap-1.5 overflow-hidden text-xs sm:gap-2">
        {visibleItems.map((item, index) => {
          const isLast = index === visibleItems.length - 1;
          const hideOnMobile = visibleItems.length > 2 && index > 0 && !isLast;

          return (
            <Fragment key={`${item.label}-${index}`}>
              {index > 0 ? (
                <BreadcrumbSeparator
                  className={`shrink-0 text-muted-foreground/70 ${
                    hideOnMobile ? "hidden sm:inline-flex" : ""
                  }`}
                />
              ) : null}
              <BreadcrumbItem className={`min-w-0 ${hideOnMobile ? "hidden sm:inline-flex" : ""}`}>
                {item.href && !isLast ? (
                  <BreadcrumbLink asChild className="min-w-0 truncate text-muted-foreground">
                    <Link href={item.href}>{item.label}</Link>
                  </BreadcrumbLink>
                ) : (
                  <BreadcrumbPage className="min-w-0 truncate font-normal text-foreground">
                    {item.label}
                  </BreadcrumbPage>
                )}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

/**
 * Renders whatever node-detail action cluster (Edit-if-Doc + Pin + "..."
 * menu) the currently visible node-detail view registered via
 * `useRegisterTopbarNodeActions`. Kept as its own component (rather than
 * reading the store directly in `dashboard/index.tsx`) so a registration
 * change only re-renders this small slot, not the whole dashboard shell.
 *
 * Deliberately separate from the older, unrelated `topbarActions` slot next
 * to it in `index.tsx` (`RecordTopbarActions` / `BaseTopbarActions`, a
 * page-level tab switcher) — this one is additive, for the per-node action
 * cluster only.
 */
export function TopbarNodeActionsSlot() {
  const actions = useTopbarNodeActionsStore((state) => state.actions);
  if (!actions) {
    return null;
  }
  return <div className="flex shrink-0 items-center gap-1.5">{actions}</div>;
}
