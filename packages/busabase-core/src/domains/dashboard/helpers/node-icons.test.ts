import { Folder, Form } from "lucide-react";
import { describe, expect, it } from "vitest";
import { nodeIconForId, nodeIconForType } from "./node-icons";

describe("node icons", () => {
  it("uses the Lucide Form icon for Form nodes", () => {
    expect(nodeIconForType("form")).toBe(Form);
    expect(nodeIconForId("form")).toBe(Form);
    expect(nodeIconForType("form")).not.toBe(Folder);
  });
});
