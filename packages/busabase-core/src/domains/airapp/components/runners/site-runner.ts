"use client";

import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { SiteBundleBlocker } from "../../utils/site-bundle";
import type { AirAppMountedFile, AirAppRunner } from "./types";

/** The app's files cannot go up. Carries codes, so the panel can word them in the viewer's locale. */
export class AirAppSiteBlockedError extends Error {
  readonly blockers: SiteBundleBlocker[];

  constructor(blockers: SiteBundleBlocker[]) {
    super(`This app cannot deploy as a site: ${blockers.map((item) => item.code).join(", ")}`);
    this.blockers = blockers;
  }
}

/**
 * Run on the `site` engine: bring the members-only preview up to date.
 *
 * There is nothing to install or start, and nothing to mount: the server reads
 * the node's own files. Running with unchanged files uploads nothing, which is
 * why opening a node can "run" it without cost.
 */
export class SiteRunner implements AirAppRunner {
  private readonly orpc: BusabaseQueryUtils;
  private readonly nodeId: string;
  private logCallback: ((line: string) => void) | null = null;
  private readyCallback: ((previewPath: string) => void) | null = null;
  private disposed = false;

  constructor(context: { orpc: BusabaseQueryUtils; nodeId: string }) {
    this.orpc = context.orpc;
    this.nodeId = context.nodeId;
  }

  async mount(_files: Record<string, AirAppMountedFile>): Promise<void> {}

  async install(): Promise<void> {}

  async start(): Promise<void> {
    this.logCallback?.("[busabase] deploying a preview of this site\n");
    const { outcome, state } = await this.orpc.airapps.siteDeployPreview.call({
      nodeId: this.nodeId,
    });
    if (this.disposed) return;
    if (outcome === "blocked") throw new AirAppSiteBlockedError(state.blockers);
    if (!state.previewUrl) throw new Error("The server reported a preview with no address.");
    if (!state.previewVersion) throw new Error("The server reported a preview with no version.");
    this.logCallback?.(`[busabase] preview ready, version ${state.previewVersion}\n`);
    // The preview path stays the same after a deploy. Include the deployed
    // version so an existing iframe navigates to the bytes this run uploaded.
    const previewUrl = new URL(state.previewUrl, "http://busabase.invalid");
    previewUrl.searchParams.set("__busabase_site_version", state.previewVersion);
    this.readyCallback?.(`${previewUrl.pathname}${previewUrl.search}${previewUrl.hash}`);
  }

  onLog(cb: (line: string) => void): void {
    this.logCallback = cb;
  }

  onReady(cb: (previewPath: string) => void): void {
    this.readyCallback = cb;
  }

  /** A deployed site never exits on its own. */
  onExit(_cb: (code: number | null) => void): void {}

  /** The preview stays deployed: it is not a process, and the next run reuses it. */
  async stop(): Promise<void> {}

  dispose(): void {
    this.disposed = true;
  }
}
