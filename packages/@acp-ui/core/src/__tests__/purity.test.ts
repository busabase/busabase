import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Two properties define this package, and both are checked mechanically here
 * rather than merely asserted in prose.
 *
 * 1. **It renders no host element and depends on no platform.** Same discipline
 *    as `@kaiui/core`: no `.tsx`, no `react-dom`/`react-native`/Taro/`kui`.
 *    Plain `react` IS allowed — `session/` is a headless hook, which is what
 *    lets a web, React Native or Taro binding share one interaction sequence.
 *    `tsconfig.json` used to omit the `"DOM"` lib as a proxy for this, but
 *    `AbortSignal` (a platform-neutral standard) is typed there, so the DOM lib
 *    is now included and the DOM *globals* are asserted against directly below —
 *    a stricter check than the one it replaces, since it names the offender.
 *
 * 2. **It does not depend on the Vercel AI SDK.** This is the whole reason the
 *    package exists: ACP is wired directly, because routing it through
 *    `UIMessage` loses the multi-option permission shape and has no native part
 *    for 8 of ACP's 13 `sessionUpdate` kinds. A stray `import … from "ai"` would
 *    silently undo that decision, so it fails the build instead.
 */

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const srcRoot = join(packageRoot, "src");

const FORBIDDEN_IMPORT_SPECIFIERS = [
  "react-dom",
  "react-native",
  "@tarojs/taro",
  "kui",
  "buda-core",
  // The architectural decision this package embodies — see the header comment.
  "ai",
  "@ai-sdk/react",
  "@ai-sdk/provider",
  "@kaiui/core",
];

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...listFiles(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

const sourceFiles = listFiles(srcRoot).filter((f) => !f.endsWith(".test.ts"));

describe("@acp-ui/core purity", () => {
  it("contains no .tsx files (no JSX/host elements to render)", () => {
    const tsxFiles = sourceFiles.filter((f) => f.endsWith(".tsx"));
    expect(tsxFiles).toEqual([]);
  });

  it("never imports a platform or styled-UI package from src/", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      const content = readFileSync(file, "utf8");
      for (const specifier of FORBIDDEN_IMPORT_SPECIFIERS) {
        const re = new RegExp(`from ["']${specifier}(/|["'])`);
        if (re.test(content)) {
          offenders.push(`${file} imports "${specifier}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("touches no DOM global", () => {
    // The DOM lib is on for `AbortSignal`'s sake, so nothing else stops a
    // `document.querySelector` from compiling. This is what does.
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      const content = readFileSync(file, "utf8");
      for (const name of ["document", "window", "localStorage", "navigator"]) {
        if (new RegExp(`\\b${name}\\.`).test(content)) {
          offenders.push(`${file} uses "${name}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("declares no runtime/peer dependency on a platform or styled-UI package", () => {
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
    const declared = {
      ...pkg.dependencies,
      ...pkg.peerDependencies,
      ...pkg.optionalDependencies,
    };
    const offenders = FORBIDDEN_IMPORT_SPECIFIERS.filter((name) => name in declared);
    expect(offenders).toEqual([]);
  });

  it("keeps react-dom to devDependencies only", () => {
    // Testing a hook requires rendering it, so `react-dom` is a devDependency.
    // That must not quietly become a runtime one: this package is consumed by
    // bindings that render with something other than the DOM.
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
    expect(pkg.devDependencies).toHaveProperty("react-dom");
    expect({ ...pkg.dependencies, ...pkg.peerDependencies }).not.toHaveProperty("react-dom");
  });
});
