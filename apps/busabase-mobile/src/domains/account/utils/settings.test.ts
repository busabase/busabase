import { describe, expect, it } from "vitest";
import { settingsAccountIdentity } from "./settings";

describe("settings account identity", () => {
  it("keeps the complete email without repeating it as a name", () => {
    const email = "regional.customer.success.and.operations.team@example-business.test";
    expect(settingsAccountIdentity({ name: ` ${email.toUpperCase()} `, email })).toEqual({
      name: "",
      email,
    });
  });

  it("preserves a distinct display name and email", () => {
    expect(
      settingsAccountIdentity({ name: " Taylor Rivera ", email: " taylor@example.test " }),
    ).toEqual({
      name: "Taylor Rivera",
      email: "taylor@example.test",
    });
  });

  it("leaves missing account details empty so the view can use its localized fallback", () => {
    expect(settingsAccountIdentity(undefined)).toEqual({ name: "", email: "" });
    expect(settingsAccountIdentity({ name: "   ", email: "" })).toEqual({ name: "", email: "" });
  });
});
