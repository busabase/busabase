import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";
import * as t from "@babel/types";
import { describe, expect, it } from "vitest";
import { isUserManageableVaultKey } from "../src/domains/vault/logic/vault-logic";

const sourceRoot = path.resolve(__dirname, "../src");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory()
      ? sourceFiles(file)
      : /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file)
        ? [file]
        : [];
  });
}

interface KeyShape {
  prefix: string;
  dynamic: boolean;
}

function internalWrites(file: string, source = readFileSync(file, "utf8")) {
  if (!source.includes("busabaseVaultItems")) return [];
  const ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
  const declarations = new Map<string, t.Expression | null>();
  const tableNames = new Set(["busabaseVaultItems"]);
  t.traverseFast(ast, (node) => {
    if (
      t.isImportSpecifier(node) &&
      t.isIdentifier(node.imported, { name: "busabaseVaultItems" })
    ) {
      tableNames.add(node.local.name);
    }
    if (t.isVariableDeclarator(node) && t.isIdentifier(node.id) && t.isExpression(node.init)) {
      declarations.set(node.id.name, declarations.has(node.id.name) ? null : node.init);
    }
  });
  const unsupported = (node: t.Node): never => {
    throw new Error(
      `${path.relative(sourceRoot, file)}:${node.loc?.start.line}: Cannot prove this internal Vault key is protected: ${source.slice(node.start ?? 0, node.end ?? 0)}. Add coverage for its key construction before adding this writer.`,
    );
  };
  // Resolve only today's literal/constant/template-prefix convention. Unknown
  // suffixes get an uppercase witness, so they cannot pass just by being lowercase.
  const keyShape = (
    node: t.Node,
    parameters = new Set<string>(),
    resolving = new Set<string>(),
  ): KeyShape => {
    if (t.isStringLiteral(node)) return { prefix: node.value, dynamic: false };
    if (t.isIdentifier(node)) {
      if (parameters.has(node.name)) return { prefix: "", dynamic: true };
      const declaration = declarations.get(node.name);
      if (declaration === null) return unsupported(node);
      if (!declaration) return { prefix: "", dynamic: true };
      if (resolving.has(node.name)) return unsupported(node);
      return keyShape(declaration, parameters, new Set([...resolving, node.name]));
    }
    if (t.isTemplateLiteral(node)) {
      let prefix = node.quasis[0]?.value.cooked ?? "";
      for (let index = 0; index < node.expressions.length; index++) {
        if (prefix.includes(":")) return { prefix, dynamic: true };
        const expression = node.expressions[index];
        if (!expression) return unsupported(node);
        const shape = keyShape(expression, parameters, resolving);
        prefix += shape.prefix;
        if (shape.dynamic) return { prefix, dynamic: true };
        prefix += node.quasis[index + 1]?.value.cooked ?? "";
      }
      return { prefix, dynamic: false };
    }
    if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
      if (resolving.has(node.callee.name)) return unsupported(node);
      const declaration = declarations.get(node.callee.name);
      if (
        t.isArrowFunctionExpression(declaration) &&
        t.isExpression(declaration.body) &&
        declaration.params.every((parameter) => t.isIdentifier(parameter))
      ) {
        return keyShape(
          declaration.body,
          new Set(declaration.params.map((parameter) => (parameter as t.Identifier).name)),
          new Set([...resolving, node.callee.name]),
        );
      }
    }
    return unsupported(node);
  };
  const isVaultTable = (node: t.Node | null | undefined, seen = new Set<string>()): boolean => {
    if (t.isMemberExpression(node)) {
      return t.isIdentifier(node.property, { name: "busabaseVaultItems" });
    }
    if (!t.isIdentifier(node) || seen.has(node.name)) return false;
    return (
      tableNames.has(node.name) ||
      isVaultTable(declarations.get(node.name), new Set([...seen, node.name]))
    );
  };
  const isVaultWrite = (node: t.Node): boolean => {
    if (!t.isCallExpression(node) || !t.isMemberExpression(node.callee)) return false;
    const { object, property } = node.callee;
    if (t.isIdentifier(property) && ["insert", "update"].includes(property.name)) {
      return isVaultTable(node.arguments[0]);
    }
    return isVaultWrite(object);
  };
  const writes: Array<{ location: string; key: string }> = [];
  const inspectValues = (node: t.Node, requireKey: boolean) => {
    if (!t.isObjectExpression(node)) return unsupported(node);
    if (
      node.properties.some(
        (property) => t.isSpreadElement(property) || ("computed" in property && property.computed),
      )
    )
      return unsupported(node);
    const key = node.properties.find(
      (property) =>
        t.isObjectProperty(property) &&
        (t.isIdentifier(property.key, { name: "key" }) ||
          t.isStringLiteral(property.key, { value: "key" })),
    );
    if (!key) {
      if (requireKey) unsupported(node);
      return;
    }
    if (!t.isObjectProperty(key)) return unsupported(key);
    const shape = keyShape(key.value);
    writes.push({
      location: `${path.relative(sourceRoot, file)}:${key.loc?.start.line}`,
      key: shape.prefix + (shape.dynamic ? "STRUCTURAL_TEST_SUFFIX" : ""),
    });
  };
  t.traverseFast(ast, (node) => {
    if (
      !t.isCallExpression(node) ||
      !t.isMemberExpression(node.callee) ||
      !t.isIdentifier(node.callee.property) ||
      !isVaultWrite(node.callee.object)
    ) {
      return;
    }
    const operation = node.callee.property.name;
    if (operation === "values" || operation === "set") {
      const values = node.arguments[0];
      if (!values) return unsupported(node);
      if (t.isArrayExpression(values)) {
        for (const value of values.elements) {
          if (!value) return unsupported(values);
          inspectValues(value, true);
        }
      } else {
        inspectValues(values, operation === "values");
      }
    }
    if (operation === "onConflictDoUpdate") {
      const options = node.arguments[0];
      if (!t.isObjectExpression(options)) return unsupported(node);
      if (options.properties.some((property) => t.isSpreadElement(property))) {
        return unsupported(options);
      }
      const set = options.properties.find(
        (property) => t.isObjectProperty(property) && t.isIdentifier(property.key, { name: "set" }),
      );
      if (!t.isObjectProperty(set)) return unsupported(node);
      inspectValues(set.value, false);
    }
  });
  return writes;
}

describe("internal Vault writers remain outside public settings", () => {
  it("protects actual Core keys written outside the Vault domain", () => {
    const writes = sourceFiles(sourceRoot)
      .filter((file) => !file.includes(`${path.sep}domains${path.sep}vault${path.sep}`))
      .flatMap((file) => internalWrites(file));
    // Catch a broken scan, rather than passing with zero protected write sites.
    expect(writes.map((write) => write.location)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("agents/logic/buda-connection.ts:"),
        expect.stringContaining("agents/logic/router-oauth.ts:"),
        expect.stringContaining("agents/logic/router-enrollment.ts:"),
        expect.stringContaining("agents/logic/agent-connection-name.ts:"),
      ]),
    );
    for (const write of writes) {
      expect(
        isUserManageableVaultKey(write.key),
        `${write.location}: ${write.key} would be exposed to public Vault settings`,
      ).toBe(false);
    }
  });

  it("detects unprotected keys through direct table aliases", () => {
    const writes = internalWrites(
      path.join(sourceRoot, "writer-fixture.ts"),
      `import { busabaseVaultItems as items } from "./schema";
       const tableAlias = items;
       db.insert(tableAlias).values({ key: "UNPROTECTED_CONNECTION_TOKEN" });`,
    );
    expect(writes).toHaveLength(1);
    expect(isUserManageableVaultKey(writes[0]?.key ?? "")).toBe(true);
  });

  it("requires explicit coverage for unknown internal key construction", () => {
    expect(() =>
      internalWrites(
        path.join(sourceRoot, "writer-fixture.ts"),
        "db.insert(busabaseVaultItems).values({ key: makeInternalKey() });",
      ),
    ).toThrow("Cannot prove this internal Vault key is protected");
  });
});
