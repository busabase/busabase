#!/usr/bin/env node
import { pkgVersion, runCli } from "./run.js";
import { checkForUpdate } from "./update-check.js";

const exitCode = await runCli(process.argv.slice(2));

// stderr only — stdout is the contract a caller's `--output json` parses
// (see apps/busabase/content/spec/cli-agent-ergonomics.md), and a stray
// notice line would corrupt that.
const notice = await checkForUpdate("busabase-cli", pkgVersion());
if (notice) console.error(notice);

process.exit(exitCode);
