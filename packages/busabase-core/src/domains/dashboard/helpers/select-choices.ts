/**
 * Pure helpers behind the select / multiselect choices editor.
 *
 * The editor works on drafts (names may be blank or untrimmed while the user is
 * typing) and only turns them into real `choices` on submit, via
 * `buildSelectChoices`. Choice ids are the stored cell values, so a rename must
 * keep the id — records keep pointing at the same choice under its new name.
 */

export type SelectChoice = { id: string; name: string; color?: string };

/** A choice as it sits in the editor: the name may be blank or untrimmed. */
export type ChoiceDraft = SelectChoice;

/**
 * Palette order for new choices. Every key must exist in `CHOICE_BADGE_CLASS`
 * (helpers/field.ts) so the swatch and the record chip render the same colour.
 */
export const CHOICE_COLOR_CYCLE = [
  "blue",
  "emerald",
  "amber",
  "violet",
  "rose",
  "cyan",
  "orange",
  "teal",
  "pink",
  "indigo",
  "slate",
] as const;

/** First palette colour no draft uses yet; once all are taken, cycle by count. */
export const nextChoiceColor = (drafts: readonly ChoiceDraft[]): string => {
  const used = new Set(drafts.map((draft) => draft.color));
  const free = CHOICE_COLOR_CYCLE.find((color) => !used.has(color));
  return free ?? CHOICE_COLOR_CYCLE[drafts.length % CHOICE_COLOR_CYCLE.length];
};

const CHOICE_ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const CHOICE_ID_LENGTH = 8;

/** `opt_` + 8 base36 chars, never one of `taken`. `random` is injectable for tests. */
export const createChoiceId = (
  taken: Iterable<string>,
  random: () => number = Math.random,
): string => {
  const takenIds = new Set(taken);
  for (;;) {
    let suffix = "";
    for (let index = 0; index < CHOICE_ID_LENGTH; index += 1) {
      const pick = Math.floor(random() * CHOICE_ID_ALPHABET.length);
      suffix += CHOICE_ID_ALPHABET[Math.min(Math.max(pick, 0), CHOICE_ID_ALPHABET.length - 1)];
    }
    const id = `opt_${suffix}`;
    if (!takenIds.has(id)) return id;
  }
};

export const addChoiceDraft = (
  drafts: readonly ChoiceDraft[],
  random?: () => number,
): ChoiceDraft[] => [
  ...drafts,
  {
    id: createChoiceId(
      drafts.map((draft) => draft.id),
      random,
    ),
    name: "",
    color: nextChoiceColor(drafts),
  },
];

export const renameChoiceDraft = (
  drafts: readonly ChoiceDraft[],
  id: string,
  name: string,
): ChoiceDraft[] => drafts.map((draft) => (draft.id === id ? { ...draft, name } : draft));

export const removeChoiceDraft = (drafts: readonly ChoiceDraft[], id: string): ChoiceDraft[] =>
  drafts.filter((draft) => draft.id !== id);

/** Move the draft at `index` by `delta` places; a move past either end is a no-op. */
export const moveChoiceDraft = (
  drafts: readonly ChoiceDraft[],
  index: number,
  delta: number,
): ChoiceDraft[] => {
  const target = index + delta;
  if (
    index < 0 ||
    index >= drafts.length ||
    target < 0 ||
    target >= drafts.length ||
    target === index
  ) {
    return [...drafts];
  }
  const next = [...drafts];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved as ChoiceDraft);
  return next;
};

export type BuildSelectChoicesResult =
  | { ok: true; choices: SelectChoice[] }
  | { ok: false; error: "blank" | "duplicate"; name?: string };

/**
 * Turn editor drafts into the `choices` array to save.
 *
 * - A blank row that is NOT an existing choice is an untouched new row: dropped.
 * - A blank row that IS an existing choice is an error — clearing a name must
 *   never silently delete a choice records may still point at.
 * - Names are trimmed; duplicates (case-insensitive) are an error.
 */
export const buildSelectChoices = (
  drafts: readonly ChoiceDraft[],
  existingIds: ReadonlySet<string> = new Set(),
): BuildSelectChoicesResult => {
  const choices: SelectChoice[] = [];
  const seen = new Set<string>();
  for (const draft of drafts) {
    const name = draft.name.trim();
    if (!name) {
      if (existingIds.has(draft.id)) return { ok: false, error: "blank" };
      continue;
    }
    const key = name.toLocaleLowerCase();
    if (seen.has(key)) return { ok: false, error: "duplicate", name };
    seen.add(key);
    choices.push(
      draft.color === undefined
        ? { id: draft.id, name }
        : { id: draft.id, name, color: draft.color },
    );
  }
  return { ok: true, choices };
};

/** Whether saving `next` over `prev` changes anything, and which choices it drops. */
export const diffSelectChoices = (
  prev: readonly SelectChoice[],
  next: readonly SelectChoice[],
): { changed: boolean; removed: SelectChoice[] } => {
  const nextIds = new Set(next.map((choice) => choice.id));
  const removed = prev.filter((choice) => !nextIds.has(choice.id));
  const changed =
    prev.length !== next.length ||
    prev.some((choice, index) => {
      const other = next[index];
      return (
        !other ||
        other.id !== choice.id ||
        other.name !== choice.name ||
        other.color !== choice.color
      );
    });
  return { changed, removed };
};
