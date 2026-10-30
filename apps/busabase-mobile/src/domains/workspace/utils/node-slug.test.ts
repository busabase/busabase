import { describe, expect, it } from "vitest";
import { localizeSlugConflict, toSlugInput } from "./node-slug";

describe("toSlugInput", () => {
  it("lowercases, collapses runs and strips unsupported characters", () => {
    expect(toSlugInput("My Slug!!")).toBe("my-slug-");
    expect(toSlugInput("a--b")).toBe("a-b");
    expect(toSlugInput("-lead")).toBe("lead");
    expect(toSlugInput("周报")).toBe("");
  });

  it("keeps a trailing hyphen so typing can continue", () => {
    expect(toSlugInput("my-")).toBe("my-");
  });
});

describe("localizeSlugConflict", () => {
  const template = "slug「{slug}」已被占用";
  it("translates the server sentence and keeps the slug", () => {
    expect(
      localizeSlugConflict(
        template,
        'The folder slug "ops" is already used in this workspace. Choose a different slug.',
      ),
    ).toBe("slug「ops」已被占用");
  });

  it("leaves other messages alone", () => {
    expect(localizeSlugConflict(template, "Requires manage access on this node")).toBe(
      "Requires manage access on this node",
    );
  });
});
