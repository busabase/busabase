import { ORPCError } from "@orpc/client";
import { describe, expect, it } from "vitest";
import { isFormNotConfiguredError } from "./not-configured-error";

describe("isFormNotConfiguredError", () => {
  it("treats the server's NOT_FOUND as 'no form config yet'", () => {
    // What `forms.getByNode` actually throws for a node with no form row.
    expect(
      isFormNotConfiguredError(new ORPCError("NOT_FOUND", { message: "Form not found: nod123" })),
    ).toBe(true);
  });

  it("does not swallow a real failure", () => {
    // These must keep the message + Retry button — silently showing "not
    // configured" for a 500 or a permission error would hide a broken form.
    expect(isFormNotConfiguredError(new ORPCError("INTERNAL_SERVER_ERROR"))).toBe(false);
    expect(isFormNotConfiguredError(new ORPCError("FORBIDDEN"))).toBe(false);
    expect(isFormNotConfiguredError(new Error("Failed to fetch"))).toBe(false);
  });

  it("is safe on the no-error case", () => {
    expect(isFormNotConfiguredError(null)).toBe(false);
    expect(isFormNotConfiguredError(undefined)).toBe(false);
  });
});
