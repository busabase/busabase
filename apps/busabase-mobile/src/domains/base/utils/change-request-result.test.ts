import { describe, expect, it } from "vitest";
import { isMergedOutcome, pendingChangeRequestId } from "./change-request-result";

/**
 * The bug these guard: every mobile save navigated to
 * `/change-requests/<result.id>` without reading `materialized`. A write-capable
 * actor merges immediately, so `result.id` was the RECORD id — the user finished
 * saving and landed on "Change request not found: rec…", with the write having
 * actually succeeded. Reproduced on a real device-sized run before the fix, and
 * on a plain text field too, so it was never member-specific.
 */
describe("change request outcome", () => {
  const merged = { id: "rec_abc", materialized: true };
  const pending = { id: "crq_abc", materialized: false };

  it("recognises an already-merged change", () => {
    expect(isMergedOutcome(merged)).toBe(true);
    expect(isMergedOutcome(pending)).toBe(false);
  });

  it("offers no review page for a change that already landed", () => {
    // null is what stops the caller routing to /change-requests/rec_abc.
    expect(pendingChangeRequestId(merged)).toBeNull();
  });

  it("returns the change request id when one is genuinely pending", () => {
    expect(pendingChangeRequestId(pending)).toBe("crq_abc");
  });

  it("treats a missing discriminant as pending, not merged", () => {
    // An older server that predates the union sends a bare ChangeRequest. That
    // is a real review page, so the safe reading of "absent" is "pending".
    expect(pendingChangeRequestId({ id: "crq_old" })).toBe("crq_old");
    expect(isMergedOutcome({ id: "crq_old" })).toBe(false);
  });
});
