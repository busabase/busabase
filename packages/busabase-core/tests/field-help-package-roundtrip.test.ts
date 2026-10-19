import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { PACKAGE_FORMAT } from "busabase-contract/domains/package/types";
import { applyInstall } from "busabase-package/apply";
import { collectPackageTree, findSourceNode } from "busabase-package/collect";
import { readPackageTree } from "busabase-package/layout-read";
import { writePackageTree } from "busabase-package/layout-write";
import { buildInstallPlan, resolveTargetState } from "busabase-package/plan";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { expect, it } from "vitest";
import { runWithBusabaseContext } from "../src/context";
import * as schema from "../src/db/schema";
import { busabaseRouter } from "../src/router";

it.skipIf(!process.env.FIELD_HELP_POSTGRES_URL)(
  "exports field guidance to disk and installs it into another PostgreSQL workspace without turning examples into values",
  async () => {
    const url = process.env.FIELD_HELP_POSTGRES_URL;
    if (!url) throw new Error("Set FIELD_HELP_POSTGRES_URL to the isolated acceptance database");
    const target = new URL(url);
    if (
      target.hostname !== "127.0.0.1" ||
      target.port !== "55439" ||
      target.pathname !== "/field_help_acceptance"
    )
      throw new Error("Refusing a non-acceptance database");
    const connection = postgres(url);
    const db = drizzle(connection, { schema });
    const client = createRouterClient(busabaseRouter);
    const prefix = `field_help_package_${Date.now()}`;
    const inSpace = <T>(spaceId: string, fn: () => Promise<T>) =>
      runWithBusabaseContext({ db, spaceId, actorId: "usr_demo_Busabase_0" }, fn);
    const directory = await mkdtemp(path.join(os.tmpdir(), "field-help-package-"));
    const help = { description: "客户签收的实际日期；尚未签收时留空。", example: "2026-10-14" };
    try {
      const base = await inSpace(`${prefix}_source`, () =>
        client.bases.create({
          slug: "delivery",
          name: "Delivery",
          autoMerge: true,
          fields: [
            { slug: "title", name: "Order", type: "text", required: true },
            {
              slug: "delivery_date",
              name: "Actual delivery date",
              type: "date",
              options: { help, date: { includeTime: false } },
            },
          ],
        }),
      );
      await inSpace(`${prefix}_source`, () =>
        client.bases.createChangeRequest({
          baseId: base.id,
          autoMerge: true,
          fields: { title: "Awaiting acceptance" },
        }),
      );
      const nodes = await inSpace(`${prefix}_source`, () => client.nodes.list({}));
      const root = findSourceNode(nodes, base.nodeId);
      const tree = await inSpace(`${prefix}_source`, () =>
        collectPackageTree(client, root, {
          manifest: {
            format: PACKAGE_FORMAT,
            name: "delivery-guidance",
            description: "Field guidance acceptance",
            tags: [],
            template: { category: "operations", schemaVersion: 1, agentPrompts: [], secrets: [] },
          },
          warn: (message) => {
            throw new Error(message);
          },
          baseUrl: "http://localhost:3109",
        }),
      );
      await writePackageTree(tree, directory);
      const files = new Map<string, Uint8Array>();
      const walk = async (relative: string) => {
        for (const entry of await readdir(path.join(directory, relative), {
          withFileTypes: true,
        })) {
          const name = path.join(relative, entry.name);
          if (entry.isDirectory()) await walk(name);
          else files.set(name, await readFile(path.join(directory, name)));
        }
      };
      await walk("");
      const parsed = readPackageTree(files);
      await inSpace(`${prefix}_target`, async () => {
        const state = await resolveTargetState(client, parsed.manifest.name);
        const plan = buildInstallPlan(parsed, state);
        expect(plan.collisions).toEqual([]);
        await applyInstall(client, plan, { autoMerge: true });
        const bases = await client.bases.list({});
        const installed = bases.find((item) =>
          item.fields.some((field) => field.slug === "delivery_date"),
        );
        expect(installed).toBeDefined();
        const field = installed?.fields.find((item) => item.slug === "delivery_date");
        expect(field?.options.help).toEqual(help);
        expect(field?.options.date).toEqual({ includeTime: false });
        const records = await client.records.list({ baseId: installed?.id });
        expect(records.records).toHaveLength(1);
        expect(records.records[0]?.headCommit.payload.title).toBe("Awaiting acceptance");
        expect([undefined, null, ""]).toContain(
          records.records[0]?.headCommit.payload.delivery_date,
        );
      });
    } finally {
      await connection.end();
      await rm(directory, { recursive: true, force: true });
    }
  },
  60_000,
);
