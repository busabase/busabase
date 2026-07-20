import { implement } from "@orpc/server";
import { busabaseContract } from "busabase-contract/contract/busabase";
import { exportAssetTextBlob, exportTableRows } from "./logic/export-logic";
import {
  abortImportSession,
  beginImportSession,
  commitImportSession,
  importTableRows,
} from "./logic/import-logic";

// Dump domain oRPC handler slice — full-fidelity raw-row export/import used by
// the busabase-dump CLI package. Thin handlers only; all DB/storage work lives
// in logic/. Aggregated into the kernel router (router.ts).
const os = implement(busabaseContract);

export const dumpRouter = {
  exportTables: os.dump.exportTables.handler(async ({ input }) => exportTableRows(input)),
  exportAssetText: os.dump.exportAssetText.handler(async ({ input }) => exportAssetTextBlob(input)),
  importBegin: os.dump.importBegin.handler(async () => beginImportSession()),
  importTables: os.dump.importTables.handler(async ({ input }) => importTableRows(input)),
  importCommit: os.dump.importCommit.handler(async ({ input }) =>
    commitImportSession(input.sessionId),
  ),
  importAbort: os.dump.importAbort.handler(async ({ input }) =>
    abortImportSession(input.sessionId),
  ),
};
