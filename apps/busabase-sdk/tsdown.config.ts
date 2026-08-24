import { copyFile, mkdir } from "node:fs/promises";
import { defineConfig } from "tsdown";

// busabase-contract / open-domains / openlib ship TypeScript source (their package
// exports point at `./src/*.ts`), so they cannot be runtime dependencies of a
// published npm SDK. Bundle the (pure, isomorphic) oRPC contract + VO types
// straight into dist instead — the SDK then has zero workspace deps and installs
// standalone. zod + @orpc/* stay external (real runtime dependencies).
//
// Unlike busabase-cli (a binary, `dts: false`), the SDK is a *library*: emit type
// declarations so external TypeScript consumers get full autocomplete over the
// bundled VO/DTO graph.
export default defineConfig({
  entry: {
    index: "src/index.ts",
    oauth: "src/oauth.ts",
    "oauth-node": "src/oauth-node.ts",
    "airapp-node": "src/airapp-node.ts",
    airapp: "src/airapp.ts",
    "airapp-gate": "src/airapp-gate.ts",
  },
  format: ["esm"],
  target: "node20",
  platform: "neutral",
  outDir: "dist",
  clean: true,
  // Rolldown's dts plugin bundles types for whatever's in `noExternal` as part of
  // its normal module graph (unlike tsup/rollup-plugin-dts, which needed an
  // explicit `resolve: true` to inline workspace types into dist/index.d.ts).
  // Force the `tsgo` generator with a REPO-ROOT dts tsconfig. Under TypeScript 7
  // the `tsc` generator is unusable — it does `require("typescript")` and needs
  // `typescript/lib/typescript.js` (the Compiler API), which the native Go
  // compiler no longer ships. `tsgo` works, with one catch: the plugin passes
  // `--rootDir <directory of the dts tsconfig>` on the CLI, and the `noExternal`
  // sources live outside this package — so the tsconfig must sit at the
  // workspace root (see the comment inside it). `oxc` also works but demands
  // isolatedDeclarations-style explicit annotations on every export of every
  // bundled package (~1500 in busabase-contract alone); tsgo infers them.
  dts: { generator: "tsgo", tsconfig: "../../tsconfig.busabase-sdk-dts.json" },
  treeshake: true,
  noExternal: [/^busabase-contract/, /^open-domains/, /^openlib/],
  // The gate's default stylesheet is plain CSS with no build step of its own —
  // copy it beside the JS so `busabase-sdk/airapp-gate.css` resolves under the
  // same dist-only `files` allowlist as everything else.
  async onSuccess() {
    await mkdir("dist", { recursive: true });
    await copyFile("src/airapp-gate.css", "dist/airapp-gate.css");
  },
});
