/**
 * What installing a TEMPLATE does that installing a plain package does not:
 * stamp ownership, land the root skill as a Skill node, prefix Base slugs, and
 * merge the author's sample rows while leaving executable content in review.
 *
 * Every assertion here is about a promise made to one of two people: the user
 * who expects a working app (samples, skill, app opens), or the author of the
 * OTHER door — a skill's own `setup.mjs`, which must recognise these nodes as
 * its own rather than as a stranger's.
 */

import {
  APP_ROOT_RESOURCE_KEY,
  TEMPLATE_SKILL_METADATA_KEY,
} from "busabase-contract/domains/package/template";
import { PACKAGE_FORMAT } from "busabase-contract/domains/package/types";
import { describe, expect, it } from "vitest";
import { applyInstall } from "./apply";
import type { PackageClient } from "./client";
import { type PackageFiles, readPackageTree } from "./layout-read";
import { buildInstallPlan } from "./plan";

interface Call {
  method: string;
  input: Record<string, unknown>;
}

const createFakeServer = () => {
  const calls: Call[] = [];
  let seq = 0;
  const bulkSizes = new Map<string, number>();
  const record = (method: string, input: unknown) => {
    calls.push({ method, input: input as Record<string, unknown> });
  };

  const client = {
    nodes: {
      list: async () => [],
      createChangeRequest: async (input: unknown) => {
        record("nodes.createChangeRequest", input);
        return { id: `crq_${++seq}`, operations: [{ nodeId: `nod_${++seq}` }] };
      },
      updateMetadata: async (input: unknown) => {
        record("nodes.updateMetadata", input);
        return { id: (input as { nodeId: string }).nodeId };
      },
    },
    bases: {
      list: async () => [],
      create: async (input: unknown) => {
        record("bases.create", input);
        const typed = input as { fields?: { slug: string }[] };
        return {
          materialized: true as const,
          id: `bse_${++seq}`,
          nodeId: `nod_${++seq}`,
          fields: (typed.fields ?? []).map((field) => ({ id: `bsf_${++seq}`, slug: field.slug })),
        };
      },
      createBulkChangeRequest: async (input: unknown) => {
        record("bases.createBulkChangeRequest", input);
        const id = `crq_${++seq}`;
        bulkSizes.set(id, (input as { records: unknown[] }).records.length);
        return { id };
      },
    },
    fileTrees: {
      create: async (input: unknown) => {
        record("fileTrees.create", input);
        return { materialized: true as const, node: { id: `nod_${++seq}` } };
      },
    },
    views: { changeRequest: async () => ({ id: `crq_${++seq}`, materialized: true as const }) },
    docs: { create: async () => ({ materialized: true as const, node: { id: `nod_${++seq}` } }) },
    changeRequests: {
      review: async (input: unknown) => {
        const [changeRequestId] = (input as { changeRequestIds: string[] }).changeRequestIds;
        return {
          results: [{ changeRequestId, ok: true as const, changeRequest: { id: changeRequestId } }],
        };
      },
      merge: async (input: unknown) => {
        record("changeRequests.merge", input);
        const [changeRequestId] = (input as { changeRequestIds: string[] }).changeRequestIds;
        return {
          results: [
            {
              changeRequestId,
              ok: true as const,
              changeRequest: {
                operations: Array.from(
                  { length: bulkSizes.get(changeRequestId) ?? 0 },
                  (_, index) => ({
                    operation: "record_create",
                    position: index,
                    mergedRecordId: `rec_${++seq}`,
                  }),
                ),
              },
            },
          ],
        };
      },
    },
  };
  return { calls, client: client as unknown as PackageClient };
};

const SKILL_MD = `---
name: kelly-email
description: Inbox triage desk.
metadata:
  busabase:
    template: true
    resources:
      - reviews
---

# Kelly Email
`;

const files = (overrides: Record<string, string | null> = {}): PackageFiles => {
  const base: Record<string, string> = {
    "SKILL.md": SKILL_MD,
    "busabase.json": JSON.stringify({
      format: PACKAGE_FORMAT,
      name: "kelly-email",
      description: "Inbox triage desk",
      version: "1.2.0",
      template: { category: "email", airapp: "kelly-email-app", schemaVersion: 3 },
    }),
    "content/reviews/base.json": JSON.stringify({
      name: "Email Reviews",
      fields: [{ slug: "subject", name: "Subject", type: "text", position: 0 }],
    }),
    "content/reviews/records.ndjson": `${JSON.stringify({ key: "r1", fields: { subject: "Hi" } })}\n`,
    "content/kelly-email-app/_node.json": JSON.stringify({ type: "airapp", name: "Kelly Email" }),
    "content/kelly-email-app/package.json": JSON.stringify({ scripts: { dev: "node server.js" } }),
  };
  const map: PackageFiles = new Map();
  for (const [path, contents] of Object.entries({ ...base, ...overrides })) {
    if (contents !== null) map.set(path, Buffer.from(contents, "utf8"));
  }
  return map;
};

const emptyTarget = {
  targetFolder: undefined,
  existingNodeSlugsByType: new Map<string, Set<string>>(),
};

const install = async (
  overrides: Record<string, string | null> = {},
  applyOptions: Parameters<typeof applyInstall>[2] = { autoMerge: false },
) => {
  const server = createFakeServer();
  const plan = buildInstallPlan(readPackageTree(files(overrides)), emptyTarget);
  const result = await applyInstall(server.client, plan, {
    now: () => "2026-08-23T00:00:00.000Z",
    ...applyOptions,
  });
  return { ...server, plan, result };
};

const callsTo = (calls: Call[], method: string) => calls.filter((call) => call.method === method);

describe("installing a template", () => {
  it("stamps the app's root Folder with the triple busabase-sdk looks for", async () => {
    const { calls } = await install();
    const folderCall = callsTo(calls, "nodes.createChangeRequest")[0];
    const operation = (folderCall.input.operations as Record<string, unknown>[])[0];
    expect(operation.metadata).toMatchObject({
      appId: "kelly-email",
      resourceKey: APP_ROOT_RESOURCE_KEY,
      schemaVersion: 3,
      version: "1.2.0",
      installedAt: "2026-08-23T00:00:00.000Z",
    });
  });

  it("records where the package came from, so an upgrade can be offered later", async () => {
    const { calls } = await install(
      {},
      {
        autoMerge: false,
        source: { repo: "busabase/skills", ref: "main", subdir: "skills/kelly-email" },
      },
    );
    const operation = (
      callsTo(calls, "nodes.createChangeRequest")[0].input.operations as Record<string, unknown>[]
    )[0];
    expect((operation.metadata as { source: unknown }).source).toEqual({
      repo: "busabase/skills",
      ref: "main",
      subdir: "skills/kelly-email",
    });
  });

  it("stamps each Base with the slug the PACKAGE declared, not the installed one", async () => {
    const { calls } = await install();
    const stamp = callsTo(calls, "nodes.updateMetadata").find(
      (call) => (call.input.metadata as { resourceKey?: string }).resourceKey === "reviews",
    );
    // The Base installs as `kelly-email-reviews`, but the app looks it up by
    // `reviews` — stamping the installed slug would make the same app in two
    // folders look like two different apps to its own code.
    expect(stamp).toBeDefined();
    expect(stamp?.input.metadata).toMatchObject({
      appId: "kelly-email",
      resourceKey: "reviews",
      schemaVersion: 3,
    });
    expect(callsTo(calls, "bases.create")[0].input.slug).toBe("kelly-email-reviews");
  });

  it("lands the root SKILL.md as a Skill node inside the folder", async () => {
    const { calls } = await install();
    const skill = callsTo(calls, "fileTrees.create").find((call) => call.input.type === "skill");
    expect(skill).toBeDefined();
    expect(skill?.input.slug).toBe("kelly-email");
    expect((skill?.input.files as { path: string }[]).map((file) => file.path)).toEqual([
      "SKILL.md",
    ]);
  });

  it("marks that Skill node so export lifts it back to the package root", async () => {
    const { calls } = await install();
    const skill = callsTo(calls, "fileTrees.create").find((call) => call.input.type === "skill");
    // Carried INLINE on the create, not applied afterwards: this install is
    // review-first, so the node does not exist yet — a post-hoc stamp would
    // never be applied at all, and the app would not recognise its own Skill
    // once the user merged it.
    expect(skill?.input.metadata).toMatchObject({
      appId: "kelly-email",
      [TEMPLATE_SKILL_METADATA_KEY]: true,
    });
  });

  it("stamps a file-tree node on the create itself, so review-first still lands it", async () => {
    const { calls } = await install();
    for (const call of callsTo(calls, "fileTrees.create")) {
      expect(call.input.metadata, `${call.input.slug} must carry its stamp`).toMatchObject({
        appId: "kelly-email",
        schemaVersion: 3,
      });
    }
  });

  it("merges the author's sample rows so the app is not empty on first open", async () => {
    const { calls, result } = await install();
    expect(callsTo(calls, "bases.createBulkChangeRequest")[0].input.autoMerge).toBe(true);
    expect(result.created.records).toBe(1);
  });

  it("still leaves the executable parts in review", async () => {
    const { calls } = await install();
    // The AirApp and the Skill are code — they follow the install's own
    // autoMerge (false here), never the sample-record exception.
    for (const call of callsTo(calls, "fileTrees.create")) {
      expect(call.input.autoMerge).toBe(false);
    }
  });

  it("can be told not to install samples, and then proposes them like any content", async () => {
    const { calls, result } = await install({}, { autoMerge: false, installSampleRecords: false });
    expect(callsTo(calls, "bases.createBulkChangeRequest")[0].input.autoMerge).toBe(false);
    expect(result.created.records).toBe(0);
    expect(result.pendingChangeRequests).toBeGreaterThan(0);
  });
});

describe("installing a plain package is unchanged", () => {
  const plainOverrides = {
    "SKILL.md": null,
    "busabase.json": JSON.stringify({ format: PACKAGE_FORMAT, name: "plain-kb" }),
  };

  it("stamps nothing and creates no Skill node", async () => {
    const { calls } = await install(plainOverrides);
    expect(callsTo(calls, "nodes.updateMetadata")).toHaveLength(0);
    expect(callsTo(calls, "fileTrees.create").some((call) => call.input.type === "skill")).toBe(
      false,
    );
  });

  it("keeps the author's Base slugs and holds records for review", async () => {
    const { calls, result } = await install(plainOverrides);
    expect(callsTo(calls, "bases.create")[0].input.slug).toBe("reviews");
    expect(callsTo(calls, "bases.createBulkChangeRequest")[0].input.autoMerge).toBe(false);
    expect(result.created.records).toBe(0);
  });
});
