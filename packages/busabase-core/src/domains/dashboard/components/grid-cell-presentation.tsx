import { type CSSProperties, type ReactNode, useLayoutEffect, useRef, useState } from "react";
import {
  gridCollectionItemWidth,
  gridCollectionLayout,
  gridTextLines,
} from "../helpers/grid-cell-layout";

export function GridCellText({
  children,
  rowHeight,
  scalar = false,
  className = "",
}: {
  children: ReactNode;
  rowHeight: number;
  scalar?: boolean;
  className?: string;
}) {
  const lines = scalar ? 1 : gridTextLines(rowHeight);
  return (
    <span
      className={`min-w-0 max-w-full overflow-hidden ${scalar ? "truncate" : "whitespace-pre-wrap [overflow-wrap:anywhere]"} ${className}`}
      data-grid-cell-text
      data-grid-text-lines={lines}
      style={
        scalar
          ? undefined
          : ({
              display: "-webkit-box",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: lines,
              lineHeight: "20px",
              maxHeight: lines * 20,
            } satisfies CSSProperties)
      }
    >
      {children}
    </span>
  );
}

export interface GridCollectionItem {
  key: string;
  label: string;
  content: ReactNode;
  /** Avatar/icon room, in addition to the measured label. */
  extraWidth?: number;
}

export function GridCellCollection({
  items,
  rowHeight,
  renderOverflow,
}: {
  items: GridCollectionItem[];
  rowHeight: number;
  renderOverflow: (hidden: number) => ReactNode;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const update = () => setWidth(element.clientWidth);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // A zero-width pre-layout cell renders only its complete overflow action.
  const widths = items.map((item) => gridCollectionItemWidth(item.label, item.extraWidth));
  const layout = width
    ? gridCollectionLayout(width, rowHeight, widths)
    : { visible: 0, hidden: items.length, gap: 4 };
  return (
    <div
      className="flex w-full min-w-0 flex-wrap content-start items-center"
      data-grid-collection
      data-grid-collection-total={items.length}
      data-grid-collection-visible={layout.visible}
      ref={container}
      style={{ gap: layout.gap, maxHeight: rowHeight - 8 }}
    >
      {items.slice(0, layout.visible).map((item, index) => (
        <span
          className="inline-flex h-6 min-w-0 shrink-0 items-center overflow-hidden [&>*]:max-w-full"
          data-grid-collection-item
          key={item.key}
          style={{ maxWidth: "100%", width: Math.min(width, widths[index] ?? 0) }}
        >
          {item.content}
        </span>
      ))}
      {layout.hidden > 0 ? (
        <span
          className="inline-flex h-6 min-w-0 shrink-0 items-center"
          data-grid-collection-overflow
        >
          {renderOverflow(layout.hidden)}
        </span>
      ) : null}
    </div>
  );
}
