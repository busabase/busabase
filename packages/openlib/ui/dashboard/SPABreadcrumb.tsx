"use client";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "kui/breadcrumb";
import type { BreadcrumbState } from "./hooks/useSPABreadcrumb";

interface SPABreadcrumbProps {
  /** Root link href, e.g., "/dashboard", "/agents", "/systemadmin" */
  rootHref: string;
  /** Root link label, e.g., "Dashboard", "Agents", "System Admin" */
  rootLabel?: string;
  /** Breadcrumb state from useSPABreadcrumb hook */
  breadcrumb: BreadcrumbState;
  /** Whether to show root as a link (default: true) */
  showRoot?: boolean;
}

/**
 * Shared SPA breadcrumb component
 * Reduces boilerplate in spa-client files
 */
export function SPABreadcrumb({
  rootHref,
  rootLabel,
  breadcrumb,
  showRoot = true,
}: SPABreadcrumbProps) {
  const displayRootLabel = rootLabel || breadcrumb.parent || "Home";

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {showRoot && (
          <>
            <BreadcrumbItem className="hidden md:block">
              <BreadcrumbLink href={rootHref}>{displayRootLabel}</BreadcrumbLink>
            </BreadcrumbItem>
            {/* Show parent if different from root */}
            {breadcrumb.parent && breadcrumb.parent !== displayRootLabel && (
              <>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink href={rootHref}>{breadcrumb.parent}</BreadcrumbLink>
                </BreadcrumbItem>
              </>
            )}
            <BreadcrumbSeparator className="hidden md:block" />
          </>
        )}
        <BreadcrumbItem>
          <BreadcrumbPage>{breadcrumb.title}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}

/**
 * Breadcrumb for admin/systemadmin pages with parent based on route
 */
export function SystemAdminBreadcrumb({ breadcrumb }: { breadcrumb: BreadcrumbState }) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        {breadcrumb.parent && (
          <>
            <BreadcrumbItem className="hidden md:block">
              <BreadcrumbLink href="/systemadmin">{breadcrumb.parent}</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden md:block" />
          </>
        )}
        {breadcrumb.intermediate && (
          <>
            <BreadcrumbItem className="hidden md:block">
              <BreadcrumbLink href={breadcrumb.intermediate.href}>
                {breadcrumb.intermediate.label}
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden md:block" />
          </>
        )}
        <BreadcrumbItem>
          <BreadcrumbPage>{breadcrumb.title}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
