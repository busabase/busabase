"use client";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "kui/breadcrumb";
import { Fragment } from "react";
import { useAddDemoParam } from "./demo-client";
import type { BreadcrumbCrumb, BreadcrumbState } from "./hooks/useSPABreadcrumb";

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
 *
 * The crumbs are plain anchors (full page loads), so they carry `?demo`
 * explicitly — otherwise clicking "Dashboard" in demo mode lands an anonymous
 * visitor on the sign-in page.
 *
 * When `breadcrumb.crumbs` is set it is the whole trail (Workspace, ancestor
 * folders, the open node). Otherwise the older parent / intermediate / title
 * shape is used for routes that are not a node, such as Search and Home.
 */
export function SPABreadcrumb(props: SPABreadcrumbProps) {
  if (props.breadcrumb.crumbs && props.breadcrumb.crumbs.length > 0) {
    return <CrumbTrail crumbs={props.breadcrumb.crumbs} />;
  }
  return <LegacySPABreadcrumb {...props} />;
}

function LegacySPABreadcrumb({
  rootHref,
  rootLabel,
  breadcrumb,
  showRoot = true,
}: SPABreadcrumbProps) {
  const addDemoParam = useAddDemoParam();
  const displayRootLabel = rootLabel || breadcrumb.parent || "Home";

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {showRoot && (
          <>
            <BreadcrumbItem className="hidden md:block">
              <BreadcrumbLink href={addDemoParam(rootHref)}>{displayRootLabel}</BreadcrumbLink>
            </BreadcrumbItem>
            {/* Show parent if different from root */}
            {breadcrumb.parent && breadcrumb.parent !== displayRootLabel && (
              <>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink href={addDemoParam(rootHref)}>{breadcrumb.parent}</BreadcrumbLink>
                </BreadcrumbItem>
              </>
            )}
            <BreadcrumbSeparator className="hidden md:block" />
          </>
        )}
        <BreadcrumbItem className="min-w-0">
          <BreadcrumbPage
            className="block max-w-[12rem] truncate sm:max-w-xs"
            title={breadcrumb.title}
          >
            {breadcrumb.title}
          </BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}

/**
 * Breadcrumb for admin/systemadmin pages with parent based on route
 */
export function SystemAdminBreadcrumb({ breadcrumb }: { breadcrumb: BreadcrumbState }) {
  if (breadcrumb.crumbs && breadcrumb.crumbs.length > 0) {
    return <CrumbTrail crumbs={breadcrumb.crumbs} />;
  }
  return <LegacySystemAdminBreadcrumb breadcrumb={breadcrumb} />;
}

function LegacySystemAdminBreadcrumb({ breadcrumb }: { breadcrumb: BreadcrumbState }) {
  const addDemoParam = useAddDemoParam();
  return (
    <Breadcrumb>
      <BreadcrumbList>
        {breadcrumb.parent && (
          <>
            <BreadcrumbItem className="hidden md:block">
              <BreadcrumbLink href={addDemoParam("/systemadmin")}>
                {breadcrumb.parent}
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden md:block" />
          </>
        )}
        {breadcrumb.intermediate && (
          <>
            <BreadcrumbItem className="hidden md:block">
              <BreadcrumbLink href={addDemoParam(breadcrumb.intermediate.href)}>
                {breadcrumb.intermediate.label}
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden md:block" />
          </>
        )}
        <BreadcrumbItem className="min-w-0">
          <BreadcrumbPage
            className="block max-w-[12rem] truncate sm:max-w-xs"
            title={breadcrumb.title}
          >
            {breadcrumb.title}
          </BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}

/**
 * Ordered trail. The last crumb is the current page; earlier crumbs with an
 * href are links. Each name is left whole — the visible text ellipsizes, and
 * `title` still has the full name.
 */
function CrumbTrail({ crumbs }: { crumbs: BreadcrumbCrumb[] }) {
  const addDemoParam = useAddDemoParam();
  return (
    <Breadcrumb>
      <BreadcrumbList className="flex-nowrap overflow-hidden">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            <Fragment key={`${crumb.label}-${index}`}>
              {index > 0 ? <BreadcrumbSeparator /> : null}
              <BreadcrumbItem className="min-w-0">
                {!isLast && crumb.href ? (
                  <BreadcrumbLink
                    className="block max-w-[9rem] truncate sm:max-w-xs"
                    href={addDemoParam(crumb.href)}
                    title={crumb.label}
                  >
                    {crumb.label}
                  </BreadcrumbLink>
                ) : (
                  <BreadcrumbPage
                    className="block max-w-[9rem] truncate sm:max-w-xs"
                    title={crumb.label}
                  >
                    {crumb.label}
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
