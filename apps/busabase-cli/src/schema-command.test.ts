import { describe, expect, it } from "vitest";
import { contractProcedures, generatedCommandPath } from "./contract-catalog";
import { EXIT_CODES } from "./errors";
import { buildProgram } from "./run";
import {
  describeEndpoint,
  listEndpoints,
  renderEndpoint,
  renderList,
  SchemaNotFoundError,
} from "./schema-command";

describe("listEndpoints", () => {
  it("covers every procedure the contract carries", () => {
    expect(listEndpoints()).toHaveLength([...contractProcedures()].length);
    expect(listEndpoints().length).toBeGreaterThan(100);
  });

  it("gives each entry the route facts an agent picks a target with", () => {
    for (const entry of listEndpoints()) {
      expect(entry.id).toMatch(/^[A-Za-z]+(\.[A-Za-z]+)*$/);
      expect(entry.method).toMatch(/^(GET|POST|PUT|PATCH|DELETE)$/);
      expect(entry.path.startsWith("/api/v1")).toBe(true);
      expect(entry.command.startsWith("busabase-cli ")).toBe(true);
    }
  });
});

describe("describeEndpoint", () => {
  it("returns both halves as JSON Schema by default", () => {
    const described = describeEndpoint("bases.list");
    expect(described.method).toBe("GET");
    expect(described.path).toBe("/api/v1/bases");
    expect(described.command).toBe("busabase-cli bases list");
    expect(described.input).toMatchObject({ type: "object" });
    expect(described.output).toMatchObject({ type: "array" });
  });

  it("filters to one half with --io", () => {
    expect(describeEndpoint("bases.list", "input").output).toBeUndefined();
    expect(describeEndpoint("bases.list", "output").input).toBeUndefined();
  });

  it("accepts the space-separated and kebab spellings the CLI itself prints", () => {
    // `bases list` is what the command tree shows; `change-requests` is the group
    // name, while the contract id is camelCase. Both must resolve, so an agent can
    // paste back whatever it saw without translating.
    expect(describeEndpoint("bases list").id).toBe("bases.list");
    expect(describeEndpoint("change-requests.list").id).toBe("changeRequests.list");
  });

  it("suggests near misses and exits as a usage error, not a runtime failure", () => {
    let thrown: unknown;
    try {
      describeEndpoint("record.crate");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SchemaNotFoundError);
    expect((thrown as Error).message).toContain("Did you mean");
    expect((thrown as Error).message).toContain("records.");
    expect((thrown as { cliCode: string }).cliCode).toBe("USAGE");
    expect(EXIT_CODES.USAGE).toBe(2);
  });

  it("is dramatically cheaper to read than the whole OpenAPI document", () => {
    // The point of the command: one endpoint, not 103. Production's openapi.json
    // measured 936 KB on 2026-09-04 with no shared component schemas.
    const oneEndpoint = renderEndpoint(describeEndpoint("bases.list")).length;
    expect(oneEndpoint).toBeLessThan(64_000);
    expect(renderEndpoint(describeEndpoint("bases.list", "input")).length).toBeLessThan(
      oneEndpoint,
    );
  });
});

describe("renderList", () => {
  it("prints one line per endpoint plus a count footer", () => {
    const entries = listEndpoints();
    const rendered = renderList(entries);
    expect(rendered.split("\n")).toHaveLength(entries.length + 2);
    expect(rendered).toContain(`${entries.length} endpoints.`);
  });
});

describe("the command tree and the schema catalog agree", () => {
  it("names a real command for every endpoint it describes", () => {
    // Two independent walkers would drift silently; this pins them together.
    for (const { navPath, key } of contractProcedures()) {
      const path = generatedCommandPath(navPath, key);
      expect(path.length).toBeGreaterThan(0);
      expect(path.every((segment) => segment.length > 0)).toBe(true);
    }
  });

  it("only cites endpoint ids in `schema --help` that actually resolve", () => {
    // A help example naming a dead endpoint teaches an agent a command that errors.
    // (This caught a hand-written `records.create` that the contract never had.)
    const schemaCommand = buildProgram().commands.find((cmd) => cmd.name() === "schema");
    expect(schemaCommand).toBeDefined();
    // `helpInformation()` omits `addHelpText("after", …)` — the examples live only
    // in what `outputHelp()` actually prints, so capture that instead.
    let help = "";
    schemaCommand?.configureOutput({
      writeOut: (text) => {
        help += text;
      },
      writeErr: () => {},
    });
    schemaCommand?.outputHelp();
    const cited = [...help.matchAll(/busabase-cli schema ([A-Za-z]+(?:\.[A-Za-z]+)+)/g)].map(
      (match) => match[1],
    );
    expect(cited.length).toBeGreaterThan(0);
    for (const id of cited) expect(() => describeEndpoint(id)).not.toThrow();
  });
});
