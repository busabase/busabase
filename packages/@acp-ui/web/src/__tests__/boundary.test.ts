import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Unlike `@acp-ui/core`, this package is *supposed* to import `kui` and React —
 * that is its job. The property worth defending here is narrower: the ACP stack
 * never reaches for the Vercel AI SDK itself.
 *
 * The distinction matters because `kui` does depend on `ai` for its own types,
 * so the AI SDK is unavoidably present in this package's *transitive* type
 * graph. What must not happen is `@acp-ui/web` reaching past `kui` to model
 * anything on `UIMessage` — the moment it does, the reason `@acp-ui/*` exists
 * separately from `@kaiui/*` has quietly evaporated. `tool-status.ts` is the
 * sanctioned seam: a structural subset of kui's state union, checked by the
 * compiler at the `<ToolHeader>` call site, with no `ai` import.
 */

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const srcRoot = join(packageRoot, "src");

const FORBIDDEN = ["ai", "@ai-sdk/react", "@ai-sdk/provider", "@kaiui/core"];

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

const sourceFiles = listFiles(srcRoot).filter((f) => !/\.test\.tsx?$/.test(f));

describe("@acp-ui/web boundary", () => {
  it("never imports the AI SDK directly from src/", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      const content = readFileSync(file, "utf8");
      for (const specifier of FORBIDDEN) {
        if (new RegExp(`from ["']${specifier}(/|["'])`).test(content)) {
          offenders.push(`${file} imports "${specifier}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("declares no dependency on the AI SDK", () => {
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
    const declared = { ...pkg.dependencies, ...pkg.peerDependencies };
    expect(FORBIDDEN.filter((name) => name in declared)).toEqual([]);
  });
});
