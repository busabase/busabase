import { describe, expect, it } from "vitest";
import { getPromptActivityState } from "./prompt-activity";

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
