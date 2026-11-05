"use client";

import { listNodeTypes } from "busabase-contract/domains";
import { ChevronDown, ChevronUp } from "lucide-react";
import { type ReactNode, useId, useMemo, useState } from "react";
import { fmt, useCoreI18n } from "../../../i18n";
import type { CoreI18nMessages } from "../../../i18n/messages";
import { nodeIconForId } from "../helpers/node-icons";

/**
 * "What lives in the sidebar": every creatable node type with the SAME icon the
 * sidebar draws for it (`nodeIconForId`, from the type's registry definition),
 * its translated name, the one-line "when would I pick this" hint the New
 * dialog uses, and a small drawing of what such a node looks like once opened.
 *
 * The point is recognition: a customer invited into a populated space sees a
 * sidebar full of icons they have never been taught. Generic stand-in icons
 * (the old card's Database/BookOpen glyphs) taught them nothing they could
 * match against that sidebar.
 *
 * The drawings are inline SVG in `currentColor` plus theme-token fills — no
 * images, no network, no hardcoded colors — so they work offline, self-hosted,
 * and in dark mode.
 */

type TypeCopyKey = keyof CoreI18nMessages["createNode"]["typeHints"];

/** Shown before "More types": what a newcomer meets first in a typical space. */
const FEATURED_TYPES = ["folder", "base", "doc", "airapp", "skill", "drive"];

const tourTypes = () => {
  const definitions = listNodeTypes().filter(
    (definition) => definition.capabilities.creatable && !definition.capabilities.hidden,
  );
  const rank = (type: string) => {
    const index = FEATURED_TYPES.indexOf(type);
    return index === -1 ? FEATURED_TYPES.length : index;
  };
  // Stable sort: featured first in their own order, the rest in registry order.
  return definitions
    .map((definition, index) => ({ definition, index }))
    .sort((a, b) => rank(a.definition.type) - rank(b.definition.type) || a.index - b.index)
    .map(({ definition }) => ({
      type: definition.type,
      Icon: nodeIconForId(definition.icon),
      featured: FEATURED_TYPES.includes(definition.type),
    }));
};

const frame = (children: ReactNode) => (
  <svg
    aria-hidden="true"
    className="h-10 w-14 shrink-0 rounded-md border border-border/60 bg-muted/40 text-muted-foreground"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="1.5"
    viewBox="0 0 56 40"
  >
    {children}
  </svg>
);

/** A tiny "what it looks like opened" drawing per type; unknown types get none. */
export function NodeTypePreview({ type }: { type: string }) {
  switch (type) {
    case "folder":
      return frame(
        <>
          <path d="M9 11h9l3 3h16" />
          <path className="opacity-60" d="M15 20h18M15 26h14M15 32h16" />
          <path d="M11 20h0M11 26h0M11 32h0" strokeWidth="2.5" />
        </>,
      );
    case "base":
      return frame(
        <>
          <rect className="fill-primary/15" height="7" stroke="none" width="38" x="9" y="8" />
          <rect height="24" rx="1.5" width="38" x="9" y="8" />
          <path className="opacity-60" d="M9 15h38M9 21h38M9 27h38M22 8v24M34 8v24" />
        </>,
      );
    case "doc":
      return frame(
        <>
          <path className="text-foreground" d="M12 11h20" strokeWidth="2.5" />
          <path className="opacity-60" d="M12 18h32M12 23h30M12 28h24" />
        </>,
      );
    case "file":
      return frame(
        <>
          <path d="M20 7h11l6 6v20H20z" />
          <path d="M31 7v6h6" />
          <rect
            className="fill-primary/20"
            height="6"
            rx="1"
            stroke="none"
            width="11"
            x="23"
            y="21"
          />
        </>,
      );
    case "skill":
      return frame(
        <>
          <path
            className="fill-primary/25 text-primary"
            d="M15 9l1.6 4.4L21 15l-4.4 1.6L15 21l-1.6-4.4L9 15l4.4-1.6z"
          />
          <path className="opacity-60" d="M26 12h20M26 17h16M10 26h36M10 31h28" />
        </>,
      );
    case "drive":
      return frame(
        <>
          <rect className="opacity-50" height="18" rx="1.5" width="14" x="12" y="9" />
          <rect className="fill-muted" height="18" rx="1.5" width="14" x="19" y="12" />
          <rect className="fill-muted" height="18" rx="1.5" width="14" x="26" y="15" />
        </>,
      );
    case "airapp":
      return frame(
        <>
          <rect height="26" rx="2" width="40" x="8" y="7" />
          <path d="M8 13h40" />
          <path d="M12 10h0M15 10h0M18 10h0" strokeWidth="2" />
          <rect
            className="fill-primary/20"
            height="7"
            rx="1.5"
            stroke="none"
            width="14"
            x="12"
            y="17"
          />
          <rect className="opacity-60" height="12" rx="1.5" width="14" x="30" y="17" />
          <path className="opacity-60" d="M12 28h14" />
        </>,
      );
    case "form":
      return frame(
        <>
          <path className="opacity-60" d="M12 9h12M12 19h10" />
          <rect height="5" rx="1" width="30" x="12" y="11.5" />
          <rect height="5" rx="1" width="30" x="12" y="21.5" />
          <rect
            className="fill-primary/25"
            height="4.5"
            rx="1"
            stroke="none"
            width="12"
            x="12"
            y="29"
          />
        </>,
      );
    case "whiteboard":
      return frame(
        <>
          <path d="M10 27c5-9 9 3 14-5s7-11 11-3" />
          <rect className="fill-primary/15" height="10" rx="1" width="10" x="36" y="9" />
          <circle className="opacity-60" cx="40" cy="28" r="4" />
        </>,
      );
    case "workflow":
      return frame(
        <>
          <rect height="8" rx="2" width="10" x="7" y="16" />
          <rect className="fill-primary/20" height="8" rx="2" width="10" x="23" y="8" />
          <rect height="8" rx="2" width="10" x="23" y="24" />
          <rect height="8" rx="2" width="10" x="39" y="16" />
          <path className="opacity-60" d="M17 20l6-8M17 20l6 8M33 12l6 8M33 28l6-8" />
        </>,
      );
    case "html":
      return frame(
        <>
          <rect height="26" rx="2" width="40" x="8" y="7" />
          <path d="M8 13h40" />
          <path className="text-primary" d="M23 19l-4 4 4 4M33 19l4 4-4 4M29 18l-2 10" />
        </>,
      );
    default:
      return null;
  }
}

/** The node-type tour shown inside Home's Getting started card. */
export function NodeTypeTour() {
  const messages = useCoreI18n();
  const listId = useId();
  const [showAll, setShowAll] = useState(false);
  const types = useMemo(tourTypes, []);
  const hiddenCount = types.filter((entry) => !entry.featured).length;
  const visible = showAll ? types : types.filter((entry) => entry.featured);

  return (
    <div className="mt-4 border-t pt-3" data-getting-started="node-types">
      <h4 className="font-medium text-muted-foreground text-xs">
        {messages.gettingStarted.typesHeading}
      </h4>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2" id={listId}>
        {visible.map(({ type, Icon }) => {
          const key = type as TypeCopyKey;
          const name = messages.nodeDetail[key] ?? messages.nodeDetail.item;
          const hint = messages.createNode.typeHints[key] ?? "";
          return (
            <li
              className="flex min-w-0 items-center gap-3 rounded-lg border border-border/60 bg-background p-2.5"
              data-node-type={type}
              key={type}
            >
              <NodeTypePreview type={type} />
              <div className="min-w-0">
                <span className="flex min-w-0 items-center gap-1.5 font-medium text-foreground text-sm">
                  <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{name}</span>
                </span>
                {hint ? (
                  <p className="mt-0.5 text-muted-foreground text-xs leading-5">{hint}</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {hiddenCount > 0 ? (
        <button
          aria-controls={listId}
          aria-expanded={showAll}
          className="mt-2 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-muted-foreground text-xs transition-colors hover:bg-accent/40 hover:text-foreground"
          onClick={() => setShowAll((value) => !value)}
          type="button"
        >
          {showAll ? (
            <ChevronUp aria-hidden="true" size={13} />
          ) : (
            <ChevronDown aria-hidden="true" size={13} />
          )}
          {showAll
            ? messages.createNode.fewerTypes
            : fmt(messages.createNode.moreTypes, { count: hiddenCount })}
        </button>
      ) : null}
    </div>
  );
}
