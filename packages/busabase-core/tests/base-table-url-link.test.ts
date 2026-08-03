import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const baseTablePath = path.resolve(
  import.meta.dirname,
  "../src/domains/dashboard/components/base-table.tsx",
);

describe("Base table URL fields", () => {
  it("opens URL values directly instead of routing to record detail", () => {
    const source = fs.readFileSync(baseTablePath, "utf8");

    expect(source).toContain('if (kind === "link")');
    expect(source).toMatch(/href=\{`\$\{prefix\}\$\{value\}`\}/);
    expect(source).toContain('target={external ? "_blank" : undefined}');
    expect(source).toContain('rel={external ? "noreferrer" : undefined}');
  });
});
