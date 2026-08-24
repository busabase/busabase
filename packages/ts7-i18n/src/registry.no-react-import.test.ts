import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Regression test: `registry.ts` must never import from "react", at all — not
// even a type-only import. Next.js's App Router statically flags ANY module
// that imports react's `createContext` (even lazily, even if never called) as
// reachable only from Client Components, breaking every Server Component /
// middleware import of `getTranslations`/`loadLocale` downstream. This bit us
// for real: mcpsdk's `src/i18n/i18n-util.ts` (imported from a Server Component
// layout) crashed at build time until the registry was split out of the
// React-bindings module entirely. A source-text check is deliberately used
// here (not just "does it work at runtime") because the failure mode is a
// static bundler check, not a runtime one — a lazy `createContext()` call
// still trips it.
describe("registry.ts has zero react import (static RSC-boundary safety)", () => {
  it("does not import from 'react' anywhere in its source", () => {
    const source = readFileSync(fileURLToPath(new URL("./registry.ts", import.meta.url)), "utf-8");
    expect(source).not.toMatch(/from\s+["']react["']/);
  });
});
