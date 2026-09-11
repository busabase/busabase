import { describe, expect, it } from "vitest";
import {
  isAnonymousProcedureAllowed,
  isEmbedProcedureAllowed,
} from "../src/logic/anonymous-allowlist";

describe("Drive preview visitor surface", () => {
  it("allows the read-only preview session operation for Embed Links", () => {
    expect(isEmbedProcedureAllowed(["core", "fileTrees", "previewConfig"])).toBe(true);
    expect(isEmbedProcedureAllowed(["core", "fileTrees", "preparePreview"])).toBe(true);
  });

  it("keeps ordinary anonymous visitors out of Drive preview", () => {
    expect(isAnonymousProcedureAllowed(["core", "fileTrees", "previewConfig"])).toBe(false);
    expect(isAnonymousProcedureAllowed(["core", "fileTrees", "preparePreview"])).toBe(false);
  });
});
