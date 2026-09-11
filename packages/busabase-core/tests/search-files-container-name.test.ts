import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";
import { seedScenario } from "./helpers/seed-scenario";

type RawClient = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

/**
 * A CONTAINER's name must not drag its whole contents into file search.
 *
 * `search-asset-content.test.ts` pins the case that SHOULD match: a `file`
 * node's own name is the file's visible name ("Finance upload" holding
 * `quarterly.txt`), so searching it has to find the file. That behaviour is
 * deliberate and stays.
 *
 * This file pins the opposite case. A Drive / Skill / AirApp is a container
 * whose name says nothing about any individual file inside it, so matching on
 * it returned every file the container held. Observed in a browser before this
 * fix: an AirApp called "Quokka Tracker" answered a search for "quokka" with
 * `client.js`, `style.css`, `package.json`, `index.html`, `server.js`,
 * `skill.json` and `SKILL.md` — seven rows of scaffolding, none containing the
 * query, every one of them navigating to the node already listed above them.
 */
describe("file search does not match a container node's name", () => {
  it("returns the AirApp itself but none of its unrelated scaffold files", async () => {
    await seedScenario("search-files-container-name");
    const raw: RawClient = createRouterClient(busabaseRouter);

    const created = await raw.fileTrees.create({
      type: "airapp",
      slug: "quokka-tracker",
      name: "Quokka Tracker",
      autoMerge: true,
    });
    expect(created.materialized).toBe(true);

    // The scaffold really is in there — otherwise this test would pass for the
    // wrong reason (nothing to match rather than nothing matched).
    const files = await raw.fileTrees.listFiles({ nodeId: "quokka-tracker", type: "airapp" });
    expect(files.length).toBeGreaterThan(1);
    expect(files.every((file) => !file.path.toLowerCase().includes("quokka"))).toBe(true);

    const fileHits = await raw.search({ query: "quokka", sources: ["files"], limit: 50 });
    const titles = fileHits.results.map((result) => result.title);

    // `style.css` and `server.js` are fixed scaffold constants with no
    // interpolation — the query appears nowhere in them, and they were only
    // ever returned because their CONTAINER is called "Quokka Tracker".
    expect(titles).not.toContain("style.css");
    expect(titles).not.toContain("server.js");

    // `index.html` and `package.json` are templated with the app's name and
    // slug, so they genuinely contain the query. Those are real content matches
    // and must survive — narrowing the container rule must not be mistaken for
    // "return fewer files".
    expect(titles).toEqual(expect.arrayContaining(["index.html", "package.json"]));

    // …while the node itself is still perfectly findable by name, through the
    // path that owns that job.
    const byName = await raw.nodes.searchByName({ query: "quokka" });
    expect(byName.some((node) => node.slug === "quokka-tracker")).toBe(true);
  });

  // The other side of the same line. A Drive is where a person puts documents,
  // so "what is in my Finance Drive" is a real question and the drive's name is
  // the only handle on it — `search-text-convergence.test.ts` already depends on
  // this, and it must not be collateral damage of the AirApp/Skill narrowing.
  it("still matches a Drive's name against the documents inside it", async () => {
    await seedScenario("search-files-drive-name");
    const raw: RawClient = createRouterClient(busabaseRouter);

    await raw.fileTrees.create({
      type: "drive",
      slug: "finance-drive",
      name: "Finance Drive",
      autoMerge: true,
      files: [{ path: "contract.md", content: "nothing relevant in the body" }],
    });

    const hits = await raw.search({ query: "Finance Drive", sources: ["files"], limit: 20 });
    expect(hits.results.map((result) => result.title)).toContain("contract.md");
  });

  it("still finds a file inside a container when the FILE's own name matches", async () => {
    await seedScenario("search-files-container-name-own");
    const raw: RawClient = createRouterClient(busabaseRouter);

    await raw.fileTrees.create({
      type: "drive",
      slug: "boring-drive",
      name: "Boring Drive",
      autoMerge: true,
      files: [{ path: "quokka-report.md", content: "nothing relevant in the body" }],
    });

    const hits = await raw.search({ query: "quokka-report", sources: ["files"], limit: 20 });
    expect(hits.results.length).toBeGreaterThan(0);
  });
});
