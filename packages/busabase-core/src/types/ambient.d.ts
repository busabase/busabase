// Ambient declarations for dependencies that ship CSS/asset paths with no
// "types" condition in their package.json `exports` map, so a dynamic
// `import("pkg/foo.css")` expression (not just a side-effect `import "pkg/foo.css"`)
// has no type to resolve on its own. `@excalidraw/excalidraw`'s `./index.css`
// export is exactly this shape (development/production conditions, no types) —
// see the WhiteboardFieldEditor's lazy `Promise.all([import("@excalidraw/excalidraw"),
// import("@excalidraw/excalidraw/index.css")])` in dashboard/components/record-views.tsx.
// This repo's monorepo happens to have `@types/css-modules`/`@types/webpack-env`
// hoisted to the workspace root (pulled in by an unrelated app), which silently
// papers over this in-repo — but busabase-core has no dependency that provides
// it, so a standalone build of this package (e.g. the public busabase/busabase
// OSS repo, which resolves its own much smaller lockfile) fails without this.
declare module "*.css";
