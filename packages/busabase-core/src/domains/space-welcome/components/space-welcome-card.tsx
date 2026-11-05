"use client";

import { ArrowUpRight, ChevronDown, ChevronUp, X } from "lucide-react";
import { SPALink } from "openlib/ui/dashboard";
import { useEffect, useId, useRef, useState } from "react";
import { useCoreI18n } from "../../../i18n";
import { usePreviewFullscreen } from "../../dashboard/components/preview-fullscreen";
import { nodeRoutePath } from "../../dashboard/helpers/known-node-cache";
import { useHrefWithCurrentSearch } from "../../dashboard/helpers/link-search";
import { NodeAvatar } from "../../dashboard/helpers/node-icons";
import { useWorkbenchLinkClickHandler } from "../../dashboard/workbench-link-context";
import { DocEditor } from "../../doc/components";
import { HtmlPreviewSurface } from "../../rich-node/components/html-detail-view";
import type { SpaceWelcomeDetail } from "../hooks/use-space-welcome";

/** Collapsed Doc height. Matches `max-h-80` below (20rem). */
const COLLAPSED_DOC_HEIGHT_PX = 320;

const noop = () => {};

/** A read-only Doc body, capped until the member asks for the rest. */
function WelcomeDoc({ body }: { body: string }) {
  const labels = useCoreI18n().spaceWelcome;
  const contentId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  // Same delegated link handling as the Doc page in reading mode: a link to
  // another node opens it inside the workbench instead of reloading the page.
  const handleWorkbenchLinkClick = useWorkbenchLinkClickHandler();

  // The measured block only exists while the page has content, so attach the
  // observer again when that flips (a refetch can turn an empty page into a
  // long one). Later growth — the editor mounting, images loading — is picked up
  // by the observer itself, so the height is watched rather than measured once.
  const hasBody = body.trim().length > 0;
  useEffect(() => {
    if (!hasBody) return;
    const content = contentRef.current;
    if (!content) return;
    const measure = () => setOverflowing(content.offsetHeight > COLLAPSED_DOC_HEIGHT_PX);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [hasBody]);

  if (!hasBody) {
    return <p className="px-4 py-4 text-muted-foreground text-sm">{labels.emptyDoc}</p>;
  }

  const collapsed = overflowing && !expanded;
  return (
    <div>
      <div
        className={collapsed ? "relative max-h-80 overflow-hidden" : "relative"}
        data-space-welcome-doc={collapsed ? "collapsed" : "expanded"}
        id={contentId}
      >
        {/* biome-ignore lint/a11y/noStaticElementInteractions: delegated clicks on the Doc's own links, as on the Doc page; Enter on a focused link dispatches the same click */}
        <div className="px-4 sm:px-6" onClick={handleWorkbenchLinkClick} ref={contentRef}>
          <DocEditor content={body} editable={false} onChange={noop} />
        </div>
        {collapsed ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-card to-transparent"
          />
        ) : null}
      </div>
      {overflowing ? (
        <div className="flex justify-center border-border/60 border-t px-4 py-1.5">
          <button
            aria-controls={contentId}
            aria-expanded={expanded}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium text-muted-foreground text-xs transition-colors hover:bg-accent/40 hover:text-foreground"
            onClick={() => setExpanded((value) => !value)}
            type="button"
          >
            {expanded ? (
              <ChevronUp aria-hidden="true" size={13} />
            ) : (
              <ChevronDown aria-hidden="true" size={13} />
            )}
            {expanded ? labels.collapse : labels.expand}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** The HTML page in the same sandboxed frame the HTML node uses, at a fixed height. */
function WelcomeHtml({ detail }: { detail: Extract<SpaceWelcomeDetail, { type: "html" }> }) {
  const fullscreenState = usePreviewFullscreen();
  return (
    <div className="h-[28rem]" data-space-welcome-html="">
      <HtmlPreviewSurface
        fullscreenState={fullscreenState}
        node={detail.node}
        source={detail.document.source}
      />
    </div>
  );
}

/**
 * Home's top card when the space has a welcome page this member can read.
 * Read-only: editing happens on the node itself, one "Open" away.
 */
export function SpaceWelcomeCard({
  detail,
  onClose,
}: {
  detail: SpaceWelcomeDetail;
  onClose: () => void;
}) {
  const labels = useCoreI18n().spaceWelcome;
  const titleId = useId();
  const { node } = detail;
  const href = useHrefWithCurrentSearch(nodeRoutePath(node.type, node.slug));

  return (
    <section
      aria-labelledby={titleId}
      className="min-w-0 overflow-hidden rounded-lg border border-border/60 bg-card"
      data-home-section="welcome"
    >
      <header className="flex min-w-0 items-center gap-2 border-border/60 border-b px-3 py-2">
        <span
          aria-hidden="true"
          className="flex size-4 shrink-0 items-center justify-center overflow-hidden text-muted-foreground"
        >
          <NodeAvatar node={node} />
        </span>
        <h2 className="min-w-0 flex-1 truncate font-medium text-sm" id={titleId}>
          {node.name}
        </h2>
        <SPALink
          className="inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-0.5 font-medium text-muted-foreground text-xs transition-colors hover:bg-accent/40 hover:text-foreground"
          href={href}
        >
          {labels.open}
          <ArrowUpRight aria-hidden="true" size={13} />
        </SPALink>
        <button
          aria-label={labels.close}
          className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
          onClick={onClose}
          title={labels.close}
          type="button"
        >
          <X aria-hidden="true" size={14} />
        </button>
      </header>
      {detail.type === "doc" ? <WelcomeDoc body={detail.body} /> : <WelcomeHtml detail={detail} />}
    </section>
  );
}
