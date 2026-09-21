"use client";

import { useId } from "react";
import "./doc-reading.css";

export interface DocOutlineItem {
  id: string;
  level: number;
  text: string;
}

const MIN_TOC_HEADINGS = 3;

export function areDocOutlinesEqual(
  left: readonly DocOutlineItem[],
  right: readonly DocOutlineItem[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (item, index) =>
        item.id === right[index]?.id &&
        item.level === right[index]?.level &&
        item.text === right[index]?.text,
    )
  );
}

/** Keep a compact, navigable TOC: H1-H3 only, and only for documents with enough structure. */
export function selectDocTocItems(items: readonly DocOutlineItem[]): DocOutlineItem[] {
  const headings = items
    .map((item) => ({ ...item, text: item.text.trim() }))
    .filter((item) => item.id && item.text && item.level >= 1 && item.level <= 3);

  if (
    headings.length < MIN_TOC_HEADINGS ||
    !headings.some((heading) => heading.level === 2 || heading.level === 3)
  ) {
    return [];
  }
  return headings;
}

export function scrollToDocHeading(container: HTMLElement, headingId: string): boolean {
  const heading = Array.from(
    container.querySelectorAll<HTMLElement>("h1[id], h2[id], h3[id]"),
  ).find((candidate) => candidate.id === headingId);
  if (!heading) return false;

  const containerTop = container.getBoundingClientRect().top;
  const headingTop = heading.getBoundingClientRect().top;
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  container.scrollTo({
    top: Math.max(0, container.scrollTop + headingTop - containerTop - 24),
    behavior: reduceMotion ? "auto" : "smooth",
  });
  return true;
}

export function DocTableOfContents({
  activeId,
  items,
  label,
  onSelect,
}: {
  activeId: string | null;
  items: readonly DocOutlineItem[];
  label: string;
  onSelect: (headingId: string) => void;
}) {
  const labelId = useId();

  return (
    <nav aria-labelledby={labelId} className="doc-reading-toc">
      <h2 className="doc-reading-toc-heading" id={labelId}>
        {label}
      </h2>
      <ol className="doc-reading-toc-list">
        {items.map((item) => {
          const active = item.id === activeId;
          return (
            <li className="doc-reading-toc-list-item" key={item.id}>
              <button
                aria-current={active ? "location" : undefined}
                aria-label={item.text}
                className="doc-reading-toc-item"
                data-level={item.level}
                onClick={() => onSelect(item.id)}
                type="button"
              >
                <span aria-hidden="true" className="doc-reading-toc-label">
                  {item.text}
                </span>
                <span aria-hidden="true" className="doc-reading-toc-marker" />
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
