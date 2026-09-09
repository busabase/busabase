/**
 * A node's scenario prompts are what tell the person who installs a package what
 * THIS app is for. They live in their own column with their own route (they are
 * deliberately absent from `nodes.list`), so export has to ask for them per node
 * — and must survive a server that cannot answer.
 */

import { PACKAGE_FORMAT, type PackageManifest } from "busabase-contract/domains/package/types";
import { describe, expect, it } from "vitest";
import type { PackageClient } from "./client";
import { collectPackageTree, type SourceNode } from "./collect";

const manifest = (): PackageManifest => ({
  format: PACKAGE_FORMAT,
  name: "crm",
  description: "",
  tags: [],
});

const PROMPTS = [{ key: "log-visit", label: "Log a visit", body: "Add a visit to {target}." }];

const root: SourceNode = {
  id: "nod-crm",
  slug: "crm",
  name: "CRM",
  type: "folder",
  description: "",
  position: 0,
  children: [
    { id: "nod-guide", slug: "guide", name: "Guide", type: "doc", description: "", position: 0 },
    { id: "nod-notes", slug: "notes", name: "Notes", type: "doc", description: "", position: 1 },
  ],
};

const stubClient = (
  getAgentPrompts: (input: { nodeId: string }) => Promise<{ agentPrompts: unknown }>,
): PackageClient =>
  ({
    nodes: {
      get: async () => ({ type: "doc", body: "" }),
      getAgentPrompts,
    },
  }) as unknown as PackageClient;

const collect = async (client: PackageClient) => {
  const warnings: string[] = [];
  const tree = await collectPackageTree(client, root, {
    manifest: manifest(),
    warn: (message) => warnings.push(message),
    baseUrl: "http://localhost",
  });
  return { tree, warnings };
};

describe("collecting a node's agent prompts", () => {
  it("carries them into the package", async () => {
    const { tree, warnings } = await collect(
      stubClient(async ({ nodeId }) => ({
        agentPrompts: nodeId === "nod-guide" ? PROMPTS : null,
      })),
    );

    expect(tree.nodes[0]).toMatchObject({ slug: "guide", agentPrompts: PROMPTS });
    // `null` means "never set" — the node carries no key at all rather than an
    // empty list, so the package looks identical to one written before the field.
    expect(tree.nodes[1]).not.toHaveProperty("agentPrompts.0");
    expect(warnings).toEqual([]);
  });

  it("treats an empty list as none, so it does not round-trip a key that changes nothing", async () => {
    const { tree } = await collect(stubClient(async () => ({ agentPrompts: [] })));

    expect(tree.nodes[0]).not.toHaveProperty("agentPrompts.0");
  });

  it("warns once and keeps exporting when the server cannot answer", async () => {
    // A server predating the route fails on every node; one warning is as
    // informative as fifty.
    const { tree, warnings } = await collect(
      stubClient(async () => {
        throw new Error("no such route");
      }),
    );

    expect(tree.nodes).toHaveLength(2);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("no such route");
  });
});
