import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";

/**
 * drizzle-busabase against a REAL Busabase server, over real HTTP, through the
 * real SDK — the only configuration in which "did the push-down actually
 * happen?" can be answered.
 *
 * It exists because of a specific failure. An earlier round of this work sent
 * filters the server silently DISCARDED (they carried no `fieldType`, and
 * `buildPushableRecordFilter` starts by reading one), so every query returned
 * the whole Base and then filtered locally. Every result was correct, so every
 * test stayed green, and the driver was doing nothing. The only thing that
 * would have caught it is counting the records that came back — which is what
 * the client script does.
 *
 * OPT-IN, via `BUSABASE_E2E_DRIZZLE=1`, because it needs drizzle-busabase's
 * `dist/` built (it drives the published artifact, not the source) and spawns a
 * second process. Ordinary CI covers the same contract at two cheaper layers:
 * records-value-filters-openapi.test.ts for the HTTP boundary, and the driver's
 * own suite for the push-down decisions against a fake server.
 *
 *   cd packages/busabase-orm-core && npm run build
 *   cd ../drizzle-busabase && npm run build
 *   cd ../busabase-core && BUSABASE_E2E_DRIZZLE=1 npx vitest run tests/e2e-drizzle.test.ts
 */

const ENABLED = process.env.BUSABASE_E2E_DRIZZLE === "1";
const DRIZZLE_DIR = path.resolve(__dirname, "../../drizzle-busabase");
const STAGES = ["won", "lost", "open"];
const FIRMS = ["acme", "zeta", "orion"];

describe.skipIf(!ENABLED)("drizzle-busabase against a real Busabase server", () => {
  it("agrees with a local oracle on every query, and pushes down what it claims to", async () => {
    expect(
      existsSync(path.join(DRIZZLE_DIR, "dist/index.js")),
      "build drizzle-busabase (and busabase-orm-core) first — this drives dist/, not src/",
    ).toBe(true);

    // The migrator resolves its folder from process.cwd(), as every other
    // integration test in this package does.
    const originalCwd = process.cwd();
    process.chdir(path.resolve(__dirname, "../../../apps/busabase"));
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "e2e-drizzle-db-"));
    const storageDir = await mkdtemp(path.join(os.tmpdir(), "e2e-drizzle-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;

    const { busabaseRouter } = await import("../src/router");
    const client = createRouterClient(busabaseRouter) as never as {
      bases: {
        create: (input: unknown) => Promise<{ id: string }>;
        createChangeRequest: (input: unknown) => Promise<unknown>;
      };
    };

    const base = await client.bases.create({
      slug: "contacts",
      name: "Contacts",
      fields: [
        { slug: "name", name: "Name", type: "text", required: true, options: {} },
        {
          slug: "stage",
          name: "Stage",
          type: "select",
          required: false,
          options: { choices: STAGES.map((name, index) => ({ id: `c${index}`, name })) },
        },
        { slug: "score", name: "Score", type: "number", required: false, options: {} },
        { slug: "done", name: "Done", type: "checkbox", required: false, options: {} },
        { slug: "firm", name: "Firm", type: "text", required: false, options: {} },
      ],
      autoMerge: true,
    });

    // A second Base, so the join has a real lookup table on the other side.
    const companies = await client.bases.create({
      slug: "companies",
      name: "Companies",
      fields: [
        { slug: "code", name: "Code", type: "text", required: true, options: {} },
        { slug: "city", name: "City", type: "text", required: false, options: {} },
      ],
      autoMerge: true,
    });

    for (const [index, code] of FIRMS.entries()) {
      await client.bases.createChangeRequest({
        baseId: companies.id,
        fields: { code, city: ["NY", "LA", "SF"][index] },
        message: "seed",
        autoMerge: true,
      });
    }
    // One extra company nothing points at, so an inner join has something to drop.
    await client.bases.createChangeRequest({
      baseId: companies.id,
      fields: { code: "orphan", city: "nowhere" },
      message: "seed",
      autoMerge: true,
    });

    // 200 records: enough that "did the server filter?" is visible in the
    // transfer count rather than being a rounding difference.
    for (let index = 0; index < 200; index += 1) {
      await client.bases.createChangeRequest({
        baseId: base.id,
        fields: {
          name: `p${String(index).padStart(3, "0")}`,
          stage: STAGES[index % 3],
          score: index,
          done: index % 2 === 0,
          // Every 7th contact has no firm, so an inner join has rows to drop
          // and an outer join has unmatched rows to keep.
          ...(index % 7 === 0 ? {} : { firm: FIRMS[index % 3] }),
        },
        message: "seed",
        autoMerge: true,
      });
    }

    const handler = new OpenAPIHandler(busabaseRouter);
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const request = new Request(`http://127.0.0.1${req.url}`, {
        method: req.method,
        headers: req.headers as never,
        body: chunks.length ? Buffer.concat(chunks) : undefined,
      });
      const result = await handler.handle(request, { context: {} });
      if (!result.matched) {
        res.writeHead(404).end("no route");
        return;
      }
      res.writeHead(result.response.status, { "content-type": "application/json" });
      res.end(await result.response.text());
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;

    const child = spawn("npx", ["tsx", "./e2e-client.mts", String(port)], {
      cwd: DRIZZLE_DIR,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    const code: number = await new Promise((resolve) => child.on("close", resolve));

    await new Promise((resolve) => server.close(resolve));
    process.chdir(originalCwd);
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    await rm(dataDir, { recursive: true, force: true });
    await rm(storageDir, { recursive: true, force: true });

    console.log(output);
    expect(code, output).toBe(0);
  }, 600_000);
});
