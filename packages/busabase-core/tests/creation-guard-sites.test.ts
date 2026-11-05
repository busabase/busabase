import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every place core inserts a node without a Change Request has to do it inside the host's
 * creation guard, or a client writing in parallel counts the space before any of them
 * commits and walks through the plan's limit. A fifth such path added later is the
 * failure this is here for, so a new direct insert of a node has to be listed.
 */
const SRC = path.resolve(__dirname, "../src");

const DIRECT_NODE_CREATORS = [
  "domains/doc/handlers.ts",
  "domains/file-node/handlers.ts",
  "domains/filetree/handlers.ts",
  "domains/base/logic/record-ops.ts",
];

describe("direct node creation runs inside the host's creation guard", () => {
  it.each(DIRECT_NODE_CREATORS)("%s guards its insert", (file) => {
    const source = readFileSync(path.join(SRC, file), "utf8");
    expect(source).toContain("runWithContextCreationGuard({ nodes: 1 }");
    expect(source).toContain("assertContextCreationAllowed({ nodes: 1 })");
  });
});
