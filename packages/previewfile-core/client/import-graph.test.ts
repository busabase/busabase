/**
 * The 3D viewer's dependency, @react-three/fiber, augments JSX globally; a host
 * that compiles any file importing it — even lazily — gets broken JSX types.
 * previewfile-core ships source, so this guards that nothing reachable from
 * the entry points hosts import (the client barrel, the embed) imports it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SPECIFIER = /(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/g;

const reachable = (entry: string): Map<string, string[]> => {
  const seen = new Map<string, string[]>();
  const queue = [path.resolve(__dirname, entry)];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    const specifiers = [...readFileSync(file, "utf8").matchAll(SPECIFIER)].map(
      (m) => m[1] as string,
    );
    seen.set(file, specifiers);
    for (const specifier of specifiers) {
      if (!specifier.startsWith(".")) continue;
      const base = path.resolve(path.dirname(file), specifier);
      const resolved = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]
        .map((suffix) => base + suffix)
        .find((candidate) => {
          try {
            return readFileSync(candidate) && true;
          } catch {
            return false;
          }
        });
      if (resolved) queue.push(resolved);
    }
  }
  return seen;
};

describe("3D stays opt-in", () => {
  it.each(["./index.ts", "./embedded/index.tsx", "./embedded/lazy.tsx"])(
    "%s never reaches @react-three/fiber",
    (entry) => {
      for (const [file, specifiers] of reachable(entry)) {
        expect(path.basename(file), file).not.toMatch(/^(Model3DViewer|STLViewer)\.tsx$/);
        for (const specifier of specifiers) {
          expect(specifier, file).not.toMatch(/^@react-three\//);
        }
      }
    },
  );

  it("is only a subpath import away", () => {
    const files = [...reachable("./viewers/model-3d.tsx").keys()].map((f) => path.basename(f));
    expect(files).toContain("Model3DViewer.tsx");
  });

  // A host that imports the subpath compiles whatever its `types` condition
  // names. Pointing that at the real module drags fiber into the host's
  // program and breaks its unrelated JSX (this is what turned Buda's CI red).
  describe("the model-3d subpath, as a host's TypeScript sees it", () => {
    const entry = (
      JSON.parse(readFileSync(path.resolve(__dirname, "../package.json"), "utf8")) as {
        exports: Record<string, { types: string; default: string }>;
      }
    ).exports["./client/viewers/model-3d"] as { types: string; default: string };

    it("is a declaration that imports nothing but react and the viewer props", () => {
      expect(entry.types).toMatch(/\.d\.ts$/);
      const specifiers = [
        ...readFileSync(path.resolve(__dirname, "..", entry.types), "utf8").matchAll(SPECIFIER),
      ].map((m) => m[1]);
      expect(specifiers.sort()).toEqual(["./viewer-props", "react"]);
    });

    it("leaves the bundler the real module", () => {
      expect(entry.default).toBe("./client/viewers/model-3d.tsx");
    });
  });
});
