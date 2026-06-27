"use client";

import type { LinkProps } from "wouter";
import { Link as WouterLink } from "wouter";
import { useAddDemoParam } from "./demo-client";

/**
 * SPALink - Wouter Link with Demo Mode integration
 *
 * A custom Link component for Wouter that:
 * - Automatically appends the active `?demo` param in demo mode, preserving its
 *   value (`?demo=1`, or a named use-case like `?demo=blog`)
 * - NProgress is handled globally by NProgressProvider
 *
 * Use this instead of wouter's Link in dashboard/SPA components.
 *
 * @example
 * ```tsx
 * // In demo mode, this will navigate to /tasks/123?demo=1
 * <SPALink href="/tasks/123">View Task</SPALink>
 * ```
 */
export function SPALink({ href, ...props }: LinkProps & { href: string }) {
  const addDemoParam = useAddDemoParam();

  return <WouterLink href={addDemoParam(href)} {...props} />;
}
