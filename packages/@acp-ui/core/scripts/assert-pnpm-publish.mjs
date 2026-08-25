// This package keeps `exports` pointing at ./src/*.ts so in-repo consumers can
// import the TypeScript directly, and relies on `publishConfig.exports` to
// rewrite them to ./dist/*.js in the published tarball.
//
// Only pnpm applies `publishConfig`. npm ignores it — so `npm publish` ships an
// exports map pointing at .ts files that are not in the tarball, and every
// consumer gets ERR_MODULE_NOT_FOUND on import. That is exactly how 0.1.0,
// 1.0.0 and 1.1.0 all went out broken.
const agent = process.env.npm_config_user_agent ?? "";

if (!agent.startsWith("pnpm")) {
  console.error(`
  Publish with \`pnpm publish\`, not npm.

  This package's \`exports\` point at ./src/*.ts for in-repo consumers, and
  \`publishConfig.exports\` rewrites them to ./dist/*.js when publishing.
  Only pnpm applies publishConfig; npm ignores it and ships a tarball whose
  exports reference .ts files that aren't in it.

  Detected package manager: ${agent || "(unknown)"}
`);
  process.exit(1);
}
