import { describe, expect, it } from "vitest";
import { createNodeChangeRequestInputSchema } from "../../contract/schemas";
import { InstallFromGithubDTOSchema, InstallPlanFromGithubDTOSchema } from "./types";

const repoUrl = "https://github.com/busabase/templates/tree/main/templates/busa-email";

describe.each([InstallPlanFromGithubDTOSchema, InstallFromGithubDTOSchema])(
  "install target validation",
  (schema) => {
    it.each(["Kelvin企业邮箱工作台", "チームの受信箱", "صندوق بريد الفريق", "Почта", "Café 📬"])(
      "preserves the Unicode display name %s",
      (name) => {
        expect(schema.parse({ repoUrl, newFolder: { name } }).newFolder?.name).toBe(name);
      },
    );

    it("accepts an automatic target and a returned target identity", () => {
      expect(schema.parse({ repoUrl, newFolder: {} }).newFolder).toEqual({});
      expect(
        schema.parse({ repoUrl, newFolder: { slug: "f-1234", name: "  工作台  " } }).newFolder,
      ).toEqual({ slug: "f-1234", name: "工作台" });
    });

    it("rejects ambiguous destinations and an empty display name", () => {
      expect(schema.safeParse({ repoUrl, intoFolder: "existing", newFolder: {} }).success).toBe(
        false,
      );
      expect(schema.safeParse({ repoUrl, newFolder: { name: "  " } }).success).toBe(false);
    });

    it.each(["", "Workspace", "工作台", "has space", "has/slash"])(
      "rejects the same invalid slug %s at both installation and node creation",
      (slug) => {
        expect(schema.safeParse({ repoUrl, intoFolder: slug }).success).toBe(false);
        expect(schema.safeParse({ repoUrl, newFolder: { slug } }).success).toBe(false);
        expect(
          createNodeChangeRequestInputSchema.safeParse({
            operations: [{ kind: "create", nodeType: "folder", slug, name: "工作台" }],
          }).success,
        ).toBe(false);
      },
    );
  },
);
