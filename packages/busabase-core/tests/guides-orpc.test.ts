import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { runWithBusabaseContext } from "../src/context";
import { guidesRouter } from "../src/domains/guides/router";

/**
 * The operating manual over REST.
 *
 * It used to exist only over MCP, so anything driving `/api/v1` — busabase-cli,
 * a script, a CI step — was told none of the approval-first rules an MCP client
 * receives on connect, and was then judged on whether it guessed them.
 *
 * This router is mounted by BOTH the self-hosted app and Cloud, which is why
 * the catalog is resolved per request: the two walkthroughs are onboarding
 * written around choosing a space, and the `workspace` reference must be built
 * with space targeting OFF on a single-workspace install or it teaches
 * `targetSpaceId`, an argument that server rejects.
 */
const client = createRouterClient(guidesRouter);

/** No `spaceId` in context is exactly how the open-source app runs. */
const selfHosted = <T>(fn: () => Promise<T>) => runWithBusabaseContext({}, fn);
const cloud = <T>(fn: () => Promise<T>) => runWithBusabaseContext({ spaceId: "org_1" }, fn);

describe("guides — self-hosted", () => {
  it("serves the two references and withholds the space-shaped walkthroughs", async () => {
    const catalog = await selfHosted(() => client.list());
    expect(catalog.map((entry) => entry.topic)).toEqual(["workspace", "airapp"]);
  });

  it("does not teach targetSpaceId, which this deployment rejects", async () => {
    const guide = await selfHosted(() => client.read({ topic: "workspace" }));
    expect(guide.content).not.toContain("targetSpaceId");
    expect(guide.content.length).toBeGreaterThan(1000);
  });

  it("refuses a Cloud-only topic and names the ones it does serve", async () => {
    await expect(selfHosted(() => client.read({ topic: "setup" }))).rejects.toThrow(
      /Unknown guide topic "setup"\. Available: workspace, airapp\./,
    );
  });

  it("points at the other topics so one call is enough to keep going", async () => {
    const guide = await selfHosted(() => client.read({ topic: "airapp" }));
    expect(guide.otherTopics).toEqual(["workspace"]);
    expect(guide.kind).toBe("reference");
  });
});

describe("guides — Cloud", () => {
  it("also serves the two guided walkthroughs", async () => {
    const catalog = await cloud(() => client.list());
    expect(catalog.map((entry) => entry.topic)).toEqual([
      "workspace",
      "airapp",
      "setup",
      "create-app",
    ]);
    expect(catalog.find((entry) => entry.topic === "setup")?.kind).toBe("walkthrough");
  });

  it("keeps the space-targeting section the self-hosted build strips", async () => {
    const guide = await cloud(() => client.read({ topic: "workspace" }));
    expect(guide.content).toContain("targetSpaceId");
  });
});

describe("guides — the catalog is answerable without fetching every document", () => {
  it("carries a summary per topic", async () => {
    for (const entry of await selfHosted(() => client.list())) {
      expect(entry.summary.length).toBeGreaterThan(20);
      expect(entry.title.length).toBeGreaterThan(0);
    }
  });
});
