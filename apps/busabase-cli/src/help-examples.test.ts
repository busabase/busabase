import type { Command } from "commander";
import { describe, expect, it } from "vitest";
import { buildProgram, HELP, HELP_ALL } from "./run";

/**
 * Every `busabase-cli …` line printed in a command's help must actually run.
 *
 * `records count --help` documented `--filters` for a flag registered as
 * `--filters-json`, so an agent that copied the example verbatim — which is the
 * entire point of printing one — got `error: unknown option '--filters'`.
 * Nothing caught it: examples live in `busabase-contract/src/tasks` and the
 * flags are generated separately from the same task's `params`.
 */
const walk = (cmd: Command, path: string[] = []): Array<{ cmd: Command; path: string[] }> => {
  const here = cmd.name() === "busabase-cli" ? path : [...path, cmd.name()];
  return [{ cmd, path: here }, ...cmd.commands.flatMap((child) => walk(child, here))];
};

/** Long flags a command accepts, including the ones inherited from its parents. */
const acceptedFlags = (cmd: Command): Set<string> => {
  const flags = new Set<string>(["--help"]);
  for (let node: Command | null = cmd; node; node = node.parent) {
    for (const option of node.options) {
      if (option.long) flags.add(option.long);
    }
  }
  return flags;
};

/**
 * `helpInformation()` returns the generated body only — commander applies
 * `addHelpText("after", …)`, which is where examples and guidance live, in
 * `outputHelp()`. So capture the screen a user actually sees.
 */
const renderHelp = (cmd: Command): string => {
  let out = "";
  cmd.configureOutput({
    writeOut: (str) => {
      out += str;
    },
    writeErr: () => {},
  });
  cmd.outputHelp();
  return out;
};

const examplesIn = (cmd: Command): string[] =>
  renderHelp(cmd)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("busabase-cli "));

describe("help examples", () => {
  const commands = walk(buildProgram());

  it("walks a command tree worth checking", () => {
    expect(commands.length).toBeGreaterThan(100);
  });

  const withExamples = commands.filter(({ cmd }) => examplesIn(cmd).length > 0);

  it("finds documented examples to check", () => {
    expect(withExamples.length).toBeGreaterThan(5);
  });

  it.each(withExamples.map(({ cmd, path }) => [path.join(" "), cmd] as const))(
    "every example under `%s` uses flags that command actually registers",
    (_label, cmd) => {
      const accepted = acceptedFlags(cmd);
      const broken: string[] = [];
      for (const example of examplesIn(cmd)) {
        for (const [, flag] of example.matchAll(/(?:^|\s)(--[a-z][a-z0-9-]*)/g)) {
          if (!accepted.has(flag)) broken.push(`${flag} in: ${example}`);
        }
      }
      expect(broken).toEqual([]);
    },
  );
});

/** The command names the root help actually indexes, exactly — not substrings. */
const indexed = (help: string): Set<string> =>
  new Set(
    help
      .split("\n")
      .map((line) => /^ {2}([a-z][a-z0-9-]*(?: [a-z][a-z0-9-]*)?)(?: |$)/.exec(line)?.[1])
      .filter((name): name is string => Boolean(name)),
  );

describe("curated index", () => {
  const shown = indexed(HELP);
  const all = indexed(HELP_ALL);

  it("hides the endpoint commands a task command supersedes", () => {
    for (const spelling of ["records list", "change-requests list", "nodes share-get"]) {
      expect(shown.has(spelling)).toBe(false);
      expect(all.has(spelling)).toBe(true);
    }
  });

  it("keeps the task command that replaced each of them", () => {
    for (const spelling of ["records query", "change-requests query", "nodes share"]) {
      expect(shown.has(spelling)).toBe(true);
    }
  });

  it("hides nothing a task does not already cover", () => {
    for (const spelling of ["assets list", "webhooks list", "grep", "search", "guide"]) {
      expect(shown.has(spelling)).toBe(true);
    }
  });

  it("hides only what the MCP catalog already drops — nothing else", () => {
    const hidden = [...all].filter((name) => !shown.has(name));
    expect(hidden.sort()).toEqual([
      // Added by develop's bulk record update: `record_bulk_update_change_request`
      // supersedes it, and this list picked that up with no edit here — which is
      // the point of matching against the shared set rather than a local copy.
      "bases create-bulk-update-change-request",
      "bases list-deleted-fields",
      "change-requests list",
      "files create",
      "nodes principals-add",
      "nodes principals-list",
      "nodes principals-remove",
      "nodes share-disable",
      "nodes share-get",
      "nodes share-set",
      "records list",
    ]);
  });

  it("points at --help-all so a hidden command is still discoverable", () => {
    expect(HELP).toContain("--help-all");
  });
});
