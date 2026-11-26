import { ORPCError } from "@orpc/client";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { AirAppSiteActionVO } from "busabase-contract/domains/airapp/contract";
import { describe, expect, it, vi } from "vitest";
import {
  AirAppSiteBlockedError,
  SiteRunner,
} from "../src/domains/airapp/components/runners/site-runner";

const deployed = (
  version: string,
  previewUrl = "/api/airapp-preview/node-1/",
): AirAppSiteActionVO => ({
  outcome: "ok",
  state: {
    engine: "available",
    address: "https://site.example.test",
    publication: "not-live",
    isPublic: false,
    previewUrl,
    previewVersion: version,
    liveVersion: null,
    currentVersion: version,
    previewStale: false,
    previewDeployedAt: "2026-11-04T00:00:00.000Z",
    liveDeployedAt: null,
    blockers: [],
  },
});

const createRunner = () => {
  const call = vi.fn<() => Promise<AirAppSiteActionVO>>();
  const readState = vi.fn(async () => deployed("current").state);
  const orpc = {
    airapps: { siteDeployPreview: { call }, siteState: { call: readState } },
  } as unknown as BusabaseQueryUtils;
  const runner = new SiteRunner({ orpc, nodeId: "node-1" });
  const onReady = vi.fn<(path: string) => void>();
  runner.onReady(onReady);
  return { call, runner, onReady, readState };
};

describe("SiteRunner", () => {
  it("changes the iframe address when a later run deploys a new version", async () => {
    const { call, runner, onReady } = createRunner();
    call.mockResolvedValueOnce(deployed("version-1")).mockResolvedValueOnce(deployed("version-2"));

    await runner.start();
    await runner.stop();
    await runner.start();

    const first = onReady.mock.calls[0]?.[0];
    const second = onReady.mock.calls[1]?.[0];
    expect(first).not.toBe(second);
    expect(first).toBe("/api/airapp-preview/node-1/?__busabase_site_version=version-1");
    expect(second).toBe("/api/airapp-preview/node-1/?__busabase_site_version=version-2");
    expect(call).toHaveBeenNthCalledWith(1, { nodeId: "node-1" });
    expect(call).toHaveBeenNthCalledWith(2, { nodeId: "node-1" });
  });

  it("preserves the preview path, query and fragment while encoding its version", async () => {
    const { call, runner, onReady } = createRunner();
    call.mockResolvedValue(
      deployed("version & 2", "/api/airapp-preview/node-1/?theme=dark#summary"),
    );

    await runner.start();

    const path = onReady.mock.calls[0]?.[0];
    expect(path).toBe(
      "/api/airapp-preview/node-1/?theme=dark&__busabase_site_version=version+%26+2#summary",
    );
  });

  it("does not open an address for a blocked deployment", async () => {
    const { call, runner, onReady } = createRunner();
    const result = deployed("version-1");
    result.outcome = "blocked";
    result.state.blockers = [{ code: "not-a-site-app" }];
    call.mockResolvedValue(result);

    await expect(runner.start()).rejects.toBeInstanceOf(AirAppSiteBlockedError);
    expect(onReady).not.toHaveBeenCalled();
  });

  it("does not open a preview when its runner was disposed during deployment", async () => {
    const { call, runner, onReady } = createRunner();
    let complete!: (result: AirAppSiteActionVO) => void;
    call.mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );

    const started = runner.start();
    runner.dispose();
    complete(deployed("version-1"));
    await started;

    expect(onReady).not.toHaveBeenCalled();
  });
  it.each([
    { previewVersion: null, previewUrl: null },
    { previewStale: true },
    { previewEnvironmentStale: true },
  ])("does not upload a Vault preview that needs preparation: %j", async (changes) => {
    const { call, runner, onReady, readState } = createRunner();
    readState.mockResolvedValue({
      ...deployed("current").state,
      ...changes,
      environmentDeploymentLock: { reason: "SPACE_VAULT_MANAGE_REQUIRED" },
    });
    await expect(runner.start()).rejects.toMatchObject({ denial: "space-vault-manage" });
    expect(call).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
  });
  it("reuses a prepared Vault preview despite the deployment lock", async () => {
    const { call, runner, onReady, readState } = createRunner();
    readState.mockResolvedValue({
      ...deployed("current").state,
      environmentDeploymentLock: { reason: "SPACE_VAULT_MANAGE_REQUIRED" },
    });
    call.mockResolvedValue(deployed("current"));

    await runner.start();

    expect(call).toHaveBeenCalledExactlyOnceWith({ nodeId: "node-1" });
    expect(onReady).toHaveBeenCalledExactlyOnceWith(
      "/api/airapp-preview/node-1/?__busabase_site_version=current",
    );
  });
  it("classifies a permission change after a successful preflight without retrying", async () => {
    const { call, runner, onReady } = createRunner();
    call.mockRejectedValue(
      new ORPCError("FORBIDDEN", { data: { reason: "SPACE_VAULT_MANAGE_REQUIRED" } }),
    );
    await expect(runner.start()).rejects.toMatchObject({ denial: "space-vault-manage" });
    expect(call).toHaveBeenCalledTimes(1);
    expect(onReady).not.toHaveBeenCalled();
  });
});
