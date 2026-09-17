import { defaultHighlightStyle, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Compartment, type Extension } from "@codemirror/state";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { tags } from "@lezer/highlight";

// Start with CodeMirror's shipped palettes. Only the tokens that fall below
// normal-text contrast on Busabase's card surfaces need local corrections.
const lightHighlightStyle = HighlightStyle.define([
  ...defaultHighlightStyle.specs,
  { tag: [tags.regexp, tags.escape, tags.special(tags.string)], color: "var(--doc-code-escape)" },
  { tag: [tags.typeName, tags.namespace], color: "var(--doc-code-type)" },
  { tag: tags.invalid, color: "var(--doc-code-invalid)" },
]);

const darkHighlightStyle = HighlightStyle.define([
  ...oneDarkHighlightStyle.specs,
  { tag: tags.keyword, color: "var(--doc-code-keyword)" },
  {
    tag: [tags.name, tags.deleted, tags.character, tags.propertyName, tags.macroName, tags.heading],
    color: "var(--doc-code-name)",
  },
  { tag: [tags.meta, tags.comment, tags.link], color: "var(--doc-code-comment)" },
]);

function codeTheme(dark: boolean): Extension {
  return [
    // Also selects CodeMirror's dark defaults for selection, brackets and menus.
    EditorView.theme({}, { dark }),
    syntaxHighlighting(dark ? darkHighlightStyle : lightHighlightStyle),
  ];
}

/** Keep every mounted (and lazily mounted) Doc code block in the host theme. */
export function createDocCodeTheme(): Extension {
  const theme = new Compartment();
  const isDark = () => document.documentElement.classList.contains("dark");
  const initialDark = isDark();

  const followHostTheme = ViewPlugin.fromClass(
    class {
      private appliedDark = initialDark;
      private destroyed = false;
      private readonly observer: MutationObserver;

      constructor(private readonly view: EditorView) {
        this.observer = new MutationObserver(() => this.sync());
        this.observer.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["class"],
        });
        // Crepe may initialize an off-screen block after the host theme changed.
        queueMicrotask(() => this.sync());
      }

      private sync() {
        if (this.destroyed) return;
        const dark = isDark();
        if (dark === this.appliedDark) return;
        this.appliedDark = dark;
        this.view.dispatch({ effects: theme.reconfigure(codeTheme(dark)) });
      }

      destroy() {
        this.destroyed = true;
        this.observer.disconnect();
      }
    },
  );

  return [theme.of(codeTheme(initialDark)), followHostTheme];
}
