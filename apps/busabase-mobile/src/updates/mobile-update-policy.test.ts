import { beforeAll, describe, expect, it, vi } from "vitest";
import type { MobileUpdateManifest } from "./mobile-update-policy";

vi.mock("expo-constants", () => ({ default: {} }));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("~/connection/config", () => ({
  busabaseConfig: { updateManifestUrl: "https://example.com/latest.json" },
}));

let resolveMobileUpdateDecision: typeof import("./mobile-update-policy").resolveMobileUpdateDecision;

beforeAll(async () => {
  ({ resolveMobileUpdateDecision } = await import("./mobile-update-policy"));
});

const manifest = (): MobileUpdateManifest => ({
  version: "0.9.8",
  platforms: {
    ios: {
      primary: {
        kind: "app-store",
        url: "https://apps.apple.com/app/id6783588467",
      },
    },
  },
  mobilePolicy: {
    forceUpdate: [],
    optionalUpdate: [],
    reviewBuilds: [],
  },
});

describe("mobile update policy", () => {
  it("keeps an older review build usable when no minimum version is configured", () => {
    const decision = resolveMobileUpdateDecision(manifest(), {
      platform: "ios",
      version: "0.9.6",
      build: "32",
    });

    expect(decision.action).toBe("none");
  });

  it("prompts an iOS update only when the App Store release is explicitly available", () => {
    const updateManifest = manifest();
    const policy = updateManifest.mobilePolicy;
    if (!policy) throw new Error("Test manifest must include a mobile policy");
    policy.optionalUpdate = [{ platform: "ios", versionRange: "<0.9.8" }];

    const decision = resolveMobileUpdateDecision(updateManifest, {
      platform: "ios",
      version: "0.9.6",
      build: "32",
    });

    expect(decision.action).toBe("optional");
  });

  it("still enforces an explicitly configured iOS force-update rule", () => {
    const updateManifest = manifest();
    const policy = updateManifest.mobilePolicy;
    if (!policy) throw new Error("Test manifest must include a mobile policy");
    policy.forceUpdate = [{ platform: "ios", versionRange: "<0.9.8" }];

    const decision = resolveMobileUpdateDecision(updateManifest, {
      platform: "ios",
      version: "0.9.6",
      build: "32",
    });

    expect(decision.action).toBe("force");
  });
});
