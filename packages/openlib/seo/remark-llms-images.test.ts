import { compile } from "@mdx-js/mdx";
import { remarkImage } from "fumadocs-core/mdx-plugins/remark-image";
import { remarkLLMs } from "fumadocs-core/mdx-plugins/remark-llms";
import type { Root, RootContent } from "mdast";
import { describe, expect, it } from "vitest";
import { restoreLlmsImageSources } from "./llms-images";
import { getLlmsDocText as getDocText } from "./llms-routes";
import { remarkLlmsImages } from "./remark-llms-images";

const getLlmsDocText = (page: Parameters<typeof getDocText>[0]) =>
  getDocText(page, "Documentation", true);

const collectImages = (tree: Root) => {
  const result: RootContent[] = [];
  const visit = (node: Root | RootContent) => {
    if (
      (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") &&
      (node.name === "img" || node.name === "Image")
    )
      result.push(node);
    if ("children" in node) for (const child of node.children) visit(child);
  };
  visit(tree);
  return result;
};

const build = async (source: string, optIn = true) => {
  let original: unknown, after: unknown, tree: Root | undefined;
  const snapshot = (target: "before" | "after") => () => (root: Root) => {
    const images = collectImages(root).map((node) =>
      node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement" ? node.attributes : [],
    );
    if (target === "before") original = structuredClone(images);
    else {
      after = structuredClone(images);
      tree = root;
      expect(() => JSON.stringify(root)).not.toThrow();
    }
  };
  const compiled = await compile(
    { value: source, path: "/virtual/content/docs/page.mdx" },
    {
      remarkPlugins: [
        [remarkImage, { publicDir: "/virtual/public", useImport: true, external: false }],
        snapshot("before"),
        ...(optIn ? [remarkLlmsImages] : []),
        remarkLLMs,
        snapshot("after"),
      ],
    },
  );
  let markdown = "";
  const tokens: Array<{ token: string; variable: string }> = [];
  for (const node of tree?.children ?? []) {
    if (node.type !== "mdxjsEsm") continue;
    for (const item of node.data?.estree?.body ?? []) {
      if (
        item.type !== "ExportNamedDeclaration" ||
        item.declaration?.type !== "VariableDeclaration"
      )
        continue;
      for (const declaration of item.declaration.declarations) {
        if (declaration.id.type !== "Identifier") continue;
        if (declaration.id.name === "_markdown" && declaration.init?.type === "Literal")
          markdown = String(declaration.init.value);
        if (
          declaration.id.name === "_llmsImageSources" &&
          declaration.init?.type === "ObjectExpression"
        ) {
          for (const property of declaration.init.properties) {
            if (
              property.type !== "Property" ||
              property.key.type !== "Literal" ||
              property.value.type !== "LogicalExpression" ||
              property.value.right.type !== "Identifier"
            )
              throw Error("Unexpected image export shape");
            tokens.push({ token: String(property.key.value), variable: property.value.right.name });
          }
        }
      }
    }
  }
  return { markdown, tokens, original, after, compiled: String(compiled) };
};

describe("processed Markdown image asset exports", () => {
  it("tokenizes real public and relative SVG/PNG/WebP nodes while preserving renderer imports/attributes and code samples", async () => {
    const source = [
      '![Public alt](/assets/docs/public.png "Public title")',
      "",
      '![Relative SVG](./diagram.svg "SVG title")',
      "",
      "![Relative WebP](../cover.webp)",
      "",
      '`<img src="__img0" />`',
      "",
      "```html",
      '<img src="__img1" />',
      "```",
    ].join("\n");
    const result = await build(source);
    expect(result.original).toEqual(result.after);
    expect(result.tokens.map(({ variable }) => variable)).toEqual(["__img0", "__img1", "__img2"]);
    const urls = [
      "/_next/static/media/public.abc.png",
      "/_next/static/media/diagram.def.svg",
      "/_next/static/media/cover.ghi.webp",
    ];
    const resolved = restoreLlmsImageSources(
      result.markdown,
      Object.fromEntries(result.tokens.map(({ token }, index) => [token, urls[index]])),
    );
    expect(resolved).toContain('src="/_next/static/media/public.abc.png"');
    expect(resolved).toContain('alt="Public alt"');
    expect(resolved).toContain('title="Public title"');
    expect(resolved).toContain('src="/_next/static/media/diagram.def.svg"');
    expect(resolved).toContain('title="SVG title"');
    expect(resolved).toContain('src="/_next/static/media/cover.ghi.webp"');
    expect(resolved).toContain('`<img src="__img0" />`');
    expect(resolved).toContain('```html\n<img src="__img1" />\n```');
    expect(resolved).not.toContain("fd-llms-image-");
    expect(resolved).not.toContain("/virtual/");
    expect(result.compiled).toContain('import __img0 from "../../public/assets/docs/public.png"');
    expect(result.compiled).toContain("__img0.src ?? __img0");
  });

  it("fails closed for unopted imports and unresolved authored expressions after real compilation", async () => {
    const plain = await build("![Local](/assets/test.svg)", false);
    expect(plain.tokens).toEqual([]);
    expect(plain.markdown).toContain('src="__img0"');
    const remote = await build(
      '![Remote](https://cdn.example/image.png)\n\n<img src={someVariable} alt="Custom" />',
    );
    expect(remote.tokens).toEqual([]);
    expect(remote.markdown).toContain("https://cdn.example/image.png");
    expect(remote.markdown).toContain('src="someVariable"');
    for (const markdown of [plain.markdown, remote.markdown]) {
      await expect(getLlmsDocText(compiledPage(markdown))).rejects.toMatchObject({
        phase: "image-validation",
        pageUrl: "/docs/compiled",
        unresolvedImageCount: 1,
      });
    }
  });

  it("supports JPEG, AVIF and GIF imports including explicit default-import image names", async () => {
    const result = await build(
      [
        'import screenshot from "./manual.jpeg"',
        "",
        '<img src={screenshot} alt="Manual import" title="Original" />',
        "",
        "![Photo](./photo.jpg)",
        "",
        "![Modern](./modern.avif)",
        "",
        "![Animation](./animation.gif)",
        "",
        '<img src={screenshot.src} alt="Static member" />',
        "",
        '<Image src={screenshot} alt="Manual component" title="Component title" />',
      ].join("\n"),
    );
    expect(result.tokens.map(({ variable }) => variable)).toEqual([
      "screenshot",
      "__img0",
      "__img1",
      "__img2",
      "screenshot",
      "screenshot",
    ]);
    expect(result.original).toEqual(result.after);
    const urls = [
      "/_next/static/media/manual.jpeg",
      "/_next/static/media/photo.jpg",
      "/_next/static/media/modern.avif",
      "/_next/static/media/animation.gif",
      "/_next/static/media/manual.jpeg",
      "/_next/static/media/manual.jpeg",
    ];
    const resolved = restoreLlmsImageSources(
      result.markdown,
      Object.fromEntries(result.tokens.map(({ token }, index) => [token, urls[index]])),
    );
    for (const url of urls) expect(resolved).toContain(url);
    expect(resolved).not.toContain('src="screenshot.src"');
    expect(resolved).toContain('alt="Static member"');
    expect(resolved).toContain('alt="Manual component"');
    expect(resolved).toContain('title="Component title"');
    expect(resolved).toContain('alt="Manual import"');
    expect(resolved).toContain('title="Original"');
    expect(await getLlmsDocText(compiledPage(resolved))).toContain(resolved);
    await expect(getLlmsDocText(compiledPage(result.markdown))).rejects.toMatchObject({
      unresolvedImageCount: 6,
    });
    await expect(
      getLlmsDocText(
        compiledPage(
          result.markdown,
          Object.fromEntries(result.tokens.map(({ token }, index) => [token, urls[index]])),
        ),
      ),
    ).resolves.toContain('title="Component title"');
  });

  it("rejects conditional expressions and a lost module map without evaluating authored JavaScript", async () => {
    const conditional = await build(
      'import hero from "./hero.png"\n\n<Image src={enabled ? hero : fallback} alt="Conditional" />',
    );
    expect(conditional.tokens).toEqual([]);
    await expect(getLlmsDocText(compiledPage(conditional.markdown))).rejects.toMatchObject({
      phase: "image-validation",
      unresolvedImageCount: 1,
    });
    const lostMap = await build('import hero from "./hero.png"\n\n<Image src={hero.src} />');
    expect(lostMap.tokens).toHaveLength(1);
    await expect(getLlmsDocText(compiledPage(lostMap.markdown))).rejects.toMatchObject({
      unresolvedImageCount: 1,
    });
  });

  it("accepts compiled no-token public URLs and preserves inline/fenced code examples", async () => {
    const source = [
      '<img src="./hero.png" alt="Relative" />',
      "",
      '<Image src="/public/hero.png" title="Absolute path" />',
      "",
      "![Remote](https://cdn.example/hero.png)",
      "",
      "`<Image src={hero} />`",
      "",
      "```mdx",
      '<img src="__img0" />',
      "```",
    ].join("\n");
    const result = await build(source);
    expect(result.tokens).toEqual([]);
    const text = await getLlmsDocText(compiledPage(result.markdown));
    expect(text).toContain('src="./hero.png"');
    expect(text).toContain('src="/public/hero.png"');
    expect(text).toContain("`<Image src={hero} />`");
    expect(text).toContain('```mdx\n<img src="__img0" />\n```');
  });

  it("uses a source-specific token namespace, without a circular MDAST reference", async () => {
    const a = await build("![A](/assets/a.png)"),
      b = await build("![B](/assets/b.png)");
    expect(a.tokens[0].token).not.toBe(b.tokens[0].token);
    expect(a.original).toEqual(a.after);
    expect(b.original).toEqual(b.after);
  });
});

const compiledPage = (markdown: string, assets?: unknown) => ({
  type: "page" as const,
  slugs: ["compiled"],
  url: "/docs/compiled",
  path: "compiled.mdx",
  absolutePath: undefined,
  data: {
    title: "Compiled",
    getText: async () => markdown,
    ...(assets ? { _exports: { _llmsImageSources: assets } } : {}),
  },
});
