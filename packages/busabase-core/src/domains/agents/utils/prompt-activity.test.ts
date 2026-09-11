import { describe, expect, it } from "vitest";
import {
  getComposerPlaceholder,
  getPromptActivityState,
  isComposerDisabled,
} from "./prompt-activity";

describe("getPromptActivityState", () => {
  it("shows a starting state immediately while a prompt waits for connection readiness", () => {
    expect(getPromptActivityState("connecting", true)).toEqual({ active: true, starting: true });
  });

  it("keeps an established busy turn active without calling it startup", () => {
    expect(getPromptActivityState("busy", false)).toEqual({ active: true, starting: false });
  });

  it("leaves an idle session inactive", () => {
    expect(getPromptActivityState("idle", false)).toEqual({ active: false, starting: false });
  });
});

describe("isComposerDisabled", () => {
  it("disables while a turn is actively streaming", () => {
    expect(isComposerDisabled("idle", true, false)).toBe(true);
  });

  it("disables while a permission request is open", () => {
    expect(isComposerDisabled("waiting_permission", false, false)).toBe(true);
  });

  it("disables while a config option mutation is pending", () => {
    expect(isComposerDisabled("idle", false, true)).toBe(true);
  });

  it("stays enabled for an ended session that isn't streaming, waiting, or mutating", () => {
    expect(isComposerDisabled("ended", false, false)).toBe(false);
  });

  it("stays enabled for a failed session that isn't streaming, waiting, or mutating", () => {
    expect(isComposerDisabled("failed", false, false)).toBe(false);
  });

  it("stays enabled for an idle session with nothing pending", () => {
    expect(isComposerDisabled("idle", false, false)).toBe(false);
  });

  it("stays enabled for a connecting session with nothing pending", () => {
    expect(isComposerDisabled("connecting", false, false)).toBe(false);
  });
});

describe("getComposerPlaceholder", () => {
  it("points at the pending permission request while one is open", () => {
    expect(getComposerPlaceholder("waiting_permission", "Claude Code")).toBe(
      "Respond to the request above to continue…",
    );
  });

  it("does not tell the user to start a new session solely because this one ended", () => {
    const placeholder = getComposerPlaceholder("ended", "Claude Code");
    expect(placeholder).not.toMatch(/start a new (session|one)/i);
    expect(placeholder).toBe("Message Claude Code…");
  });

  it("does not tell the user to start a new session solely because this one failed", () => {
    const placeholder = getComposerPlaceholder("failed", "Claude Code");
    expect(placeholder).not.toMatch(/start a new (session|one)/i);
    expect(placeholder).toBe("Message Claude Code…");
  });

  it("falls back to the ordinary prompt for an idle session", () => {
    expect(getComposerPlaceholder("idle", "Claude Code")).toBe("Message Claude Code…");
  });
});
