import { eventIterator, oc } from "@orpc/contract";
import { z } from "zod";
import {
  createFileTreeChangeRequestInputSchema,
  createFileTreeInputSchema,
  fileTreeFileOperationInputSchema,
  fileTreeFileSchema,
  fileTreeNodeSchema,
} from "../filetree/contract";
import type { AirAppFileVO, AirAppRunnerKind, AirAppVO } from "./types";

export type { AirAppFileVO, AirAppRunnerKind, AirAppVO };

// AirApps are served by the shared `/file-trees` surface (`type: "airapp"`) —
// see `../filetree/contract`. These aliases stay because callers name the
// schemas after the node type they are working with.
export const airappFileSchema = fileTreeFileSchema;
export const airappSchema = fileTreeNodeSchema;
export const createAirAppInputSchema = createFileTreeInputSchema;
export const airappFileOperationInputSchema = fileTreeFileOperationInputSchema;
export const createAirAppChangeRequestInputSchema = createFileTreeChangeRequestInputSchema;

// --- local runtime (server-side execution engine) -----------------------
// Mirrors the AirAppRunner interface's mount/install/start + onLog/onReady
// semantics as a single streamed operation instead of separate RPCs: the
// server owns the whole `npm install` -> `npm run dev` lifecycle for one
// LocalSandbox process, and the browser-side `LocalRunner` (see
// `busabase-core/domains/airapp/components/runners/local-runner.ts`)
// replays each event into the matching AirAppRunner callback. RPC-only by
// design (no `.route(...)`), same as `live.subscribe` — this is a long-lived
// Event Iterator, not a REST-shaped call.
export const airAppRunLocalInputSchema = z.object({
  nodeId: z.string(),
  /** Text files to mount into the sandbox workdir before installing, keyed by
   *  path (same shape `RunPanel` already assembles for `NodepodRunner.mount`). */
  files: z.record(z.string(), z.string()),
  /** Binary (asset-backed) files — images, fonts, sample data — keyed by the
   *  same path, base64-encoded because this input crosses a JSON boundary that
   *  `Uint8Array` cannot. Separate from `files` rather than a tagged union so
   *  an older client that sends only `files` keeps working unchanged.
   *
   *  The in-browser Nodepod engine never uses this field: it hands raw bytes to
   *  `Nodepod.boot({ files })` directly and skips the base64 round trip. */
  binaryFiles: z.record(z.string(), z.string()).optional().default({}),
  /** Where the server should run it. `"local"` spawns a bare process on the
   *  Busabase host (previewable, data bridge via reverse proxy, NOT isolated);
   *  `"remote"` runs the same lifecycle on a provisioned machine elsewhere.
   *  `"browser"` never reaches this endpoint — it runs entirely in the tab.
   *
   *  Required, deliberately. This used to default to `"local"`, so a call that
   *  simply omitted the field asked the server to spawn a host process — the
   *  most privileged of the two options, reached by saying nothing. Naming the
   *  engine is now the caller's job, and the handler independently refuses one
   *  this deployment does not offer. */
  engine: z.enum(["local", "remote"]),
});

export const airAppRuntimeEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("log"), line: z.string() }),
  z.object({ type: z.literal("installed") }),
  z.object({ type: z.literal("ready"), previewUrl: z.string() }),
  z.object({ type: z.literal("exit"), code: z.number().nullable() }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type AirAppRuntimeEvent = z.infer<typeof airAppRuntimeEventSchema>;

/**
 * Ending a run is a separate call, because a run outlives the stream that
 * started it. Closing the stream means "this viewer stopped watching", which
 * must not stop anybody's app — so there has to be a way to say the other thing.
 */
export const airAppStopLocalInputSchema = z.object({ nodeId: z.string() });

export const airAppStopLocalOutputSchema = z.object({
  /** `false` when nothing was running — stopping twice is not an error. */
  stopped: z.boolean(),
});

// --- site engine (a deployment, not a run) -----------------------------------

/** Why an app's files cannot go up as a site. The UI words each code. */
export const airAppSiteBlockerSchema = z.discriminatedUnion("code", [
  z.object({ code: z.literal("not-a-site-app") }),
  z.object({ code: z.literal("invalid-manifest"), detail: z.string() }),
  z.object({ code: z.literal("python-runtime") }),
  z.object({ code: z.literal("unsafe-path"), path: z.string() }),
  z.object({ code: z.literal("entry-missing"), path: z.string() }),
  z.object({ code: z.literal("entry-not-javascript"), path: z.string() }),
  z.object({ code: z.literal("entry-syntax-error"), path: z.string(), detail: z.string() }),
  z.object({ code: z.literal("entry-no-default-export"), path: z.string() }),
  z.object({ code: z.literal("unsupported-import"), path: z.string(), specifier: z.string() }),
  z.object({ code: z.literal("no-index-page"), path: z.string() }),
  z.object({ code: z.literal("asset-too-large"), path: z.string(), size: z.number() }),
  z.object({ code: z.literal("too-many-assets"), count: z.number() }),
]);
export type AirAppSiteBlocker = z.infer<typeof airAppSiteBlockerSchema>;

/**
 * - `not-live`: nobody can open the address. It may have been live before.
 * - `live`: the address serves exactly what the app's files say.
 * - `live-with-changes`: the address serves an older version than the files.
 */
export const airAppSitePublicationSchema = z.enum(["not-live", "live", "live-with-changes"]);
export type AirAppSitePublication = z.infer<typeof airAppSitePublicationSchema>;

export const airAppSiteStateSchema = z.object({
  /** Asked again on every call, so a lapsed plan or removed config shows at once. */
  engine: z.enum(["available", "locked", "not-configured", "not-offered"]),
  /** Where the site is served once live. `null` where the engine is not offered. */
  address: z.string().nullable(),
  publication: airAppSitePublicationSchema,
  /** The public switch: whether the address serves the live version at all. */
  isPublic: z.boolean(),
  /** Same-origin, members-only. `null` until a preview exists. */
  previewUrl: z.string().nullable(),
  previewVersion: z.string().nullable(),
  liveVersion: z.string().nullable(),
  /** What the app's files would deploy as now. `null` while `blockers` stand in the way. */
  currentVersion: z.string().nullable(),
  /** The files changed since the preview, so Go live would not publish what they say. */
  previewStale: z.boolean(),
  previewDeployedAt: z.string().nullable(),
  liveDeployedAt: z.string().nullable(),
  blockers: z.array(airAppSiteBlockerSchema),
});
export type AirAppSiteStateVO = z.infer<typeof airAppSiteStateSchema>;

/**
 * `ok`: done. `blocked`: the files cannot deploy; `state.blockers` says why.
 * `preview-stale`: the files changed since the preview, so nothing was published.
 * `no-preview`: there is nothing to publish yet.
 */
export const airAppSiteActionOutputSchema = z.object({
  outcome: z.enum(["ok", "blocked", "preview-stale", "no-preview"]),
  state: airAppSiteStateSchema,
});
export type AirAppSiteActionVO = z.infer<typeof airAppSiteActionOutputSchema>;

export const airAppSiteInputSchema = z.object({ nodeId: z.string() });

/** A hostname only: schemes, paths, ports, IP addresses and wildcards cannot bind. */
export const airAppSiteHostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
    "Enter a hostname such as shop.company.com, without https:// or a path.",
  );

export const airAppSiteDomainInputSchema = airAppSiteInputSchema.extend({
  hostname: airAppSiteHostnameSchema,
});

export const airAppSiteDomainSchema = z.object({
  hostname: z.string(),
  url: z.string(),
  status: z.enum(["pending", "active", "error"]),
  hostnameStatus: z.string().nullable(),
  sslStatus: z.string().nullable(),
  dnsRecords: z.array(z.object({ type: z.string(), name: z.string(), value: z.string() })),
  errors: z.array(z.string()),
});
export type AirAppSiteDomainVO = z.infer<typeof airAppSiteDomainSchema>;
export type AirAppSiteDomainBindingVO = AirAppSiteDomainVO;

export const airAppSiteDomainsSchema = z.object({
  available: z.boolean(),
  cnameTarget: z.string().nullable(),
  bindings: z.array(airAppSiteDomainSchema),
});
export type AirAppSiteDomainsVO = z.infer<typeof airAppSiteDomainsSchema>;

export const airappRuntimeContract = {
  runLocal: oc.input(airAppRunLocalInputSchema).output(eventIterator(airAppRuntimeEventSchema)),
  stopLocal: oc.input(airAppStopLocalInputSchema).output(airAppStopLocalOutputSchema),
  siteState: oc.input(airAppSiteInputSchema).output(airAppSiteStateSchema),
  /** Uploads the current files as the members-only preview, unless they already are it. */
  siteDeployPreview: oc.input(airAppSiteInputSchema).output(airAppSiteActionOutputSchema),
  /** Promotes the previewed version to the public address. Never publishes anything else. */
  siteGoLive: oc.input(airAppSiteInputSchema).output(airAppSiteActionOutputSchema),
  /** Turns the public switch back on for the version already live. */
  siteRepublish: oc.input(airAppSiteInputSchema).output(airAppSiteActionOutputSchema),
  /** Turns the public switch off. Available whatever the plan, so a site can always come down. */
  siteUnpublish: oc.input(airAppSiteInputSchema).output(airAppSiteActionOutputSchema),
  /** Fresh domain status and DNS instructions; remains readable after a plan lapses. */
  siteDomains: oc.input(airAppSiteInputSchema).output(airAppSiteDomainsSchema),
  siteBindDomain: oc.input(airAppSiteDomainInputSchema).output(airAppSiteDomainsSchema),
  /** Removal remains possible after a plan lapses. */
  siteUnbindDomain: oc.input(airAppSiteDomainInputSchema).output(airAppSiteDomainsSchema),
};
