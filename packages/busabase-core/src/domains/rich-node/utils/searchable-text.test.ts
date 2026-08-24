import { describe, expect, it } from "vitest";
import { extractWhiteboardSearchableText, extractWorkflowSearchableText } from "./searchable-text";

// Element shape copied from this repo's own demo scene
// (`src/demo/scenarios/node-types.en.ts`), not invented — a real Excalidraw
// text element carries BOTH `text` and `originalText`, plus the structural
// fields whose keys must never show up as grep hits.
const textElement = (overrides: Record<string, unknown>) => ({
  id: "el1",
  type: "text",
  x: 80,
  y: 50,
  width: 330,
  height: 38,
  strokeColor: "#0f172a",
  backgroundColor: "transparent",
  fontFamily: 5,
  containerId: null,
  isDeleted: false,
  ...overrides,
});

describe("extractWhiteboardSearchableText", () => {
  it("extracts text elements and drops all structural JSON keys", () => {
    const raw = JSON.stringify({
      version: 1,
      elements: [
        textElement({
          text: "Product launch whiteboard",
          originalText: "Product launch whiteboard",
        }),
        { id: "r1", type: "rectangle", x: 40, y: 40, strokeColor: "#1e1e1e", isDeleted: false },
      ],
      appState: {},
    });
    const out = extractWhiteboardSearchableText(raw);
    expect(out).toBe("Product launch whiteboard");
    // The whole point: structural keys/values must NOT be searchable.
    for (const noise of ["strokeColor", "#1e1e1e", "rectangle", "appState", "fontFamily"]) {
      expect(out).not.toContain(noise);
    }
  });

  it("prefers originalText over text, so a phrase spanning a soft wrap still matches", () => {
    const raw = JSON.stringify({
      version: 1,
      elements: [
        textElement({
          text: "Approval-first\nlaunch plan", // Excalidraw inserted a wrap newline
          originalText: "Approval-first launch plan", // what the user actually typed
        }),
      ],
    });
    const out = extractWhiteboardSearchableText(raw);
    expect(out).toBe("Approval-first launch plan");
    expect(out).toContain("first launch"); // spans the wrap point — only originalText has it
  });

  it("keeps a user's real newlines as real lines", () => {
    const raw = JSON.stringify({
      version: 1,
      elements: [textElement({ originalText: "Goal\nApproval-first launch" })],
    });
    expect(extractWhiteboardSearchableText(raw).split("\n")).toEqual([
      "Goal",
      "Approval-first launch",
    ]);
  });

  it("skips tombstoned elements — a deleted sticky must stop being findable", () => {
    const raw = JSON.stringify({
      version: 1,
      elements: [
        textElement({ id: "keep", originalText: "still here" }),
        textElement({ id: "gone", originalText: "deleted note", isDeleted: true }),
      ],
    });
    expect(extractWhiteboardSearchableText(raw)).toBe("still here");
  });

  it("extracts frame names", () => {
    const raw = JSON.stringify({
      version: 1,
      elements: [{ id: "f1", type: "frame", name: "Launch phase", isDeleted: false }],
    });
    expect(extractWhiteboardSearchableText(raw)).toBe("Launch phase");
  });

  it("is total: malformed / empty / wrong-shaped input yields no matches, never throws", () => {
    for (const raw of [
      "",
      "not json at all",
      "null",
      "[]",
      '{"version":1}',
      '{"elements":"nope"}',
    ]) {
      expect(extractWhiteboardSearchableText(raw)).toBe("");
    }
  });
});

describe("extractWorkflowSearchableText", () => {
  const workflow = {
    version: 2,
    nodes: [
      {
        id: "trigger",
        kind: "trigger",
        position: { x: 0, y: 0 },
        label: "Manual trigger",
        description: "Kick off the pricing review",
        eventName: "manual",
      },
      {
        id: "hook",
        kind: "webhook",
        position: { x: 200, y: 0 },
        label: "Notify billing",
        description: "",
        method: "POST",
        url: "https://example.test/billing",
      },
    ],
    edges: [
      { id: "e1", source: "trigger", target: "hook", label: "on approve", outcome: "default" },
    ],
    settings: { executionMode: "manual", concurrency: 1, timeoutMs: 30000, errorPolicy: "stop" },
  };

  it("extracts node labels, descriptions, kind-specific fields and edge labels", () => {
    const out = extractWorkflowSearchableText(JSON.stringify(workflow)).split("\n");
    expect(out).toEqual([
      "Manual trigger",
      "Kick off the pricing review",
      "manual",
      "Notify billing",
      "https://example.test/billing",
      "on approve",
      "default",
    ]);
  });

  it("drops structural noise — ids, coordinates, numeric settings", () => {
    const out = extractWorkflowSearchableText(JSON.stringify(workflow));
    for (const noise of [
      "position",
      "timeoutMs",
      "30000",
      "concurrency",
      "errorPolicy",
      '"kind"',
    ]) {
      expect(out).not.toContain(noise);
    }
  });

  it("omits empty-string fields rather than emitting blank lines", () => {
    // The webhook node's description is "" — it must not become an empty line.
    expect(extractWorkflowSearchableText(JSON.stringify(workflow))).not.toContain("\n\n");
  });

  it("never fabricates the EMPTY_WORKFLOW_DOCUMENT default on malformed JSON", () => {
    // Guards the stated contract: a broken object scans as zero lines, and must
    // NOT fall back to the default document (whose node label is "Manual trigger").
    for (const raw of ["", "{oops", "null", "[]"]) {
      const out = extractWorkflowSearchableText(raw);
      expect(out).toBe("");
      expect(out).not.toContain("Manual trigger");
    }
  });
});
