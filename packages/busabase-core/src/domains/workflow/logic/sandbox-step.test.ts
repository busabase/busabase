import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const lock = vi.hoisted(() => ({
  value: null as { lockedEngines: string[]; planLabel: string } | null,
}));
const sandock = vi.hoisted(() => ({
  config: null as { baseUrl: string; apiKey: string } | null,
  create: vi.fn(),
}));

vi.mock("../../../context", () => ({
  resolveContextAirAppEngineLock: async () => lock.value,
}));
vi.mock("../../airapp/logic/sandock-runtime", () => ({
  resolveSandockConfig: () => sandock.config,
  sandockClient: () => ({ sandbox: { create: sandock.create } }),
}));

const { parseSandboxPackages, startSandboxFunction } = await import("./sandbox-step");

const call = {
  stepId: "sign",
  code: "return 1",
  language: "javascript" as const,
  packages: "",
  input: {} as never,
  timeoutMs: 60_000,
};

describe("sandbox packages", () => {
  it("reads npm and pip specs separated by spaces, commas, or new lines", () => {
    expect(parseSandboxPackages("dayjs, lodash@4\n@wecom/crypto  requests==2.32.3")).toEqual([
      "dayjs",
      "lodash@4",
      "@wecom/crypto",
      "requests==2.32.3",
    ]);
    expect(parseSandboxPackages("  ")).toEqual([]);
  });

  it("names a spec that is not a package instead of passing it to a shell", () => {
    expect(() => parseSandboxPackages("dayjs; rm -rf /")).toThrow('"dayjs;" is not a package name');
    expect(() => parseSandboxPackages("$(curl evil)")).toThrow("is not a package name");
    expect(() => parseSandboxPackages("`id`")).toThrow("is not a package name");
  });

  it("caps how many packages one step installs", () => {
    const many = Array.from({ length: 31 }, (_, i) => `pkg${i}`).join(" ");
    expect(() => parseSandboxPackages(many)).toThrow("at most 30 packages");
  });
});

describe("who may have a sandbox", () => {
  beforeEach(() => {
    lock.value = null;
    sandock.config = { baseUrl: "https://sandock.example", apiKey: "key" };
    sandock.create.mockReset();
    sandock.create.mockRejectedValue(new Error("provisioning reached"));
  });

  it("refuses on a server with no Sandock, before anything is provisioned", async () => {
    sandock.config = null;
    await expect(startSandboxFunction(call)).rejects.toThrow("has no sandbox configured");
    expect(sandock.create).not.toHaveBeenCalled();
  });

  it("refuses a space whose plan leaves the remote engine out, naming the plan", async () => {
    lock.value = { lockedEngines: ["remote", "site"], planLabel: "Plus" };
    await expect(startSandboxFunction(call)).rejects.toThrow(
      "Running code in a sandbox needs the Plus plan.",
    );
    expect(sandock.create).not.toHaveBeenCalled();
  });

  it("provisions when the plan locks only other engines", async () => {
    lock.value = { lockedEngines: ["site"], planLabel: "Plus" };
    await expect(startSandboxFunction(call)).rejects.toThrow("provisioning reached");
    expect(sandock.create).toHaveBeenCalledTimes(1);
  });

  it("checks the packages before provisioning", async () => {
    await expect(startSandboxFunction({ ...call, packages: "a;b" })).rejects.toThrow(
      "is not a package name",
    );
    expect(sandock.create).not.toHaveBeenCalled();
  });
});
