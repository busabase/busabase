import { hasCapability } from "busabase-contract/domains";
import type { PlaybookAttributionVO } from "busabase-contract/types";
import { BookOpen } from "lucide-react";
import { SPALink as Link } from "openlib/ui/dashboard";
import { fmt, useCoreI18n } from "../../../i18n";

/**
 * Dashboard route of the node that carries a playbook — the skill node itself,
 * or for a prompt the node the prompt is defined on. Same rule as the sidebar's
 * `nodeHref`: Bases route by their own slug, other types only when they have a
 * detail screen. Null when the reader cannot see the node or it has no screen.
 */
export const getPlaybookHref = (playbook: PlaybookAttributionVO): string | null => {
  if (!playbook.accessible || !playbook.nodeType || !playbook.nodeSlug) return null;
  if (playbook.nodeType === "base") return `/base/${playbook.nodeSlug}`;
  return hasCapability(playbook.nodeType, "hasDetail")
    ? `/${playbook.nodeType}/${playbook.nodeSlug}`
    : null;
};

/**
 * "via playbook {label}" — which playbook (skill or custom prompt) an agent
 * followed when it produced a change request (spec agent-playbook-discovery
 * §11b H1). A reader who cannot read the playbook node gets "via a playbook"
 * with no name and no link. Renders nothing when no playbook was recorded.
 *
 * `linked={false}` renders plain text — for places already inside a link (the
 * inbox row is itself an `<a>`, and an `<a>` inside an `<a>` is invalid).
 */
export function PlaybookChip({
  className = "",
  linked = true,
  playbook,
}: {
  className?: string;
  linked?: boolean;
  playbook: PlaybookAttributionVO | null | undefined;
}) {
  const messages = useCoreI18n();
  if (!playbook) return null;

  const label = playbook.accessible ? playbook.label?.trim() || null : null;
  const text = label
    ? fmt(messages.activity.viaPlaybookNamed, { label })
    : messages.activity.viaPlaybookHidden;
  const href = label && linked ? getPlaybookHref(playbook) : null;
  const content = (
    <>
      <BookOpen aria-hidden="true" className="size-3 shrink-0" strokeWidth={2} />
      <span className="min-w-0 truncate">{text}</span>
    </>
  );
  const shared = `inline-flex min-w-0 max-w-full items-center gap-1 ${className}`;

  return href ? (
    <Link
      className={`${shared} text-primary transition-colors hover:underline`}
      data-playbook-kind={playbook.kind}
      data-testid="playbook-chip"
      href={href}
      title={messages.activity.playbookChipTitle}
    >
      {content}
    </Link>
  ) : (
    <span
      className={shared}
      data-playbook-kind={playbook.kind}
      data-testid="playbook-chip"
      title={messages.activity.playbookChipTitle}
    >
      {content}
    </span>
  );
}
