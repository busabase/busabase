import { describe, expect, it } from "vitest";
import { coreMessagesEn } from "../../../i18n/messages";
import { buildNodeAgentPrompts, type NodePromptContext } from "./node-agent-prompts";

/**
 * Scoping of the Agent-prompt set.
 *
 * The dialog is one component reused at four widths, so the ONLY thing that
 * distinguishes them is what `buildNodeAgentPrompts` returns: how the target
 * line names the thing, which curated scenarios apply, and which operations are
 * still meaningful. Getting that wrong is invisible in the UI — every scope
 * renders a plausible-looking list — so it is pinned here.
 *
 * The load-bearing case is `cell`: it is the intersection of `field` and
 * `record`, and the failure mode is silently offering it one of their prompt
 * sets ("clean up this column") while the user believes they pointed at one value.
 */

const BASE_CONTEXT: NodePromptContext = {
  nodeId: "nod_base_blog",
  nodeName: "Posts",
  nodeType: "base",
  spaceId: "local",
};

const build = (scope?: NodePromptContext["scope"]) =>
  buildNodeAgentPrompts({ ...BASE_CONTEXT, scope }, "en", coreMessagesEn);

const FIELD = { fieldName: "Title", fieldSlug: "title", fieldType: "text" } as const;
const RECORD = { recordId: "rec_1", recordTitle: "Launch plan" } as const;

describe("buildNodeAgentPrompts scoping", () => {
  it("names the whole node and offers the node's own scenarios by default", () => {
    const { scenarios, capabilities } = build();
    expect(scenarios.map((prompt) => prompt.key)).toContain("base-bulk-import");
    for (const prompt of scenarios) {
      expect(prompt.body).toContain('the Busabase Base "Posts" (nodeId: nod_base_blog)');
      expect(prompt.body).not.toContain("ONE field only");
      expect(prompt.body).not.toContain("ONE record only");
      expect(prompt.body).not.toContain("ONE value only");
    }
    // Unscoped keeps the generic node-tree operations.
    expect(capabilities.map((prompt) => prompt.key)).toContain("node_move");
  });

  it("field scope pins the column and drops node-tree operations", () => {
    const { scenarios, capabilities } = build({ kind: "field", ...FIELD });
    expect(scenarios.map((prompt) => prompt.key)).toEqual([
      "field-clean-values",
      "field-fill-blanks",
      "field-audit",
      "field-redesign",
    ]);
    expect(scenarios[0]?.body).toContain(
      'Work on ONE field only: "Title" (fieldSlug: title, type: text)',
    );
    const kinds = capabilities.map((prompt) => prompt.key);
    expect(kinds).not.toContain("node_move");
    expect(kinds).toContain("record_update");
  });

  it("record scope pins the row and keeps only record operations", () => {
    const { scenarios, capabilities } = build({ kind: "record", ...RECORD });
    expect(scenarios.map((prompt) => prompt.key)).toEqual([
      "record-complete",
      "record-rewrite",
      "record-explain",
    ]);
    expect(scenarios[0]?.body).toContain(
      'Work on ONE record only: "Launch plan" (recordId: rec_1)',
    );
    for (const prompt of capabilities) {
      expect(prompt.key.startsWith("record_")).toBe(true);
    }
  });

  // The one that is easy to get wrong.
  it("cell scope pins BOTH coordinates and narrows to updating a value", () => {
    const { scenarios, capabilities } = build({ kind: "cell", ...RECORD, ...FIELD });

    expect(scenarios.map((prompt) => prompt.key)).toEqual([
      "cell-rewrite",
      "cell-derive",
      "cell-explain",
    ]);
    const body = scenarios[0]?.body ?? "";
    expect(body).toContain('the "Title" field (fieldSlug: title, type: text)');
    expect(body).toContain('the record "Launch plan" (recordId: rec_1)');
    // Both fences, so the agent cannot read it as "the column" or "the row".
    expect(body).toContain("Do not touch any other field of this record");
    expect(body).toContain("do not touch this field on any other record");

    // Creating or deleting a record is a different scope wearing the same word.
    expect(capabilities.map((prompt) => prompt.key)).toEqual(["record_update"]);
  });

  it("every scope still carries the approval-first footer", () => {
    for (const scope of [
      undefined,
      { kind: "field", ...FIELD } as const,
      { kind: "record", ...RECORD } as const,
      { kind: "cell", ...RECORD, ...FIELD } as const,
    ]) {
      const { scenarios, capabilities } = build(scope);
      for (const prompt of [...scenarios, ...capabilities]) {
        expect(prompt.body).toContain("never merge it without my approval");
      }
    }
  });
});
