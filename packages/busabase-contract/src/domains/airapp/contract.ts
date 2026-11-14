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

/** `hostname: null` clears the primary, so every custom domain serves the site directly. */
export const airAppSitePrimaryDomainInputSchema = airAppSiteInputSchema.extend({
  hostname: airAppSiteHostnameSchema.nullable(),
});

/**
 * What this deployment itself found wrong with a domain, as codes the client
 * words in the viewer's language. Provider messages stay in `errors`.
 * - `target-missing`: the deployment has no CNAME target configured.
 * - `route-unverified`: the hostname does not reach this website yet.
 * - `check-failed`: the provider could not be asked; check again.
 */
export const airAppSiteDomainIssueSchema = z.enum([
  "target-missing",
  "route-unverified",
  "check-failed",
]);
export type AirAppSiteDomainIssue = z.infer<typeof airAppSiteDomainIssueSchema>;

export const airAppSiteDomainSchema = z.object({
  hostname: z.string(),
  url: z.string(),
  status: z.enum(["pending", "active", "error"]),
  hostnameStatus: z.string().nullable(),
  sslStatus: z.string().nullable(),
  dnsRecords: z.array(z.object({ type: z.string(), name: z.string(), value: z.string() })),
  /** The hosting provider's own messages, verbatim (not translated). */
  errors: z.array(z.string()),
  issues: z.array(airAppSiteDomainIssueSchema).default([]),
  /** This domain serves the site; every other custom domain redirects here. */
  isPrimary: z.boolean().default(false),
  /** The primary hostname this domain answers 308 to, keeping path and query; null for the primary or when there is none. */
  redirectsTo: z.string().nullable().default(null),
});
export type AirAppSiteDomainVO = z.infer<typeof airAppSiteDomainSchema>;
export type AirAppSiteDomainBindingVO = AirAppSiteDomainVO;

export const airAppSiteDomainsSchema = z.object({
  available: z.boolean(),
  cnameTarget: z.string().nullable(),
  bindings: z.array(airAppSiteDomainSchema),
  /** The custom domain the others redirect to; null means every domain serves the site directly. */
  primaryHostname: z.string().nullable().default(null),
  /** False when this deployment's website host cannot redirect to a primary domain yet. */
  primarySupported: z.boolean().default(false),
});
export type AirAppSiteDomainsVO = z.infer<typeof airAppSiteDomainsSchema>;

/**
 * The Website engine's actions are public (`/api/v1/airapps/{nodeId}/site…`), not
 * only the dashboard's: an agent that changes a site's files must be able to put
 * the reviewed result up, the way a deploy CLI does, without a person clicking.
 * Same `node("write")` level as the buttons.
 */
const SITE_TAGS = ["Websites"];

export const airappRuntimeContract = {
  runLocal: oc.input(airAppRunLocalInputSchema).output(eventIterator(airAppRuntimeEventSchema)),
  stopLocal: oc.input(airAppStopLocalInputSchema).output(airAppStopLocalOutputSchema),
  siteState: oc
    .route({
      method: "GET",
      path: "/airapps/{nodeId}/site",
      tags: SITE_TAGS,
      summary: "Get an AirApp website's state",
      successDescription:
        "Whether the Website engine is available here (`engine`), the public `address`, `publication` (not live / live / live with unpublished changes), the public switch (`isPublic`), the preview and live versions, `currentVersion` (what the files would deploy as now), `previewStale` (files changed since the preview), and `blockers` that stop the files from deploying.",
    })
    .input(airAppSiteInputSchema)
    .output(airAppSiteStateSchema),
  /** Uploads the current files as the members-only preview, unless they already are it. */
  siteDeployPreview: oc
    .route({
      method: "POST",
      path: "/airapps/{nodeId}/site/preview",
      tags: SITE_TAGS,
      summary: "Deploy the website preview (Restart)",
      successDescription:
        "Uploads the AirApp's current files as the members-only preview (the dashboard's Restart), unless the preview already is this version. `outcome: blocked` means the files cannot deploy; `state.blockers` says why. Nothing public changes.",
    })
    .input(airAppSiteInputSchema)
    .output(airAppSiteActionOutputSchema),
  /** Promotes the previewed version to the public address. Never publishes anything else. */
  siteGoLive: oc
    .route({
      method: "POST",
      path: "/airapps/{nodeId}/site/go-live",
      tags: SITE_TAGS,
      summary: "Publish the previewed version (Go live)",
      successDescription:
        "Puts the previewed version on the public address, and only that version. `outcome: preview-stale` means the files changed after the preview, so nothing was published: deploy the preview again first. `outcome: no-preview` means there is no preview yet. Anyone with the address can use a public site.",
    })
    .input(airAppSiteInputSchema)
    .output(airAppSiteActionOutputSchema),
  /** Turns the public switch back on for the version already live. */
  siteRepublish: oc
    .route({
      method: "POST",
      path: "/airapps/{nodeId}/site/republish",
      tags: SITE_TAGS,
      summary: "Turn the public address back on",
      successDescription:
        "Serves the version that was already live again after an unpublish. Publishes nothing new; `outcome: no-preview` means nothing has ever gone live.",
    })
    .input(airAppSiteInputSchema)
    .output(airAppSiteActionOutputSchema),
  /** Turns the public switch off. Available whatever the plan, so a site can always come down. */
  siteUnpublish: oc
    .route({
      method: "POST",
      path: "/airapps/{nodeId}/site/unpublish",
      tags: SITE_TAGS,
      summary: "Take the website offline",
      successDescription:
        "Turns the public switch off: every website address answers not found until it is republished. Works whatever the plan, so a site can always come down.",
    })
    .input(airAppSiteInputSchema)
    .output(airAppSiteActionOutputSchema),
  /** Fresh domain status and DNS instructions; remains readable after a plan lapses. */
  siteDomains: oc
    .route({
      method: "GET",
      path: "/airapps/{nodeId}/site/domains",
      tags: SITE_TAGS,
      summary: "List a website's custom domains",
      successDescription:
        "Each bound domain's fresh status (`pending`, `active`, `error`), the DNS records to add (`dnsRecords`), this deployment's findings as codes (`issues`) and the provider's own messages (`errors`), plus the CNAME target (`cnameTarget`) a new domain should point to. Checks again on every call.",
    })
    .input(airAppSiteInputSchema)
    .output(airAppSiteDomainsSchema),
  siteBindDomain: oc
    .route({
      method: "POST",
      path: "/airapps/{nodeId}/site/domains",
      tags: SITE_TAGS,
      summary: "Add a custom domain to a website",
      successDescription:
        "Binds a hostname the space owns (`shop.company.com`, no scheme or path) to a website that has gone live, and returns the domains with the DNS records to add at the DNS provider. The domain serves the site once DNS and HTTPS are ready.",
    })
    .input(airAppSiteDomainInputSchema)
    .output(airAppSiteDomainsSchema),
  /** Removal remains possible after a plan lapses. */
  siteUnbindDomain: oc
    .route({
      method: "DELETE",
      path: "/airapps/{nodeId}/site/domains/{hostname}",
      tags: SITE_TAGS,
      summary: "Remove a custom domain from a website",
      successDescription:
        "The hostname stops serving this website; its generated address keeps working. Possible after a plan lapses.",
    })
    .input(airAppSiteDomainInputSchema)
    .output(airAppSiteDomainsSchema),
  siteSetPrimaryDomain: oc
    .route({
      method: "POST",
      path: "/airapps/{nodeId}/site/domains/primary",
      tags: SITE_TAGS,
      summary: "Choose a website's primary custom domain",
      successDescription:
        "Makes one bound hostname the primary: every other custom domain of the website answers a permanent redirect (308) to it, keeping the path and query. `hostname: null` clears the primary so every domain serves the site directly. The generated address never redirects. The first domain bound becomes primary automatically.",
    })
    .input(airAppSitePrimaryDomainInputSchema)
    .output(airAppSiteDomainsSchema),
};
