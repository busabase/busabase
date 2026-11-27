import { LanguageDescription, LanguageSupport, StreamLanguage } from "@codemirror/language";
import { codeBlockConfig } from "@milkdown/kit/component/code-block";
import type { Ctx } from "@milkdown/kit/ctx";

// Rendering belongs to the existing preview hook. Register a plain source editor
// so picking Mermaid does not download a second diagram parser or grammar.
const mermaidLanguage = LanguageDescription.of({
  name: "Mermaid",
  alias: ["mermaid"],
  support: new LanguageSupport(
    StreamLanguage.define({
      token: (stream) => {
        stream.skipToEnd();
        return null;
      },
    }),
  ),
});

/** Run after Crepe's feature configuration, preserving its complete language list. */
export function configureDocMermaidLanguage(ctx: Ctx) {
  ctx.update(codeBlockConfig.key, (config) => ({
    ...config,
    languages: config.languages.some((language) =>
      [language.name, ...language.alias].some((alias) => alias.toLowerCase() === "mermaid"),
    )
      ? config.languages
      : [...config.languages, mermaidLanguage],
  }));
}
