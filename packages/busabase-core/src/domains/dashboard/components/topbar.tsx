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
