#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(root, "dist", "cli.js");
const binPath = path.join(root, "bin", "busabase-cli.mjs");

if (!existsSync(cliPath)) {
  throw new Error("dist/cli.js is missing. Run `pnpm run build` before publishing.");
}
if (!existsSync(binPath)) {
  throw new Error("bin/busabase-cli.mjs is missing. The package bin must be shippable.");
}

const help = execFileSync(process.execPath, [cliPath, "--help"], {
  cwd: root,
  encoding: "utf8",
});
const binHelp = execFileSync(process.execPath, [binPath, "--help"], {
  cwd: root,
  encoding: "utf8",
});
const createChangeRequestHelp = execFileSync(
  process.execPath,
  [cliPath, "bases", "create-change-request", "--help"],
  {
    cwd: root,
    encoding: "utf8",
  },
);

const required = [
  "nodes create-change-request --type <folder|base|skill|doc>",
  "bases create-change-request --base-id <id>",
  "records change-requests --record-id <id>",
  "change-requests list [--limit <n>]",
  "change-requests close --change-request-id <id>",
];

const forbidden = [
  "nodes create-draft",
  "bases create-draft",
  "records drafts",
  "drafts list",
  "drafts get",
  "drafts review",
  "drafts close",
  "drafts merge",
  "--draft-id",
];

const missing = required.filter((text) => !help.includes(text) || !binHelp.includes(text));
const stale = forbidden.filter((text) => help.includes(text) || binHelp.includes(text));

if (missing.length || stale.length) {
  throw new Error(
    [
      "busabase-cli help does not match the current Change Request command surface.",
      missing.length ? `Missing:\n${missing.map((text) => `  - ${text}`).join("\n")}` : "",
      stale.length ? `Stale:\n${stale.map((text) => `  - ${text}`).join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  );
}

const nestedRequired = [
  "Usage:",
  "busabase-cli bases create-change-request --base-id <id> --fields-json <json|@file>",
  "--submitted-by <name>",
];
const nestedForbidden = ["Commands:", "drafts", "--draft-id"];
const nestedMissing = nestedRequired.filter((text) => !createChangeRequestHelp.includes(text));
const nestedStale = nestedForbidden.filter((text) => createChangeRequestHelp.includes(text));

if (nestedMissing.length || nestedStale.length) {
  throw new Error(
    [
      "busabase-cli nested help for bases create-change-request is not focused.",
      nestedMissing.length
        ? `Missing:\n${nestedMissing.map((text) => `  - ${text}`).join("\n")}`
        : "",
      nestedStale.length ? `Stale:\n${nestedStale.map((text) => `  - ${text}`).join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  );
}

console.log("busabase-cli help matches the Change Request command surface.");
