#!/usr/bin/env node
import { runCli } from "./run.js";

process.exit(await runCli(process.argv.slice(2)));
