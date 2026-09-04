import { DEFAULT_BASE_URL } from "busabase-sdk";
import { describe, expect, it } from "vitest";
import { authRecoveryHint, buildLoginCommand } from "./login";
import { requiredLevelFor } from "./schema-command";

describe("buildLoginCommand", () => {
  it("omits --base-url for the default Cloud host", () => {
    expect(buildLoginCommand(DEFAULT_BASE_URL, undefined, "--no-wait")).toBe(
      "busabase-cli login --no-wait",
    );
  });

  it("carries a self-hosted base URL and the active profile", () => {
    expect(buildLoginCommand("https://busabase.example.com", "work", "--resume-code abc")).toBe(
      "busabase-cli login --base-url https://busabase.example.com --profile work --resume-code abc",
    );
  });

  it("renders a bare login command when the suffix is empty", () => {
    expect(buildLoginCommand(DEFAULT_BASE_URL, undefined, "")).toBe("busabase-cli login");
  });
});

describe("authRecoveryHint", () => {
  it("gives a 401 the full two-turn recovery, pre-filled for this connection", () => {
    const hint = authRecoveryHint("UNAUTHORIZED", "https://busabase.example.com", "work");
    expect(hint).toContain(
      "busabase-cli login --base-url https://busabase.example.com --profile work --no-wait --output json",
    );
    expect(hint).toContain("--resume-code <resume_code>");
    expect(hint).toContain("opaque string");
    expect(hint).toContain("Do not restart login");
  });

  it("points a 403 at space targeting instead of re-login", () => {
    const hint = authRecoveryHint("FORBIDDEN", DEFAULT_BASE_URL);
    expect(hint).toContain("space list");
    expect(hint).not.toContain("--no-wait");
  });
});

describe("authRecoveryHint — 403 names the level this endpoint needs", () => {
  it("names the endpoint and its required level from the contract's own policy", () => {
    const hint = authRecoveryHint("FORBIDDEN", DEFAULT_BASE_URL, undefined, {
      procedureId: "changeRequests.merge",
      ...requiredLevelFor("changeRequests.merge"),
    });
    expect(hint).toContain("`changeRequests.merge`");
    expect(hint).toContain("level `write`");
    expect(hint).not.toContain("fails closed");
  });

  it("flags a level that came from the fail-closed default rather than a declared policy", () => {
    const undeclared = requiredLevelFor("users.me");
    expect(undeclared.declared).toBe(false);
    expect(undeclared.level).toBe("manage");
    const hint = authRecoveryHint("FORBIDDEN", DEFAULT_BASE_URL, undefined, {
      procedureId: "users.me",
      ...undeclared,
    });
    expect(hint).toContain("fails closed");
  });

  it("falls back to the generic advice when the command maps to no single endpoint", () => {
    const hint = authRecoveryHint("FORBIDDEN", DEFAULT_BASE_URL);
    expect(hint).toContain("Confirm the target space");
    expect(hint).not.toContain("requires an API key at level");
  });

  it("always explains why a changeRequest key cannot merge its own proposal", () => {
    expect(authRecoveryHint("FORBIDDEN", DEFAULT_BASE_URL)).toContain("cannot merge its own");
  });
});

describe("requiredLevelFor", () => {
  it("agrees with the semantics the approval model depends on", () => {
    expect(requiredLevelFor("bases.list").level).toBe("read");
    expect(requiredLevelFor("nodes.createChangeRequest").level).toBe("changeRequest");
    // The whole point of the tiering: an agent key that may propose must not merge.
    expect(requiredLevelFor("changeRequests.merge").level).toBe("write");
  });
});
