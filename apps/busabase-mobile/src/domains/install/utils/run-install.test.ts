import type {
  InstallEventVO,
  InstallFromGithubDTO,
  InstallResultVO,
} from "busabase-contract/domains/install/types";
import { describe, expect, it, vi } from "vitest";
import { type InstallClient, runInstall } from "./run-install";

/**
 * What a server that predates a route actually sends, verified against a
 * running one: an oRPC error carrying the CODE, not merely the wording.
 */
const missingRoute = () =>
  Object.assign(new Error("Not Found"), { code: "NOT_FOUND", status: 404 });

const input = { repoUrl: "https://github.com/busabase/templates", rename: false, autoMerge: false };

const result = { targetFolderSlug: "b2b-crm" } as unknown as InstallResultVO;

const stream = (...events: InstallEventVO[]): AsyncIterable<InstallEventVO> => ({
  async *[Symbol.asyncIterator]() {
    for (const event of events) yield event;
  },
});

const progress = (message: string): InstallEventVO => ({ kind: "progress", message });
const done = (): InstallEventVO => ({ kind: "done", result });

const stubClient = (overrides: Partial<InstallClient> = {}): InstallClient => ({
  fromGithubStream: vi.fn(async () => stream(done())),
  fromGithub: vi.fn(async () => result),
  ...overrides,
});

const options = (onProgress = vi.fn()) => ({
  onProgress,
  incompleteMessage: "Could not install the package.",
});

describe("runInstall", () => {
  it("streams instead of holding one silent request open", async () => {
    // The bug this pins: `fromGithub` writes no response bytes for the whole
    // install, so a gateway idle timeout closes the connection while the
    // install keeps running server-side. The user is told it failed on an
    // install that succeeded, and their retry collides with what it created.
    const client = stubClient();

    await expect(runInstall(client, input as InstallFromGithubDTO, options())).resolves.toBe(
      result,
    );
    expect(client.fromGithubStream).toHaveBeenCalledWith(input);
    expect(client.fromGithub).not.toHaveBeenCalled();
  });

  it("reports every progress line the server sends, in order", async () => {
    const onProgress = vi.fn();
    const client = stubClient({
      fromGithubStream: vi.fn(async () =>
        stream(progress("Pass 1/5 (fetch)"), progress("Pass 4/5 (sample records)"), done()),
      ),
    });

    await runInstall(client, input as InstallFromGithubDTO, options(onProgress));

    expect(onProgress.mock.calls.map(([line]) => line)).toEqual([
      "Pass 1/5 (fetch)",
      "Pass 4/5 (sample records)",
    ]);
  });

  it("falls back to the one-shot route on a server that has no streaming install", async () => {
    const client = stubClient({
      fromGithubStream: vi.fn(async () => {
        throw missingRoute();
      }),
    });

    await expect(runInstall(client, input as InstallFromGithubDTO, options())).resolves.toBe(
      result,
    );
    expect(client.fromGithub).toHaveBeenCalledWith(input);
  });

  it("does not replay a refused install on the legacy route", async () => {
    // A refusal means the server considered the request and said no. Retrying
    // it on `fromGithub` would run the install the stream route just declined —
    // the one case where a fallback could create real resources twice.
    const client = stubClient({
      fromGithubStream: vi.fn(async () => {
        throw new Error("Only a space admin can install a package");
      }),
    });

    await expect(runInstall(client, input as InstallFromGithubDTO, options())).rejects.toThrow(
      "Only a space admin can install a package",
    );
    expect(client.fromGithub).not.toHaveBeenCalled();
  });

  it("does not treat a repo that does not exist as a missing route", async () => {
    // Observed against a running server: a nonexistent GitHub repo answers
    // BAD_REQUEST/400 with a message reading "GitHub repo or ref not found:
    // acme/thing (HTTP 404)". Reading that as a missing route would replay the
    // install on the legacy route, which is about to fail identically.
    const client = stubClient({
      fromGithubStream: vi.fn(async () => {
        throw Object.assign(new Error("GitHub repo or ref not found: busabase/nope (HTTP 404)."), {
          code: "BAD_REQUEST",
          status: 400,
        });
      }),
    });

    await expect(runInstall(client, input as InstallFromGithubDTO, options())).rejects.toThrow(
      "GitHub repo or ref not found",
    );
    expect(client.fromGithub).not.toHaveBeenCalled();
  });

  it("fails loudly when the stream ends without a result", async () => {
    // A dropped connection mid-install. This client does not know the outcome,
    // so reporting success would be a lie — but the caller keeps the last
    // progress line, which the old silent timeout never produced.
    const onProgress = vi.fn();
    const client = stubClient({
      fromGithubStream: vi.fn(async () => stream(progress("Pass 3/5 (nodes)"))),
    });

    await expect(
      runInstall(client, input as InstallFromGithubDTO, options(onProgress)),
    ).rejects.toThrow("Could not install the package.");
    expect(onProgress).toHaveBeenLastCalledWith("Pass 3/5 (nodes)");
  });
});
