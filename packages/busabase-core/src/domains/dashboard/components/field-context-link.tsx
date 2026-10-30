import { useAddDemoParam } from "openlib/ui/dashboard";
import type { ComponentProps } from "react";
import { Link } from "wouter";

/** These hrefs already contain the full context, including removed transient keys. */
export function FieldContextLink(props: ComponentProps<typeof Link> & { href: string }) {
  const addDemoParam = useAddDemoParam();
  return <Link {...props} href={addDemoParam(props.href)} />;
}
