// @vitest-environment jsdom

import {
  AGENT_PROMPT_CLIPBOARD_MIME,
  createAgentPromptEnvelope,
  joinAgentPromptSegments,
} from "busabase-contract/domains/agents/prompt-context";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyAgentPromptSnapshot } from "./agent-prompt-clipboard";

const envelope = createAgentPromptEnvelope({
  scenario: { id: "find", title: "Find records" },
  target: { nodeId: "nod_1", nodeName: "运营 🌏", nodeType: "base" },
  source: { origin: "https://busabase.example", edition: "desktop" },
  segments: [
    { kind: "target", text: "Target: 运营 🌏" },
    { kind: "task", text: "Find all.  \nComplete text." },
  ],
});
const text = joinAgentPromptSegments(envelope.segments);
let writeText: ReturnType<typeof vi.fn>;
let writes: Record<string, string>;
const dispatchCopy = (customThrows = false, plainThrows = false) => {
  const event = new Event("copy", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      setData: (mime: string, value: string) => {
        if ((customThrows && mime !== "text/plain") || (plainThrows && mime === "text/plain"))
          throw new Error("unsupported");
        writes[mime] = value;
      },
    },
  });
  document.dispatchEvent(event);
  return event;
};
beforeEach(() => {
  writes = {};
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: vi.fn(() => {
      dispatchCopy();
      return true;
    }),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("scoped dual-format prompt copy", () => {
  it("writes full plain text and matching metadata in a single copy event, never overwriting success", async () => {
    const onCopy = vi.fn();
    document.addEventListener("copy", onCopy, { once: true });
    await copyAgentPromptSnapshot({ text, envelope });
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(writes["text/plain"]).toBe(text);
    expect(JSON.parse(writes[AGENT_PROMPT_CLIPBOARD_MIME])).toEqual(envelope);
    expect(writeText).not.toHaveBeenCalled();
    expect((onCopy.mock.calls[0][0] as Event).defaultPrevented).toBe(true);
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("restores focus, selected input text, and DOM selection and removes the listener", async () => {
    const input = document.createElement("textarea");
    input.value = "existing draft";
    const paragraph = document.createElement("p");
    paragraph.textContent = "selection";
    document.body.append(input, paragraph);
    input.focus();
    input.setSelectionRange(2, 6, "backward");
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    const remove = vi.spyOn(document, "removeEventListener");
    await copyAgentPromptSnapshot({ text, envelope });
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd, input.selectionDirection]).toEqual([
      2,
      6,
      "backward",
    ]);
    expect(window.getSelection()?.toString()).toBe("selection");
    expect(document.querySelectorAll("textarea")).toHaveLength(1);
    expect(remove).toHaveBeenCalledWith("copy", expect.any(Function), true);
    writes = {};
    dispatchCopy();
    expect(writes).toEqual({});
  });

  it("keeps the temporary selection inside a modal focus trap", async () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const button = document.createElement("button");
    dialog.append(button);
    document.body.append(dialog);
    button.focus();
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => {
        expect(dialog.contains(document.activeElement)).toBe(true);
        expect((document.activeElement as HTMLTextAreaElement).value).toBe(text);
        dispatchCopy();
        return true;
      }),
    });
    await copyAgentPromptSnapshot({ text, envelope });
    expect(document.activeElement).toBe(button);
  });

  it("uses plain-only in the same operation if the custom format is unsupported", async () => {
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => {
        dispatchCopy(true);
        return true;
      }),
    });
    await copyAgentPromptSnapshot({ text, envelope });
    expect(writes).toEqual({ "text/plain": text });
    expect(writeText).not.toHaveBeenCalled();
  });

  it("falls back only after failed trigger or plain write and always removes the temporary control/listener", async () => {
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => {
        dispatchCopy(false, true);
        return false;
      }),
    });
    await copyAgentPromptSnapshot({ text, envelope });
    expect(writeText).toHaveBeenCalledExactlyOnceWith(text);
    expect(document.querySelector("textarea")).toBeNull();
    writes = {};
    dispatchCopy();
    expect(writes).toEqual({});
  });

  it("omits metadata that differs from plain text, and supports plain-only callers", async () => {
    await copyAgentPromptSnapshot({ text: "different", envelope });
    expect(writes).toEqual({ "text/plain": "different" });
    writes = {};
    await copyAgentPromptSnapshot({ text });
    expect(writes).toEqual({ "text/plain": text });
  });

  it("reports total failure without losing the caller's existing draft focus", async () => {
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => {
        throw new Error("disabled");
      }),
    });
    writeText.mockRejectedValue(new Error("denied"));
    await expect(copyAgentPromptSnapshot({ text, envelope })).rejects.toThrow("denied");
    expect(document.activeElement).toBe(button);
    expect(document.querySelector("textarea")).toBeNull();
    writes = {};
    dispatchCopy();
    expect(writes).toEqual({});
  });

  it("holds an immutable snapshot during async recovery and rapid scenario changes", async () => {
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => false),
    });
    let resolve: (() => void) | undefined;
    writeText.mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const snapshot = { text, envelope: structuredClone(envelope) };
    const copied = copyAgentPromptSnapshot(snapshot);
    snapshot.text = "next scenario";
    snapshot.envelope.segments[0].text = "next target";
    expect(writeText).toHaveBeenCalledExactlyOnceWith(text);
    resolve?.();
    await copied;
  });
});
