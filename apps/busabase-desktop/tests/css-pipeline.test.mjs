import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/postcss";
import postcss from "postcss";
import config from "../postcss.config.mjs";

test("compiles shared KUI Tailwind directives in the desktop CSS pipeline", async () => {
  assert.deepEqual(config.plugins, { "@tailwindcss/postcss": {} });
  const source = fileURLToPath(new URL("../../../packages/kui/src/styles.css", import.meta.url));
  const result = await postcss([tailwindcss(config.plugins["@tailwindcss/postcss"])]).process(
    await readFile(source, "utf8"),
    { from: source },
  );
  assert.doesNotMatch(result.css, /@(apply|theme|custom-variant)\b/);
  const bodyDeclarations = new Map();
  result.root.walkRules("body", (rule) => {
    rule.walkDecls((declaration) => bodyDeclarations.set(declaration.prop, declaration.value));
  });
  assert.equal(bodyDeclarations.get("background-color"), "hsl(var(--background))");
  assert.equal(bodyDeclarations.get("color"), "hsl(var(--foreground))");
  assert.equal(result.warnings().length, 0);
});
