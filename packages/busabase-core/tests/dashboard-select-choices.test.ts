import { describe, expect, it } from "vitest";
import { CHOICE_BADGE_CLASS } from "../src/domains/dashboard/helpers/field";
import {
  addChoiceDraft,
  buildSelectChoices,
  CHOICE_COLOR_CYCLE,
  type ChoiceDraft,
  createChoiceId,
  diffSelectChoices,
  moveChoiceDraft,
  nextChoiceColor,
  removeChoiceDraft,
  renameChoiceDraft,
} from "../src/domains/dashboard/helpers/select-choices";

// A deterministic `random` that replays the given values in order, then repeats the last.
const sequence = (...values: number[]) => {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)] as number;
};

const drafts: ChoiceDraft[] = [
  { id: "todo", name: "Todo", color: "slate" },
  { id: "doing", name: "Doing", color: "amber" },
  { id: "done", name: "Done", color: "emerald" },
];

describe("CHOICE_COLOR_CYCLE", () => {
  it("only names colours the badge palette can render", () => {
    for (const color of CHOICE_COLOR_CYCLE) {
      expect(CHOICE_BADGE_CLASS[color]).toBeDefined();
    }
  });
});

describe("nextChoiceColor", () => {
  it("starts at the head of the palette", () => {
    expect(nextChoiceColor([])).toBe(CHOICE_COLOR_CYCLE[0]);
  });

  it("picks the first colour no draft uses", () => {
    expect(nextChoiceColor([{ id: "a", name: "A", color: "blue" }])).toBe("emerald");
    expect(
      nextChoiceColor([
        { id: "a", name: "A", color: "blue" },
        { id: "b", name: "B", color: "amber" },
      ]),
    ).toBe("emerald");
  });

  it("cycles by count once every colour is taken", () => {
    const full = CHOICE_COLOR_CYCLE.map((color, index) => ({ id: `c${index}`, name: "", color }));
    expect(nextChoiceColor(full)).toBe(CHOICE_COLOR_CYCLE[full.length % CHOICE_COLOR_CYCLE.length]);
    const more = [...full, { id: "x", name: "", color: "blue" }];
    expect(nextChoiceColor(more)).toBe(CHOICE_COLOR_CYCLE[more.length % CHOICE_COLOR_CYCLE.length]);
  });
});

describe("createChoiceId", () => {
  it("is opt_ + 8 base36 chars", () => {
    expect(createChoiceId([])).toMatch(/^opt_[0-9a-z]{8}$/);
    expect(createChoiceId([], () => 0)).toBe("opt_00000000");
  });

  it("retries until the id is not taken", () => {
    // First draw → all zeros (taken), second → all "z"s (free).
    const random = sequence(0, 0, 0, 0, 0, 0, 0, 0, 0.999);
    expect(createChoiceId(["opt_00000000"], random)).toBe("opt_zzzzzzzz");
  });

  it("never returns a taken id across many draws", () => {
    const taken = new Set<string>();
    for (let index = 0; index < 200; index += 1) {
      const id = createChoiceId(taken);
      expect(taken.has(id)).toBe(false);
      taken.add(id);
    }
  });
});

describe("draft edits", () => {
  it("addChoiceDraft appends a blank row with a fresh id and colour, immutably", () => {
    const next = addChoiceDraft(drafts, () => 0);
    expect(next).toHaveLength(4);
    expect(next[3]).toEqual({ id: "opt_00000000", name: "", color: "blue" });
    expect(drafts).toHaveLength(3);
  });

  it("addChoiceDraft avoids ids already in the list", () => {
    const withCollision = [{ id: "opt_00000000", name: "A", color: "blue" }];
    const next = addChoiceDraft(withCollision, sequence(0, 0, 0, 0, 0, 0, 0, 0, 0.999));
    expect(next[1]?.id).toBe("opt_zzzzzzzz");
    expect(next[1]?.color).toBe("emerald");
  });

  it("renameChoiceDraft changes the name and keeps the id", () => {
    const next = renameChoiceDraft(drafts, "doing", "In progress");
    expect(next[1]).toEqual({ id: "doing", name: "In progress", color: "amber" });
    expect(drafts[1]?.name).toBe("Doing");
  });

  it("removeChoiceDraft drops only the matching id", () => {
    expect(removeChoiceDraft(drafts, "doing").map((draft) => draft.id)).toEqual(["todo", "done"]);
  });

  it("moveChoiceDraft moves within bounds and is a no-op past the ends", () => {
    expect(moveChoiceDraft(drafts, 0, 1).map((draft) => draft.id)).toEqual([
      "doing",
      "todo",
      "done",
    ]);
    expect(moveChoiceDraft(drafts, 2, -1).map((draft) => draft.id)).toEqual([
      "todo",
      "done",
      "doing",
    ]);
    expect(moveChoiceDraft(drafts, 0, -1)).toEqual(drafts);
    expect(moveChoiceDraft(drafts, 2, 1)).toEqual(drafts);
    expect(moveChoiceDraft(drafts, 5, -1)).toEqual(drafts);
    expect(moveChoiceDraft(drafts, 0, 1)).not.toBe(drafts);
  });
});

describe("buildSelectChoices", () => {
  it("trims names and preserves ids and colours", () => {
    const result = buildSelectChoices([
      { id: "todo", name: "  Todo ", color: "slate" },
      { id: "opt_new", name: "Blocked" },
    ]);
    expect(result).toEqual({
      ok: true,
      choices: [
        { id: "todo", name: "Todo", color: "slate" },
        { id: "opt_new", name: "Blocked" },
      ],
    });
    if (result.ok) expect("color" in (result.choices[1] ?? {})).toBe(false);
  });

  it("silently drops a blank NEW row", () => {
    const result = buildSelectChoices(
      [...drafts, { id: "opt_blank", name: "   ", color: "blue" }],
      new Set(["todo", "doing", "done"]),
    );
    expect(result.ok && result.choices.map((choice) => choice.id)).toEqual([
      "todo",
      "doing",
      "done",
    ]);
  });

  it("refuses a blank EXISTING choice instead of deleting it", () => {
    expect(
      buildSelectChoices(renameChoiceDraft(drafts, "doing", " "), new Set(["todo", "doing"])),
    ).toEqual({ ok: false, error: "blank" });
  });

  it("detects duplicate names case-insensitively", () => {
    expect(buildSelectChoices([...drafts, { id: "opt_x", name: " todo " }])).toEqual({
      ok: false,
      error: "duplicate",
      name: "todo",
    });
  });

  it("allows an empty list", () => {
    expect(buildSelectChoices([])).toEqual({ ok: true, choices: [] });
  });
});

describe("diffSelectChoices", () => {
  it("reports no change for an identical list", () => {
    expect(
      diffSelectChoices(
        drafts,
        drafts.map((draft) => ({ ...draft })),
      ),
    ).toEqual({
      changed: false,
      removed: [],
    });
  });

  it("treats a pure reorder as a change with nothing removed", () => {
    expect(diffSelectChoices(drafts, moveChoiceDraft(drafts, 0, 1))).toEqual({
      changed: true,
      removed: [],
    });
  });

  it("treats a rename or colour change as a change", () => {
    expect(diffSelectChoices(drafts, renameChoiceDraft(drafts, "todo", "Backlog")).changed).toBe(
      true,
    );
    expect(
      diffSelectChoices(drafts, [
        { ...drafts[0], color: "blue" } as ChoiceDraft,
        ...drafts.slice(1),
      ]).changed,
    ).toBe(true);
  });

  it("lists removed choices by id", () => {
    const result = diffSelectChoices(drafts, [
      { id: "done", name: "Done", color: "emerald" },
      { id: "opt_new", name: "New" },
    ]);
    expect(result.changed).toBe(true);
    expect(result.removed.map((choice) => choice.id)).toEqual(["todo", "doing"]);
  });

  it("reports an addition as a change", () => {
    expect(diffSelectChoices([], [{ id: "opt_a", name: "A" }])).toEqual({
      changed: true,
      removed: [],
    });
  });
});
