#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
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
  throw new Error("bin/busabase-cli.mjs is missing. The npm bin wrapper must be published.");
}

const help = execFileSync(process.execPath, [cliPath, "--help"], {
  cwd: root,
  encoding: "utf8",
});
const binHelp = execFileSync(process.execPath, [binPath, "--help"], {
  cwd: root,
  encoding: "utf8",
});
const directVersion = execFileSync(process.execPath, [cliPath, "--version"], {
  cwd: root,
  encoding: "utf8",
});
const delegatedVersion = execFileSync(process.execPath, [binPath], {
  cwd: root,
  encoding: "utf8",
  env: {
    ...process.env,
    BUSABASE_CLI_DELEGATED_ARGV: JSON.stringify(["--version"]),
  },
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
  "login [--device-code]",
  "[--no-wait] [--resume-code <code>]",
  "qrcode [-o, --out-file <path>] [--ascii]",
  "export -o, --out-dir <dir> [--name <name>] [--dry-run]",
  "nodes create --type <folder|base|skill|drive|airapp|file|doc|form|whiteboard|workflow|html>",
  "bases create-change-request --base-id <id>",
  "records change-requests --record-id <id>",
  // `change-requests list` is the endpoint spelling `change-requests query`
  // supersedes, so it is hidden from the index (see TASK_SUPERSEDED_MCP_TOOLS in
  // busabase-contract). Hidden is not gone — `requiredInHelpAll` below pins that
  // it still exists and still runs.
  "change-requests query",
  "change-requests close --change-request-id <id>",
];

/** Commands that must still EXIST, whether or not the curated index lists them. */
const requiredInHelpAll = ["change-requests list", "records list"];

const forbidden = [
  "publish -o, --out-dir <dir>",
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

const combinedHelp = `${help}\n${binHelp}`;
const helpAll = execFileSync(process.execPath, [cliPath, "--help-all"], {
  cwd: root,
  encoding: "utf8",
});
const missingFromHelpAll = requiredInHelpAll.filter((text) => !helpAll.includes(text));
if (missingFromHelpAll.length) {
  throw new Error(
    `busabase-cli --help-all no longer lists commands that must remain runnable:\n${missingFromHelpAll
      .map((text) => `  - ${text}`)
      .join("\n")}`,
  );
}
if (helpAll.length <= combinedHelp.length / 2) {
  throw new Error("busabase-cli --help-all should be a superset of --help, but is not larger.");
}
const missing = required.filter((text) => !combinedHelp.includes(text));
const stale = forbidden.filter((text) => combinedHelp.includes(text));

if (delegatedVersion !== directVersion) {
  throw new Error("busabase-cli delegated wrapper does not match the direct CLI entrypoint.");
}

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

const retiredPublish = spawnSync(process.execPath, [cliPath, "publish"], {
  cwd: root,
  encoding: "utf8",
});
const retiredPublishOutput = `${retiredPublish.stdout}\n${retiredPublish.stderr}`;
if (retiredPublish.status === 0 || !retiredPublishOutput.includes("unknown command 'publish'")) {
  throw new Error(
    "The retired `publish` command must fail as unknown; only `export` may expose the package export workflow.",
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
