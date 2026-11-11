/** Disposable HTTP host for the process-restart multipart regression. */
import { createServer } from "node:http";
import { ORPCError } from "@orpc/server";
import {
  ImportBeginInputSchema,
  ImportTablesInputSchema,
} from "busabase-contract/domains/dump/types";
import { runWithBusabaseContext } from "../../src/context";
import {
  abortImportSession,
  beginImportSession,
  commitImportSession,
  importTableRows,
} from "../../src/domains/dump/logic/import-logic";

const server = createServer(async (request, response) => {
  try {
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of request) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += bytes.length;
      if (length > 10 * 1024 * 1024)
        throw new Error("Test request exceeded the bounded part envelope");
      chunks.push(bytes);
    }
    const input = length > 0 ? JSON.parse(Buffer.concat(chunks, length).toString("utf8")) : {};
    const spaceId = request.headers["x-busabase-space"] as string;
    const result = await runWithBusabaseContext({ spaceId, isSpaceManager: true }, async () => {
      switch (request.url) {
        case "/api/v1/dump/import/begin":
          return beginImportSession(ImportBeginInputSchema.parse(input));
        case "/api/v1/dump/import/tables":
          return importTableRows(ImportTablesInputSchema.parse(input));
        case "/api/v1/dump/import/abort":
          return abortImportSession(input.sessionId);
        case "/api/v1/dump/import/commit":
          return commitImportSession(input.sessionId);
        default:
          throw new Error("Unknown test route");
      }
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(result));
  } catch (error) {
    response.writeHead(error instanceof ORPCError ? error.status : 500, {
      "content-type": "application/json",
    });
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
});
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (address && typeof address === "object")
    process.stdout.write(`DUMP_PARTS_READY ${address.port}\n`);
});
process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
