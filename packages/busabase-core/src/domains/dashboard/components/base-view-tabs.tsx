import type { Announcements, DragEndEvent, Modifier, UniqueIdentifier } from "@dnd-kit/core";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { BaseVO, ViewType, ViewVO } from "busabase-contract/types";
import { useReducedMotion } from "framer-motion";
import { CalendarDays, Columns3, GanttChart, LayoutGrid, Table2 } from "lucide-react";
import { SPALink as Link } from "openlib/ui/dashboard";
import { useEffect, useRef, useState } from "react";
import { fmt, useCoreI18n } from "../../../i18n";
import { mergeSearchIntoHref } from "../helpers/link-search";
import { ACTIVE_VIEW_CONTROL_CLASS_NAME } from "./view-control-styles";

// Per-view-type tab glyph (kept in one place so tabs and the type picker agree).
export function ViewTypeIcon({ type }: { type: ViewType }) {
  const className = "shrink-0 opacity-70";
  if (type === "gallery") {
    return <LayoutGrid className={className} size={12} />;
  }
  if (type === "kanban") {
    return <Columns3 className={className} size={12} />;
  }
  if (type === "calendar") {
    return <CalendarDays className={className} size={12} />;
  }
  if (type === "gantt") {
    return <GanttChart className={className} size={12} />;
  }
  return <Table2 className={className} size={12} />;
}

const TAB_CLASS_NAME =
  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 font-medium text-xs transition-colors";
const INACTIVE_TAB_CLASS_NAME =
  "border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground";

// Tabs only slide sideways; a vertical wobble while dragging reads as a bug.
const restrictToHorizontalAxis: Modifier = ({ transform }) => ({ ...transform, y: 0 });

/** How long a drop that produced no click keeps swallowing the next click. */
const DROP_CLICK_GUARD_FALLBACK_MS = 400;

interface DropClickGuard {
  onClick: (event: globalThis.MouseEvent) => void;
  timer?: ReturnType<typeof setTimeout>;
}

const disarmDropClickGuard = (ref: { current: DropClickGuard | null }) => {
  const guard = ref.current;
  if (!guard) return;
  window.removeEventListener("click", guard.onClick, { capture: true });
  clearTimeout(guard.timer);
  ref.current = null;
};

/**
 * Cancel the click a drop produces. The mouseup that ends a drag also clicks
 * the dragged tab, a few ms later as its own task. dnd-kit stops that click's
 * propagation from a capture listener on `document`, so React (and wouter's
 * Link, which would have prevented the default and navigated in-app) never
 * sees it — but nothing cancelled its default action, so the browser followed
 * the tab's href as a full page load. A capture listener on `window` runs
 * before dnd-kit's, and only cancels the default.
 */
const armDropClickGuard = (ref: { current: DropClickGuard | null }) => {
  disarmDropClickGuard(ref);
  const guard: DropClickGuard = {
    onClick: (event) => {
      event.preventDefault();
      disarmDropClickGuard(ref);
    },
  };
  window.addEventListener("click", guard.onClick, { capture: true });
  ref.current = guard;
};

interface Props {
  activeViewId: string | null;
  base: BaseVO;
  /** Writers may drag tabs to change the Base's shared view order. */
  canReorder: boolean;
  currentSearch: string;
  /** `position` is the 0-based target index among the Base's views. */
  onReorder?: (view: ViewVO, position: number) => void;
  /** Already in display (position) order. */
  views: ViewVO[];
}

interface ViewTabProps {
  active: boolean;
  href: string;
  view: ViewVO;
}

function StaticViewTab({ active, href, view }: ViewTabProps) {
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={`${TAB_CLASS_NAME} ${active ? ACTIVE_VIEW_CONTROL_CLASS_NAME : INACTIVE_TAB_CLASS_NAME}`}
      data-view-slug={view.slug}
      href={href}
    >
      <ViewTypeIcon type={view.type} />
      {view.name}
    </Link>
  );
}

function SortableViewTab({ active, href, view }: ViewTabProps) {
  const reduceMotion = useReducedMotion();
  const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({
    id: view.id,
  });
  return (
    // `asChild` so the sortable node IS the tab's <a> (SPALink cannot take a
    // ref, and a wrapper element would change the tab strip's structure).
    <Link asChild href={href}>
      <a
        // Only the accessibility description of `attributes`: the tab stays a
        // link (its own role and tab stop), dnd-kit just announces how to move it.
        aria-current={active ? "page" : undefined}
        aria-describedby={attributes["aria-describedby"]}
        aria-roledescription={attributes["aria-roledescription"]}
        className={`${TAB_CLASS_NAME} touch-manipulation ${
          active ? ACTIVE_VIEW_CONTROL_CLASS_NAME : INACTIVE_TAB_CLASS_NAME
        } ${isDragging ? "relative z-10 opacity-80" : ""}`}
        data-dragging={isDragging ? "true" : undefined}
        data-view-slug={view.slug}
        href={href}
        ref={setNodeRef}
        style={{
          transform: CSS.Translate.toString(transform),
          transition: reduceMotion ? undefined : transition,
        }}
        {...listeners}
      >
        <ViewTypeIcon type={view.type} />
        {view.name}
      </a>
    </Link>
  );
}

/**
 * The Base's view tabs, left to right in their shared order — the leftmost is
 * the view the Base opens on. Writers can drag a tab (mouse, touch, or Space +
 * arrow keys) to reorder; a plain click still just opens the view.
 */
export function BaseViewTabs({
  activeViewId,
  base,
  canReorder,
  currentSearch,
  onReorder,
  views,
}: Props) {
  const messages = useCoreI18n();
  const dropClickGuardRef = useRef<DropClickGuard | null>(null);
  useEffect(() => () => disarmDropClickGuard(dropClickGuardRef), []);
  // dnd-kit renders its screen-reader instructions + live region next to the
  // sortable items unless given a container; inside the tab strip they would
  // be extra children of the nav. They only mount client-side anyway.
  const [a11yContainer, setA11yContainer] = useState<HTMLElement>();
  useEffect(() => {
    setA11yContainer(document.body);
  }, []);
  const sensors = useSensors(
    // A click (no movement) must still navigate, so a drag only starts after 8px.
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    // Space only: Enter on a tab is the link's own "open this view".
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] },
    }),
  );
  const hrefFor = (view: ViewVO) =>
    mergeSearchIntoHref(`/base/${base.slug}/${view.slug}`, currentSearch);

  if (!canReorder || !onReorder || views.length < 2) {
    return (
      <>
        {views.map((view) => (
          <StaticViewTab
            active={view.id === activeViewId}
            href={hrefFor(view)}
            key={view.id}
            view={view}
          />
        ))}
      </>
    );
  }

  const ids = views.map((view) => view.id);
  const getName = (id: UniqueIdentifier) =>
    views.find((view) => view.id === String(id))?.name ?? String(id);
  const getPosition = (id: UniqueIdentifier) => ids.indexOf(String(id)) + 1;
  const announcements: Announcements = {
    onDragStart({ active }) {
      return fmt(messages.base.viewFieldDragStarted, {
        count: views.length,
        name: getName(active.id),
        position: getPosition(active.id),
      });
    },
    onDragOver({ active, over }) {
      if (!over) return messages.base.viewTabDragOutside;
      return fmt(messages.base.viewFieldDragMoved, {
        count: views.length,
        name: getName(active.id),
        position: getPosition(over.id),
      });
    },
    onDragEnd({ active, over }) {
      if (!over) {
        return fmt(messages.base.viewFieldDragCancelled, { name: getName(active.id) });
      }
      return fmt(messages.base.viewFieldDragDropped, {
        count: views.length,
        name: getName(active.id),
        position: getPosition(over.id),
      });
    },
    onDragCancel({ active }) {
      return fmt(messages.base.viewFieldDragCancelled, { name: getName(active.id) });
    },
  };

  const releaseDropClickGuard = () => {
    // Most drops are followed by a click the guard consumes; this only covers
    // drops that produce none (released off the tab, or ended from the keyboard).
    const guard = dropClickGuardRef.current;
    if (!guard) return;
    clearTimeout(guard.timer);
    guard.timer = setTimeout(
      () => disarmDropClickGuard(dropClickGuardRef),
      DROP_CLICK_GUARD_FALLBACK_MS,
    );
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    releaseDropClickGuard();
    if (!over || active.id === over.id) return;
    const view = views.find((candidate) => candidate.id === String(active.id));
    const targetIndex = ids.indexOf(String(over.id));
    if (!view || targetIndex < 0) return;
    onReorder(view, targetIndex);
  };

  return (
    <DndContext
      accessibility={{
        announcements,
        container: a11yContainer,
        screenReaderInstructions: { draggable: messages.base.viewTabDragInstructions },
      }}
      collisionDetection={closestCenter}
      modifiers={[restrictToHorizontalAxis]}
      onDragCancel={releaseDropClickGuard}
      onDragEnd={handleDragEnd}
      onDragStart={() => armDropClickGuard(dropClickGuardRef)}
      sensors={sensors}
    >
      <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
        {views.map((view) => (
          <SortableViewTab
            active={view.id === activeViewId}
            href={hrefFor(view)}
            key={view.id}
            view={view}
          />
        ))}
      </SortableContext>
    </DndContext>
  );
}
