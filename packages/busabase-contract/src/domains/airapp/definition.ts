import { makeFileTreeNodeType } from "../filetree/definition";

/**
 * Storage-backed airapp (no extra DB tables). Owns the airapp_file_* /
 * airapp_metadata_* operations. An agent writes a small Node/Hono project into
 * the file tree via the normal ChangeRequest flow; a human opens the node and
 * runs it in-browser (see busabase-core's `domains/airapp/components/RunPanel`).
 */
export const airappNodeType = makeFileTreeNodeType({
  type: "airapp",
  label: "AirApp",
  icon: "app-window",
  routeBase: "airapps",
  tag: "AirApps",
  entryFile: "package.json",
  // `"runtime"`, not `"detail"`/`"submit"`: an AirApp is a program, not a
  // document, so a public link resolves it through `resolvePublicAirAppRuntime`
  // (`resolvePublicView()` in the dashboard page, landing on `PublicNodeView` /
  // `PublicAirAppView` — the same relayed runtime Embed Links use) rather than
  // the generic anonymous `nodes.get` read path — which must keep refusing
  // type `airapp` (see `isPubliclyReadableNodeType`, which only treats
  // "detail"/"submit" as readable).
  //
  // History, so the next person doesn't have to re-derive it from git log:
  // PR #6751 ("open shared whiteboards anonymously", 2026-08-28) deliberately
  // set this to "no" — at the time, a public AirApp link resolved through the
  // generic `AirAppDetailView`, whose anonymous `nodes.get` correctly refuses
  // `airapp`, producing a dead link (a real P1 its review caught). #6751 left
  // this exact flag as a TODO: "needs the isolated runtime from PR #6648;
  // until merged, publicAccess: no." #6648 merged six days later and built
  // that isolated runtime in full — but never came back to flip this flag, so
  // it silently stayed "no" and every public AirApp share 404'd for three
  // weeks until this fix. This is therefore NOT a blind re-flip of something
  // two PRs backed away from: the original dead-link failure mode is exactly
  // what #6648 fixed, and turning this on again was verified against that
  // already-shipped runtime (tests/e2e/public-airapp-share.spec.ts passing —
  // it asserts landing on the relayed view, not the old detail view).
  //
  // This flag is the ONLY thing gating both `canShareToWeb` in the Share
  // dialog and `resolvePublicTargetNode`'s entry check. Flipping it back to
  // "no" without first confirming #6648's relay is still in place would
  // reintroduce the exact dead link #6751 was defending against.
  publicAccess: "runtime",
});
