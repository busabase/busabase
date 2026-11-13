import { implement } from "@orpc/server";
import { busabaseContract } from "busabase-contract/contract/busabase";
import { exportAssetAttachment } from "./logic/asset-attachment-backup";
import {
  exportAssetTextBlob,
  exportAttachmentBlob,
  exportDocBodies,
  exportTableRows,
} from "./logic/export-logic";
import { exportSnapshot } from "./logic/export-snapshot";
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
  exportSnapshot: os.dump.exportSnapshot.handler(({ input, signal }) =>
    exportSnapshot(input, { signal }),
  ),
  exportAssetAttachment: os.dump.exportAssetAttachment.handler(({ input }) =>
    exportAssetAttachment(input),
  ),
  exportTables: os.dump.exportTables.handler(async ({ input }) => exportTableRows(input)),
  exportAttachment: os.dump.exportAttachment.handler(async ({ input }) =>
    exportAttachmentBlob(input),
  ),
  exportAssetText: os.dump.exportAssetText.handler(async ({ input }) => exportAssetTextBlob(input)),
  exportDocBodies: os.dump.exportDocBodies.handler(async ({ input }) => exportDocBodies(input)),
  importBegin: os.dump.importBegin.handler(async ({ input }) => beginImportSession(input)),
  importTables: os.dump.importTables.handler(async ({ input }) => importTableRows(input)),
  importCommit: os.dump.importCommit.handler(async ({ input }) =>
    commitImportSession(input.sessionId),
  ),
  importAbort: os.dump.importAbort.handler(async ({ input }) =>
    abortImportSession(input.sessionId),
  ),
};
