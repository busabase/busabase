import { ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fmt, useCoreI18n } from "../../../i18n";
import { getChoiceBadgeClass } from "../helpers/field";
import {
  addChoiceDraft,
  type ChoiceDraft,
  moveChoiceDraft,
  removeChoiceDraft,
  renameChoiceDraft,
} from "../helpers/select-choices";

/**
 * The choices list for a select / multiselect field, shared by the add-field and
 * edit-field dialogs. Controlled: the dialog owns the drafts and turns them into
 * real choices on submit (`buildSelectChoices`). Each row keeps its choice id, so
 * renaming a choice never detaches the records that already use it.
 */
export function SelectChoicesEditor({
  disabled = false,
  drafts,
  onChange,
  removedNames = [],
}: {
  disabled?: boolean;
  drafts: ChoiceDraft[];
  onChange: (next: ChoiceDraft[]) => void;
  /** Existing choices this edit would drop — shown as a warning, not blocked here. */
  removedNames?: string[];
}) {
  const messages = useCoreI18n();
  // Id of the row that should take focus on the next render (a freshly added one).
  const [focusId, setFocusId] = useState<string | null>(null);
  const inputRefs = useRef(new Map<string, HTMLInputElement>());

  useEffect(() => {
    if (!focusId) return;
    inputRefs.current.get(focusId)?.focus();
    setFocusId(null);
  }, [focusId]);

  const addRow = () => {
    const next = addChoiceDraft(drafts);
    onChange(next);
    setFocusId(next[next.length - 1]?.id ?? null);
  };

  return (
    <fieldset className="mt-4 min-w-0" data-testid="select-choices-editor" disabled={disabled}>
      <legend className="text-muted-foreground text-xs">{messages.base.choices}</legend>
      {drafts.length === 0 ? (
        <p className="mt-1 text-muted-foreground text-xs">{messages.base.choicesEmptyHint}</p>
      ) : (
        <ul className="mt-1 space-y-1.5">
          {drafts.map((draft, index) => {
            const label = draft.name.trim() || messages.base.choiceNamePlaceholder;
            return (
              <li className="flex items-center gap-1.5" data-choice-id={draft.id} key={draft.id}>
                <span
                  aria-hidden="true"
                  className={`size-3.5 shrink-0 rounded-full border ${getChoiceBadgeClass(draft.color)}`}
                />
                <input
                  aria-label={messages.base.choiceNamePlaceholder}
                  className="h-8 min-w-0 flex-1 rounded-md border border-border/70 bg-card px-2.5 text-sm outline-none transition-colors focus:border-primary"
                  onChange={(event) =>
                    onChange(renameChoiceDraft(drafts, draft.id, event.target.value))
                  }
                  onKeyDown={(event) => {
                    // Enter on the last row starts the next one, so a list can be
                    // typed straight through. Never let it submit the dialog.
                    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                    event.preventDefault();
                    if (index === drafts.length - 1 && draft.name.trim()) addRow();
                  }}
                  placeholder={messages.base.choiceNamePlaceholder}
                  ref={(element) => {
                    if (element) inputRefs.current.set(draft.id, element);
                    else inputRefs.current.delete(draft.id);
                  }}
                  value={draft.name}
                />
                <button
                  aria-label={fmt(messages.base.moveChoiceUp, { name: label })}
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
                  disabled={index === 0}
                  onClick={() => onChange(moveChoiceDraft(drafts, index, -1))}
                  title={fmt(messages.base.moveChoiceUp, { name: label })}
                  type="button"
                >
                  <ChevronUp size={14} />
                </button>
                <button
                  aria-label={fmt(messages.base.moveChoiceDown, { name: label })}
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
                  disabled={index === drafts.length - 1}
                  onClick={() => onChange(moveChoiceDraft(drafts, index, 1))}
                  title={fmt(messages.base.moveChoiceDown, { name: label })}
                  type="button"
                >
                  <ChevronDown size={14} />
                </button>
                <button
                  aria-label={fmt(messages.base.removeChoice, { name: label })}
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-rejected/10 hover:text-rejected-strong"
                  onClick={() => onChange(removeChoiceDraft(drafts, draft.id))}
                  title={fmt(messages.base.removeChoice, { name: label })}
                  type="button"
                >
                  <X size={14} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <button
        className="mt-2 inline-flex items-center gap-1 rounded-md border border-border/70 border-dashed px-2.5 py-1 text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-foreground"
        onClick={addRow}
        type="button"
      >
        <Plus size={12} />
        {messages.base.addChoice}
      </button>
      {removedNames.length > 0 ? (
        <p className="mt-2 text-amber-700 text-xs dark:text-amber-300" role="status">
          {fmt(messages.base.choicesRemovedHint, { names: removedNames.join(", ") })}
        </p>
      ) : null}
    </fieldset>
  );
}
