#!/usr/bin/env node
import { existsSync } from "node:fs";

const builtCli = new URL("../dist/cli.js", import.meta.url);
const programmaticEntry = new URL("../dist/index.js", import.meta.url);
const delegatedArgvJson = process.env.BUSABASE_CLI_DELEGATED_ARGV;

if (!existsSync(builtCli)) {
  console.error(
    "busabase-cli: built CLI entry is missing.\n" +
      "If you are running from source, build it first:\n" +
      "  pnpm --filter busabase-cli build\n\n" +
      "For one-off npm usage, prefer:\n" +
      "  npm exec -y --package busabase-cli@latest -- busabase-cli <command>\n",
  );
  process.exit(1);
}

try {
  if (delegatedArgvJson) {
    delete process.env.BUSABASE_CLI_DELEGATED_ARGV;
    const { runCli } = await import(programmaticEntry.href);
    const delegatedArgv = JSON.parse(delegatedArgvJson);
    if (!Array.isArray(delegatedArgv) || delegatedArgv.some((arg) => typeof arg !== "string")) {
      throw new Error("BUSABASE_CLI_DELEGATED_ARGV must be a JSON string array.");
    }
    const delegatedExit = await runCli(delegatedArgv);
    // process.exit() drops whatever stdout has not flushed, and stdout is async when
    // it is a pipe — so a large `--output json` body would arrive truncated at one
    // pipe buffer. Inlined rather than imported from dist: this file is the entry
    // point and must keep working even when dist is mid-build. See src/flush-stdio.ts.
    for (const stream of [process.stdout, process.stderr]) {
      if (stream.writableLength > 0) await new Promise((done) => stream.write("", done));
    }
    process.exit(delegatedExit);
  }
  await import(builtCli.href);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("busabase-sdk") && message.includes("dist/index.js")) {
    console.error(
      "busabase-cli: busabase-sdk is not built.\n" +
        "If you are running from source, build the SDK first:\n" +
        "  pnpm --filter busabase-sdk build\n\n" +
        "For one-off npm usage, prefer:\n" +
        "  npm exec -y --package busabase-cli@latest -- busabase-cli <command>\n",
    );
    process.exit(1);
  }
  throw error;
}
