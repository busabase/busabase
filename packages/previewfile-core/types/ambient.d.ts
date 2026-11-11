// Ambient declarations for previewfile-core dependencies that ship without
// types. These mirror what previewfile-core viewers actually use.
//
// previewfile-core ships TypeScript source, so these only count where a
// program includes this file: each viewer that imports one of the modules
// below starts with `/// <reference path="../../types/ambient.d.ts" />`, which
// brings it along into any host that compiles the viewer — no host shim.

// Side-effect CSS imports from react-pdf / video.js (no bundled type declarations).
declare module "*.css";

declare module "sql.js" {
  // Minimal subset used by SqliteViewer; refine if more APIs are touched.
  const initSqlJs: any;
  export default initSqlJs;
}

declare module "x-data-spreadsheet/dist/xspreadsheet" {
  const xspreadsheet: any;
  export default xspreadsheet;
}

declare module "libarchive.js" {
  export const Archive: any;
}
