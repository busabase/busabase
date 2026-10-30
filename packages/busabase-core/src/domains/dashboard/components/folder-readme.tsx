import { useLayoutEffect, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import { useCoreI18n } from "../../../i18n";
import { markdownPreviewSource } from "../helpers/markdown-preview";
import { mdComponents } from "./field-preview";

// The collapsed height is `max-h-72` (18rem), the same point a long Markdown
// field folds at in a record, so the two surfaces fold alike.
const COLLAPSED_MAX_HEIGHT_PX = 288;

interface Props {
  body: string;
}

/**
 * A folder's optional readme, shown above its children. Read-only: the readme
 * is written through `PUT /nodes/{id}/content` (`kind: "folder"`), by an agent
 * or the API.
 *
 * Whether it folds is measured, not guessed from the text: one embedded image
 * is taller than a dozen lines of prose, and it only takes its height once it
 * has loaded — hence the ResizeObserver rather than a one-off check.
 */
export function FolderReadme({ body }: Props) {
  const messages = useCoreI18n();
  const contentRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const measure = () => setOverflows(content.scrollHeight > COLLAPSED_MAX_HEIGHT_PX + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  const collapsed = overflows && !expanded;
  return (
    <section
      aria-label={messages.nodeDetail.folderReadme}
      className="mb-6"
      data-testid="folder-readme"
    >
      <p className="mb-2 font-semibold text-[11px] uppercase tracking-widest text-muted-foreground/60">
        {messages.nodeDetail.folderReadme}
      </p>
      <div className="rounded-xl border bg-card px-5 py-4">
        <div
          className={
            collapsed
              ? "max-h-72 overflow-hidden [mask-image:linear-gradient(180deg,#000_72%,transparent)]"
              : undefined
          }
          data-collapsed={collapsed ? "true" : "false"}
        >
          <div
            className="min-w-0 break-words text-sm leading-7 [word-break:break-word] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
            ref={contentRef}
          >
            <Streamdown components={mdComponents}>{markdownPreviewSource(body)}</Streamdown>
          </div>
        </div>
        {overflows ? (
          <button
            aria-expanded={expanded}
            className="mt-2 text-primary text-xs underline-offset-2 hover:underline"
            onClick={() => setExpanded((current) => !current)}
            type="button"
          >
            {expanded
              ? messages.nodeDetail.folderReadmeShowLess
              : messages.nodeDetail.folderReadmeShowMore}
          </button>
        ) : null}
      </div>
    </section>
  );
}
