import { describe, expect, it } from "vitest";
import { coreMessagesByLocale } from "../../../i18n/catalog";
import { presentInstallError } from "./install-error";

const messages = coreMessagesByLocale["zh-CN"];
const slug = "f-11111111-1111-4111-8111-111111111111";

describe("install error presentation", () => {
  it.each(["previewFailed", "installFailed"] as const)(
    "retains the actionable reason for %s while replacing the allocated address",
    (kind) => {
      const error = new Error(`Cannot create folder "${slug}": insufficient permission.`);
      const visible = presentInstallError(messages, "zh-CN", error, messages.install[kind], {
        slug,
        name: "团队邮箱",
      });
      expect(visible).toContain("insufficient permission");
      expect(visible).toContain("团队邮箱");
      expect(visible).not.toContain(slug);
      expect(visible).not.toBe(messages.install[kind]);
      expect(error.message).toContain(slug);
    },
  );

  it("uses a localized folder label when no name has been chosen", () => {
    const visible = presentInstallError(
      messages,
      "zh-CN",
      new Error(`Quota exceeded for ${slug}.`),
      messages.install.previewFailed,
      { slug },
    );
    expect(visible).toContain("Quota exceeded");
    expect(visible).toContain(messages.install.folderName);
    expect(visible).not.toContain(slug);
  });

  it("keeps replacement metacharacters in a user name literal", () => {
    const name = "团队 $& 邮箱";
    const visible = presentInstallError(
      messages,
      "zh-CN",
      new Error(`Permission denied for ${slug} and ${slug}.`),
      messages.install.installFailed,
      { slug, name },
    );
    expect(visible).toBe(`Permission denied for ${name} and ${name}.`);
    expect(visible).not.toContain(slug);
  });

  it("bounds the summary again after inserting a long multilingual display name", () => {
    const visible = presentInstallError(
      messages,
      "zh-CN",
      new Error(`Quota exceeded for ${slug}. Check the workspace plan.`),
      messages.install.installFailed,
      { slug, name: "📬".repeat(500) },
    );
    expect(visible).toContain("Quota exceeded");
    expect(Array.from(visible)).toHaveLength(300);
    expect(visible.endsWith("…")).toBe(true);
    expect(visible).not.toContain(slug);
  });
});
