import { createHash } from "node:crypto";
import type { Expression, ImportDeclaration, Program } from "estree";
import type { Root, RootContent } from "mdast";
import type { MdxJsxAttribute, MdxJsxFlowElement, MdxJsxTextElement } from "mdast-util-mdx-jsx";
import type { MdxjsEsm } from "mdast-util-mdxjs-esm";

const EXPORT_NAME = "_llmsImageSources";

/**
 * Runs after Fumadocs remarkImage. Its renderer keeps the original imported images; only
 * Fumadocs' processed-text stringifier sees tokenized copies, paired with runtime asset URLs.
 */
export const remarkLlmsImages = () => (tree: Root, file: { value: unknown }) => {
  const source = String(file.value);
  let prefix = `fd-llms-image-${createHash("sha256").update(source).digest("hex")}-`;
  while (source.includes(prefix)) prefix += "x";
  const imports = new Set<string>();
  for (const node of tree.children) {
    if (node.type !== "mdxjsEsm") continue;
    for (const statement of node.data?.estree?.body ?? []) {
      if (statement.type !== "ImportDeclaration") continue;
      const declaration = statement as ImportDeclaration;
      if (
        typeof declaration.source.value !== "string" ||
        !/\.(?:png|webp|svg|jpe?g|avif|gif)$/i.test(declaration.source.value)
      )
        continue;
      for (const item of declaration.specifiers) {
        if (item.type === "ImportDefaultSpecifier") imports.add(item.local.name);
      }
    }
  }
  if (!imports.size) return;

  const properties: Array<{ token: string; name: string }> = [];
  const walk = (node: Root | RootContent) => {
    if (
      (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") &&
      (node.name === "img" || node.name === "Image")
    ) {
      const image = node as MdxJsxFlowElement | MdxJsxTextElement;
      const src = image.attributes.find(
        (attribute): attribute is MdxJsxAttribute =>
          attribute.type === "mdxJsxAttribute" && attribute.name === "src",
      );
      const statement =
        src?.value && typeof src.value === "object" ? src.value.data?.estree?.body[0] : undefined;
      const expression =
        statement?.type === "ExpressionStatement" ? statement.expression : undefined;
      // Resolve only imported assets and their static `.src` member. Never evaluate authored JS.
      const name =
        expression?.type === "Identifier"
          ? expression.name
          : expression?.type === "MemberExpression" &&
              !expression.computed &&
              expression.object.type === "Identifier" &&
              expression.property.type === "Identifier" &&
              expression.property.name === "src"
            ? expression.object.name
            : undefined;
      if (src && name && imports.has(name)) {
        const token = `${prefix}${properties.length}`;
        properties.push({ token, name });
        // Do not copy data: _stringify.node pointing back at itself would create a cycle.
        const { data: _data, ...copy } = image;
        const alternate = {
          ...copy,
          attributes: image.attributes.map((attribute) =>
            attribute === src ? { ...attribute, value: token } : attribute,
          ),
        };
        image.data = { ...image.data, _stringify: { node: alternate } };
      }
    }
    if ("children" in node) for (const child of node.children) walk(child);
  };
  walk(tree);
  if (!properties.length) return;

  const assetValue = (name: string): Expression => ({
    type: "LogicalExpression",
    operator: "??",
    left: {
      type: "MemberExpression",
      computed: false,
      optional: false,
      object: { type: "Identifier", name },
      property: { type: "Identifier", name: "src" },
    },
    right: { type: "Identifier", name },
  });
  const program: Program = {
    type: "Program",
    sourceType: "module",
    body: [
      {
        type: "ExportNamedDeclaration",
        attributes: [],
        specifiers: [],
        source: null,
        declaration: {
          type: "VariableDeclaration",
          kind: "const",
          declarations: [
            {
              type: "VariableDeclarator",
              id: { type: "Identifier", name: EXPORT_NAME },
              init: {
                type: "ObjectExpression",
                properties: properties.map(({ token, name }) => ({
                  type: "Property",
                  kind: "init",
                  method: false,
                  shorthand: false,
                  computed: false,
                  key: { type: "Literal", value: token },
                  value: assetValue(name),
                })),
              },
            },
          ],
        },
      },
    ],
  };
  const exported: MdxjsEsm = { type: "mdxjsEsm", value: "", data: { estree: program } };
  tree.children.push(exported);
};
