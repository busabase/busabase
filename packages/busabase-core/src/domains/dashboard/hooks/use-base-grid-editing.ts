"use client";

import type { BaseFieldVO, RecordVO } from "busabase-contract/types";
import {
  type KeyboardEvent,
  type MutableRefObject,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { normalizeEditorFieldValue } from "../helpers/field";
import {
  canEditCellValueInline,
  getInlineCellEditorKind,
  type InlineCellDraftError,
  isSameInlineCellValue,
  parseInlineCellDraft,
  toInlineCellDraft,
} from "../helpers/inline-cell-edit";

/**
 * What the host's write returned: merged now (the record's new head commit), or
 * queued as a pending change request because the viewer may only propose.
 */
export type RecordCellUpdateResult =
  | { materialized: true; headCommitId: string }
  | { materialized: false; changeRequestId: string };

/**
 * One cell → one partial record update, through the record edit form's write
 * path. `mergeImmediately` is the record form's choice too: merge now (when
 * the viewer may), or file a Change Request for review.
 */
export type UpdateRecordCell = (
  record: RecordVO,
  fieldSlug: string,
  value: unknown,
  options: { baseCommitId: string; mergeImmediately: boolean },
) => Promise<RecordCellUpdateResult>;

export interface GridCellPosition {
  recordId: string;
  fieldSlug: string;
}

export interface GridEditingSession extends GridCellPosition {
  /** The character that started the edit (type-to-edit), or null for Enter / double-click. */
  seed: string | null;
  /** Bumps on every new session so an editor never reuses a previous session's state. */
  session: number;
  /**
   * The head commit the editor opened on. The write is pinned to it — exactly
   * like the record edit form — so someone else's concurrent change to the SAME
   * field is refused by name instead of being silently overwritten, while a
   * change to a different field still merges.
   */
  baseHead: string;
}

export type GridNotice =
  | {
      kind: "pending";
      changeRequestId: string;
      fieldName: string;
      /** The viewer could merge but chose to save a Change Request instead. */
      requested: boolean;
    }
  | { kind: "error"; fieldName: string; message: string }
  | { kind: "readOnly"; fieldName: string };

export interface GridCellStatus {
  saving: boolean;
  pending: { changeRequestId: string; proposedValue: unknown } | null;
  error: string | null;
}

export type GridMove = "stay" | "next" | "previous" | "none";

interface CellOverlay {
  value: unknown;
  status: "saving" | "saved";
  /** The head the grid was showing when the edit was committed. */
  fromHead: string;
  /** The head the merge produced (once saved). */
  toHead?: string;
  seq: number;
}

interface CellPending {
  changeRequestId: string;
  proposedValue: unknown;
  fromHead: string;
}

interface RejectedCellDraft {
  value: string;
  baseHead: string;
  error: InlineCellDraftError;
}

export const gridCellKey = (recordId: string, fieldSlug: string) => `${recordId}::${fieldSlug}`;

/**
 * Scroll the grid sideways so a newly active cell is fully visible: not tucked
 * under the frozen first column (the browser's own focus scrolling ignores
 * sticky overlap) and not cut off at the right edge.
 */
const revealCell = (element: HTMLElement) => {
  const scroller = element.closest<HTMLElement>("[data-base-table-scroll]");
  const row = element.closest<HTMLElement>('[role="row"]');
  if (!scroller || !row || getComputedStyle(element).position === "sticky") return;
  const box = scroller.getBoundingClientRect();
  let frozenRight = box.left;
  for (const sibling of Array.from(row.children)) {
    if (sibling !== element && getComputedStyle(sibling).position === "sticky") {
      frozenRight = Math.max(frozenRight, sibling.getBoundingClientRect().right);
    }
  }
  const rect = element.getBoundingClientRect();
  if (rect.left < frozenRight) {
    scroller.scrollLeft -= frozenRight - rect.left;
  } else if (rect.right > box.right) {
    scroller.scrollLeft += Math.min(rect.right - box.right, rect.left - frozenRight);
  }
};

/** Keys a grid cell handles itself; every other key is left to the browser. */
const isPrintableKey = (event: KeyboardEvent) =>
  event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;

/**
 * State and keyboard model for editing Base records in place, following the
 * spreadsheet conventions people already know from Airtable/Notion: one active
 * cell (a single tab stop), arrows/Tab move it, Enter / F2 / double-click /
 * typing edit it, Enter or blur saves, Esc cancels, Space opens the record.
 * Enter, blur and a pick save with the main submit action (merge now when the
 * viewer may write, otherwise a Change Request); the editor's submit control
 * can pick the other one explicitly.
 *
 * Writes are optimistic and safe under live refresh:
 * - the edited value shows at once (an overlay) and is rolled back on failure;
 * - a queued (proposal-only) edit is NOT shown as saved — the cell keeps the
 *   current value and says the change is waiting for review;
 * - edits to one record are sent one after another. Only repeat edits of the
 *   same cell follow our own produced heads; other fields keep the version
 *   they opened on so a concurrent change to them still conflicts.
 */
export function useBaseGridEditing({
  canMerge,
  canEditField,
  enabled,
  ensureRowVisible,
  fields,
  formatSaveError,
  gridRef,
  onOpenRecord,
  onUpdateRecordCell,
  proposalScope,
  records,
  resolveFieldName,
}: {
  /** The viewer may write this Base, so the main submit action merges at once. */
  canMerge: boolean;
  /** Some field kinds need a host capability in addition to a record write. */
  canEditField?: (field: BaseFieldVO) => boolean;
  enabled: boolean;
  ensureRowVisible: (rowIndex: number) => void;
  fields: BaseFieldVO[];
  formatSaveError: (error: unknown) => string;
  gridRef: RefObject<HTMLElement | null>;
  onOpenRecord: (record: RecordVO) => void;
  onUpdateRecordCell?: UpdateRecordCell;
  /** Local proposal markers belong to one exact collection query, not the persistent grid. */
  proposalScope?: string;
  records: RecordVO[];
  resolveFieldName: (field: BaseFieldVO) => string;
}) {
  const [active, setActive] = useState<GridCellPosition | null>(null);
  const [editing, setEditingState] = useState<GridEditingSession | null>(null);
  // Mirrors `editing` synchronously, so keys typed before the editor has
  // rendered (a fast "129") extend the same draft instead of restarting it.
  const editingRef = useRef<GridEditingSession | null>(null);
  const setEditing = useCallback((next: GridEditingSession | null) => {
    editingRef.current = next;
    setEditingState(next);
  }, []);
  const [editError, setEditError] = useState<InlineCellDraftError | null>(null);
  const [overlays, setOverlays] = useState<Record<string, CellOverlay>>({});
  const [pending, setPending] = useState<Record<string, CellPending>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<GridNotice | null>(null);
  /** Live draft text, kept outside render state so a remounted editor resumes it. */
  const draftRef: MutableRefObject<{ key: string; value: string } | null> = useRef(null);
  const rejectedDrafts = useRef(new Map<string, RejectedCellDraft>());
  const sessionCounter = useRef(0);
  const overlaySeq = useRef(0);
  const recordsRef = useRef(records);
  recordsRef.current = records;
  /** Own merges per cell: another field's merge may contain a concurrent change to this one. */
  const successors = useRef(new Map<string, Map<string, string>>());
  const ownHeads = useRef(new Map<string, number>());
  const chains = useRef(new Map<string, Promise<void>>());
  const proposalContext = useRef({ scope: proposalScope, generation: 0 });
  if (proposalContext.current.scope !== proposalScope) {
    proposalContext.current = {
      scope: proposalScope,
      generation: proposalContext.current.generation + 1,
    };
    // These markers are local feedback, not authoritative CR status. Paging or
    // finding again must not revive a proposal another reviewer already closed.
    setPending({});
    setNotice((current) => (current?.kind === "pending" ? null : current));
  }

  const fieldBySlug = useMemo(() => new Map(fields.map((field) => [field.slug, field])), [fields]);

  const isEditableCell = useCallback(
    (record: RecordVO, field: BaseFieldVO) =>
      enabled &&
      record.status === "active" &&
      (canEditField?.(field) ?? true) &&
      canEditCellValueInline(field, record.headCommit.payload[field.slug]),
    [canEditField, enabled],
  );

  const overlayIsCurrent = useCallback((record: RecordVO, overlay: CellOverlay | undefined) => {
    if (!overlay) return false;
    if (overlay.status === "saving") return true;
    const head = record.headCommitId;
    if (head === overlay.toHead) return false;
    const ownHeadSeq = ownHeads.current.get(head);
    return head === overlay.fromHead || (ownHeadSeq !== undefined && ownHeadSeq < overlay.seq);
  }, []);

  const getDisplayValue = useCallback(
    (record: RecordVO, field: BaseFieldVO): unknown => {
      const overlay = overlays[gridCellKey(record.id, field.slug)];
      return overlayIsCurrent(record, overlay)
        ? overlay?.value
        : record.headCommit.payload[field.slug];
    },
    [overlayIsCurrent, overlays],
  );

  const getCellStatus = useCallback(
    (record: RecordVO, field: BaseFieldVO): GridCellStatus => {
      const key = gridCellKey(record.id, field.slug);
      const overlay = overlays[key];
      const queued = pending[key];
      const queuedVisible =
        queued &&
        (record.headCommitId === queued.fromHead || ownHeads.current.has(record.headCommitId));
      return {
        saving: overlay?.status === "saving",
        pending: queuedVisible
          ? { changeRequestId: queued.changeRequestId, proposedValue: queued.proposedValue }
          : null,
        error: errors[key] ?? null,
      };
    },
    [errors, overlays, pending],
  );

  // Drop overlays the refreshed records have caught up with.
  useEffect(() => {
    setOverlays((current) => {
      const byId = new Map(records.map((record) => [record.id, record]));
      let changed = false;
      const next: Record<string, CellOverlay> = {};
      for (const [key, overlay] of Object.entries(current)) {
        const record = byId.get(key.split("::")[0] ?? "");
        if (record && !overlayIsCurrent(record, overlay)) {
          changed = true;
          continue;
        }
        next[key] = overlay;
      }
      return changed ? next : current;
    });
  }, [overlayIsCurrent, records]);

  const findCellElement = useCallback(
    (position: GridCellPosition) => {
      const key = gridCellKey(position.recordId, position.fieldSlug);
      const cells = gridRef.current?.querySelectorAll<HTMLElement>("[data-grid-cell]") ?? [];
      for (const cell of cells) {
        if (cell.dataset.gridCell === key) return cell;
      }
      return null;
    },
    [gridRef],
  );

  /** Move DOM focus to a cell; its focus handler makes it the active cell. */
  const focusCell = useCallback(
    (position: GridCellPosition) => {
      const rowIndex = recordsRef.current.findIndex((record) => record.id === position.recordId);
      if (rowIndex >= 0) ensureRowVisible(rowIndex);
      setActive(position);
      let attempts = 0;
      const tryFocus = () => {
        const element = findCellElement(position);
        if (element) {
          element.focus();
          return;
        }
        // A virtualized row is mounted on the next frame(s) after scrolling to it.
        if (attempts++ < 6) requestAnimationFrame(tryFocus);
      };
      tryFocus();
    },
    [ensureRowVisible, findCellElement],
  );

  const activate = useCallback((position: GridCellPosition, element?: HTMLElement) => {
    if (element) revealCell(element);
    setActive((current) =>
      current?.recordId === position.recordId && current.fieldSlug === position.fieldSlug
        ? current
        : position,
    );
    setNotice((current) => (current?.kind === "readOnly" ? null : current));
  }, []);

  const neighbour = useCallback(
    (position: GridCellPosition, rowDelta: number, columnDelta: number) => {
      const rowIndex = recordsRef.current.findIndex((record) => record.id === position.recordId);
      const columnIndex = fields.findIndex((field) => field.slug === position.fieldSlug);
      if (rowIndex < 0 || columnIndex < 0) return null;
      const nextRow = rowIndex + rowDelta;
      const nextColumn = columnIndex + columnDelta;
      const record = recordsRef.current[nextRow];
      const field = fields[nextColumn];
      if (!record || !field) return null;
      return { recordId: record.id, fieldSlug: field.slug };
    },
    [fields],
  );

  const startEditing = useCallback(
    (record: RecordVO, field: BaseFieldVO, seed: string | null = null) => {
      const key = gridCellKey(record.id, field.slug);
      const current = editingRef.current;
      if (
        seed !== null &&
        current?.recordId === record.id &&
        current.fieldSlug === field.slug &&
        draftRef.current?.key === key
      ) {
        draftRef.current = { key, value: `${draftRef.current.value}${seed}` };
        return;
      }
      const restored = seed === null ? rejectedDrafts.current.get(key) : undefined;
      if (seed !== null) rejectedDrafts.current.delete(key);
      sessionCounter.current += 1;
      draftRef.current = {
        key,
        value: seed ?? restored?.value ?? toInlineCellDraft(field, getDisplayValue(record, field)),
      };
      setEditError(restored?.error ?? null);
      setActive({ recordId: record.id, fieldSlug: field.slug });
      setEditing({
        recordId: record.id,
        fieldSlug: field.slug,
        seed,
        session: sessionCounter.current,
        baseHead: restored?.baseHead ?? record.headCommitId,
      });
    },
    [getDisplayValue, setEditing],
  );

  const finishEditing = useCallback(
    (position: GridCellPosition, move: GridMove) => {
      rejectedDrafts.current.delete(gridCellKey(position.recordId, position.fieldSlug));
      draftRef.current = null;
      setEditError(null);
      setEditing(null);
      if (move === "none") return;
      const target =
        move === "next"
          ? (neighbour(position, 0, 1) ?? position)
          : move === "previous"
            ? (neighbour(position, 0, -1) ?? position)
            : position;
      // After React has swapped the editor back for the value.
      requestAnimationFrame(() => focusCell(target));
    },
    [focusCell, neighbour, setEditing],
  );

  const cancelEditing = useCallback(
    (move: GridMove = "stay") => {
      if (!editing) return;
      finishEditing(editing, move);
    },
    [editing, finishEditing],
  );

  const save = useCallback(
    (
      record: RecordVO,
      field: BaseFieldVO,
      value: unknown,
      baseHead?: string,
      mergeImmediately = canMerge,
    ) => {
      if (!onUpdateRecordCell) return;
      const proposalGeneration = proposalContext.current.generation;
      const key = gridCellKey(record.id, field.slug);
      overlaySeq.current += 1;
      const seq = overlaySeq.current;
      const fieldName = resolveFieldName(field);
      setOverlays((current) => ({
        ...current,
        [key]: { value, status: "saving", fromHead: record.headCommitId, seq },
      }));
      setErrors((current) => {
        if (!(key in current)) return current;
        const { [key]: _dropped, ...rest } = current;
        return rest;
      });
      setPending((current) => {
        if (!(key in current)) return current;
        const { [key]: _dropped, ...rest } = current;
        return rest;
      });
      const dropOverlay = () =>
        setOverlays((current) => {
          if (current[key]?.seq !== seq) return current;
          const { [key]: _dropped, ...rest } = current;
          return rest;
        });
      const run = async () => {
        const latest = recordsRef.current.find((item) => item.id === record.id) ?? record;
        let baseCommitId = baseHead ?? record.headCommitId;
        const cellSuccessors = successors.current.get(key);
        const seen = new Set<string>();
        while (cellSuccessors?.has(baseCommitId) && !seen.has(baseCommitId)) {
          seen.add(baseCommitId);
          baseCommitId = cellSuccessors.get(baseCommitId) ?? baseCommitId;
        }
        try {
          const result = await onUpdateRecordCell(latest, field.slug, value, {
            baseCommitId,
            mergeImmediately,
          });
          if (result.materialized) {
            const ownCellSuccessors = successors.current.get(key) ?? new Map<string, string>();
            ownCellSuccessors.set(baseCommitId, result.headCommitId);
            successors.current.set(key, ownCellSuccessors);
            ownHeads.current.set(result.headCommitId, seq);
            const shownHead =
              recordsRef.current.find((item) => item.id === record.id)?.headCommitId ??
              latest.headCommitId;
            setOverlays((current) =>
              current[key]?.seq === seq
                ? {
                    ...current,
                    [key]: {
                      value,
                      status: "saved",
                      fromHead: shownHead,
                      toHead: result.headCommitId,
                      seq,
                    },
                  }
                : current,
            );
            setNotice((current) => (current?.kind === "pending" ? current : null));
            return;
          }
          dropOverlay();
          // The write still completes; only its old-query feedback is discarded.
          // A generation also protects a quick page A -> B -> A round trip.
          if (proposalContext.current.generation !== proposalGeneration) return;
          setPending((current) => ({
            ...current,
            [key]: {
              changeRequestId: result.changeRequestId,
              proposedValue: value,
              fromHead:
                recordsRef.current.find((item) => item.id === record.id)?.headCommitId ??
                latest.headCommitId,
            },
          }));
          setNotice({
            kind: "pending",
            changeRequestId: result.changeRequestId,
            fieldName,
            requested: canMerge && !mergeImmediately,
          });
        } catch (error) {
          dropOverlay();
          const message = formatSaveError(error);
          setErrors((current) => ({ ...current, [key]: message }));
          setNotice({ kind: "error", fieldName, message });
        }
      };
      // Start at once when nothing is in flight for this record; otherwise wait
      // for the previous edit; only the same cell may build on its produced head.
      const previous = chains.current.get(record.id);
      const next = previous ? previous.then(run) : run();
      chains.current.set(record.id, next);
      void next.finally(() => {
        if (chains.current.get(record.id) === next) chains.current.delete(record.id);
      });
    },
    [canMerge, formatSaveError, onUpdateRecordCell, resolveFieldName],
  );

  /**
   * Validate and save what an editor produced — text from the one-line editor,
   * or the value the record form's select/date control picked. Returns false
   * (and keeps the editor open with the reason) when the value would be
   * refused; an unchanged value writes nothing. `mergeImmediately` defaults to
   * the main submit action.
   */
  const commit = useCallback(
    (
      record: RecordVO,
      field: BaseFieldVO,
      draft: unknown,
      move: GridMove,
      mergeImmediately = canMerge,
    ) => {
      const parsed = parseInlineCellDraft(field, draft);
      if (!parsed.ok) {
        if (typeof draft === "string") {
          const session = editingRef.current;
          rejectedDrafts.current.set(gridCellKey(record.id, field.slug), {
            value: draft,
            baseHead:
              session?.recordId === record.id && session.fieldSlug === field.slug
                ? session.baseHead
                : record.headCommitId,
            error: parsed.error,
          });
        }
        setEditError(parsed.error);
        return false;
      }
      const position = { recordId: record.id, fieldSlug: field.slug };
      const current = getDisplayValue(record, field);
      const baseHead =
        editing?.recordId === record.id && editing.fieldSlug === field.slug
          ? editing.baseHead
          : undefined;
      finishEditing(position, move);
      if (!isSameInlineCellValue(field, current, parsed.value)) {
        save(record, field, parsed.value, baseHead, mergeImmediately);
      }
      return true;
    },
    [canMerge, editing, finishEditing, getDisplayValue, save],
  );

  const toggleCheckbox = useCallback(
    (record: RecordVO, field: BaseFieldVO) => {
      // The form's checkbox coercion, so a legacy "true" string reads as checked.
      const next = !normalizeEditorFieldValue(field, getDisplayValue(record, field));
      save(record, field, next);
    },
    [getDisplayValue, save],
  );

  const updateDraft = useCallback((key: string, value: string) => {
    draftRef.current = { key, value };
    setEditError(null);
  }, []);

  const handleGridKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (!enabled || event.defaultPrevented) return;
      const target = event.target as HTMLElement;
      const cell = target.closest<HTMLElement>("[data-grid-cell]");
      if (!cell || !gridRef.current?.contains(cell)) return;
      // Editors own their keys; a link or the checkbox inside a cell acts for the cell.
      if (target.closest("[data-inline-cell-editor]")) return;
      const onCellItself = target === cell;
      if (
        !onCellItself &&
        !(target instanceof HTMLAnchorElement) &&
        target.getAttribute("role") !== "checkbox"
      ) {
        return;
      }
      const recordId = cell.dataset.cellRecord ?? "";
      const fieldSlug = cell.dataset.cellField ?? "";
      const record = recordsRef.current.find((item) => item.id === recordId);
      const field = fieldBySlug.get(fieldSlug);
      if (!record || !field) return;
      const position = { recordId, fieldSlug };
      const editable = isEditableCell(record, field);
      const kind = editable ? getInlineCellEditorKind(field) : null;
      const moveBy = (rowDelta: number, columnDelta: number) => {
        const next = neighbour(position, rowDelta, columnDelta);
        if (!next) return false;
        focusCell(next);
        return true;
      };

      switch (event.key) {
        case "ArrowUp":
        case "ArrowDown":
        case "ArrowLeft":
        case "ArrowRight": {
          event.preventDefault();
          if (event.key === "ArrowUp") moveBy(-1, 0);
          else if (event.key === "ArrowDown") moveBy(1, 0);
          else if (event.key === "ArrowLeft") moveBy(0, -1);
          else moveBy(0, 1);
          return;
        }
        case "Home":
        case "End": {
          event.preventDefault();
          const rowIndex = recordsRef.current.findIndex((item) => item.id === recordId);
          const targetRecord =
            event.ctrlKey || event.metaKey
              ? recordsRef.current[event.key === "Home" ? 0 : recordsRef.current.length - 1]
              : recordsRef.current[rowIndex];
          const targetField = fields[event.key === "Home" ? 0 : fields.length - 1];
          if (targetRecord && targetField) {
            focusCell({ recordId: targetRecord.id, fieldSlug: targetField.slug });
          }
          return;
        }
        case "Tab": {
          // Within a row Tab moves like a spreadsheet; at the row's edge it leaves
          // the grid, so keyboard users are never trapped in a long table.
          if (moveBy(0, event.shiftKey ? -1 : 1)) event.preventDefault();
          return;
        }
        case "Enter":
        case "F2": {
          if (kind === "checkbox") {
            event.preventDefault();
            toggleCheckbox(record, field);
            return;
          }
          if (kind) {
            event.preventDefault();
            startEditing(record, field);
            return;
          }
          // Read-only cell: Enter opens the record. A focused link activates itself.
          if (event.key === "Enter" && target instanceof HTMLAnchorElement) return;
          event.preventDefault();
          onOpenRecord(record);
          return;
        }
        case " ": {
          event.preventDefault();
          if (kind === "checkbox") toggleCheckbox(record, field);
          else onOpenRecord(record);
          return;
        }
        default: {
          if (!isPrintableKey(event) || event.nativeEvent.isComposing) return;
          if (!kind) {
            setNotice({ kind: "readOnly", fieldName: resolveFieldName(field) });
            return;
          }
          if (kind === "checkbox") return;
          event.preventDefault();
          startEditing(record, field, kind === "date" ? null : event.key);
        }
      }
    },
    [
      enabled,
      fieldBySlug,
      fields,
      focusCell,
      gridRef,
      isEditableCell,
      neighbour,
      onOpenRecord,
      resolveFieldName,
      startEditing,
      toggleCheckbox,
    ],
  );

  return {
    enabled,
    active,
    activate,
    cancelEditing,
    commit,
    draftRef,
    editError,
    editing,
    getCellStatus,
    getDisplayValue,
    handleGridKeyDown,
    isEditableCell,
    notice,
    dismissNotice: () => setNotice(null),
    startEditing,
    toggleCheckbox,
    updateDraft,
  };
}

export type BaseGridEditing = ReturnType<typeof useBaseGridEditing>;
