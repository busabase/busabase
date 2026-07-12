import { describe, expect, it } from "vitest";
import { runWithBusabaseContext, withContextSourceMeta } from "../src/context";

describe("Busabase source provenance", () => {
  it("leaves sourceMeta unchanged when no host provenance is present", () => {
    const sourceMeta = { subject: "record" };
    expect(withContextSourceMeta(sourceMeta)).toBe(sourceMeta);
  });

  it("merges host provenance into sourceMeta for cloud requests", async () => {
    await runWithBusabaseContext(
      {
        sourceProvenance: {
          owner: { id: "usr_1", name: "Kelly", email: "kelly@example.com", image: null },
          apiKey: {
            id: "apk_1",
            name: "Writer integration",
          },
          channel: "sdk",
        },
      },
      async () => {
        expect(withContextSourceMeta({ subject: "record" })).toEqual({
          subject: "record",
          provenance: {
            owner: { id: "usr_1", name: "Kelly", email: "kelly@example.com", image: null },
            apiKey: {
              id: "apk_1",
              name: "Writer integration",
            },
            channel: "sdk",
          },
        });
      },
    );
  });
});
