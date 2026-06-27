/**
 * run-all: Run the full Busabase OpenAPI demo suite in sequence.
 *
 * Each script exercises a domain's full CRUD + CR lifecycle:
 *   01 Folders    — GET /folders, /nodes (read the seeded tree)
 *   02 Bases      — POST /bases (idempotent), GET /bases, add fields
 *   03 Records    — create → approve → merge → update → delete
 *   04 Views      — create → update → delete via CR workflow
 *   05 Docs       — create, direct update, CR-based update
 *   06 Skills     — create, read files, file CR, metadata CR
 *   07 Change CRs — list, get, close
 *   08 Nodes      — folder create/rename/move/delete via CR
 *   09 Search     — GET /search across all domains
 *   10 Audit      — GET /audit-events, POST audit event
 *
 * Usage:
 *   BUSABASE_URL=http://localhost:15419 pnpm exec tsx scripts/demo/run-all.ts
 *
 * Run individual suites:
 *   BUSABASE_URL=http://localhost:15419 pnpm exec tsx scripts/demo/03-records.ts
 */

import { BASE } from "./_client";
import { run as run01 } from "./01-folders";
import { run as run02 } from "./02-bases";
import { run as run03 } from "./03-records";
import { run as run04 } from "./04-views";
import { run as run05 } from "./05-docs";
import { run as run06 } from "./06-skills";
import { run as run07 } from "./07-change-requests";
import { run as run08 } from "./08-nodes";
import { run as run09 } from "./09-search";
import { run as run10 } from "./10-audit";

const SUITES = [
  { name: "01-folders", run: run01 },
  { name: "02-bases", run: run02 },
  { name: "03-records", run: run03 },
  { name: "04-views", run: run04 },
  { name: "05-docs", run: run05 },
  { name: "06-skills", run: run06 },
  { name: "07-change-requests", run: run07 },
  { name: "08-nodes", run: run08 },
  { name: "09-search", run: run09 },
  { name: "10-audit", run: run10 },
];

async function main() {
  console.log(`\n🚀  Busabase OpenAPI Demo Suite  →  ${BASE}\n`);
  console.log("  Runs the full CRUD + CR lifecycle across every domain.\n");
  console.log("  Data source: DEMO_* constants from busabase-core/demo/dataset.ts");
  console.log("  (same content the DB seed uses — just via REST instead of direct DB)\n");

  const totals = { pass: 0, fail: 0 };
  const failed: string[] = [];

  for (const suite of SUITES) {
    try {
      const { pass, fail } = await suite.run();
      totals.pass += pass;
      totals.fail += fail;
      if (fail > 0) failed.push(suite.name);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`\n💥  ${suite.name} crashed: ${msg}\n`);
      totals.fail++;
      failed.push(suite.name);
    }
  }

  console.log("\n" + "─".repeat(60));
  console.log(`\n  Total: ${totals.pass} passed, ${totals.fail} failed`);

  if (failed.length > 0) {
    console.log(`\n  Failed suites: ${failed.join(", ")}`);
    process.exit(1);
  } else {
    console.log("\n  ✅  All suites passed — OpenAPI surface is healthy.\n");
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\n💥  ${msg}\n`);
  process.exit(1);
});
