// @vitest-environment jsdom
import { LanguageDescription, LanguageSupport, StreamLanguage } from "@codemirror/language";
import { codeBlockConfig } from "@milkdown/kit/component/code-block";
import { Editor, rootCtx } from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { afterEach, describe, expect, it } from "vitest";
import { configureDocMermaidLanguage } from "./doc-mermaid-creation";

const editors: Editor[] = [];
async function createEditor() {
  const root = document.createElement("div");
  document.body.append(root);
  const editor = Editor.make()
    .config((ctx) => ctx.set(rootCtx, root))
    .use(commonmark)
    .use(codeBlockConfig);
  editors.push(editor);
  await editor.create();
  return editor;
}
afterEach(async () => {
  for (const editor of editors.splice(0)) await editor.destroy();
  document.body.replaceChildren();
});

function sourceLanguage(name: string) {
  return LanguageDescription.of({
    name,
    support: new LanguageSupport(
      StreamLanguage.define({
        token: (stream) => {
          stream.skipToEnd();
          return null;
        },
      }),
    ),
  });
}

describe("Doc Mermaid language picker", () => {
  it("adds selectable Mermaid source support once while preserving existing languages and preview", async () => {
    const editor = await createEditor();
    editor.action((ctx) => {
      const ordinary = sourceLanguage("TypeScript");
      const config = ctx.get(codeBlockConfig.key);
      ctx.update(codeBlockConfig.key, (value) => ({ ...value, languages: [ordinary] }));
      configureDocMermaidLanguage(ctx);
      configureDocMermaidLanguage(ctx);
      const updated = ctx.get(codeBlockConfig.key);
      expect(updated.languages.map((language) => language.name)).toEqual(["TypeScript", "Mermaid"]);
      expect(updated.languages[0]).toBe(ordinary);
      expect(updated.languages[1]?.alias).toContain("mermaid");
      expect(updated.languages[1]?.support).toBeDefined();
      expect(updated.renderPreview).toBe(config.renderPreview);
    });
  });

  it("keeps an existing Mermaid language registration without adding a duplicate", async () => {
    const editor = await createEditor();
    editor.action((ctx) => {
      const existing = [sourceLanguage("TypeScript"), sourceLanguage("MERMAID")];
      ctx.update(codeBlockConfig.key, (value) => ({ ...value, languages: existing }));
      configureDocMermaidLanguage(ctx);
      expect(ctx.get(codeBlockConfig.key).languages).toBe(existing);
    });
  });
});
