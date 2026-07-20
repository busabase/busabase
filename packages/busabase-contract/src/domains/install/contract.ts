import { oc } from "@orpc/contract";
import {
  InstallFromGithubDTOSchema,
  InstallPlanFromGithubDTOSchema,
  InstallPlanVOSchema,
  InstallResultVOSchema,
} from "./types";

/**
 * Install domain oRPC routes — server-side "Install from GitHub" (spec §15).
 * Composed into the root contract in `contract/busabase.ts` under the `install`
 * key.
 *
 * The server does the whole job (fetch the zipball, validate, plan, apply)
 * because the browser cannot: a cross-origin zipball is blocked by CORS, and
 * letting a client hand the server arbitrary fetch targets is precisely the SSRF
 * hole. So the client only ever sends a URL and renders a plan.
 *
 * Both routes are gated on the space owner/admin role in the logic layer
 * (`logic/_guard.ts`): a package can carry skills and AirApps, i.e. code the
 * space's agents will execute. Installing one is an admin act, not a member act.
 */
export const installContract = {
  planFromGithub: oc
    .route({
      method: "POST",
      path: "/install/github/plan",
      tags: ["Install"],
      summary: "Dry-run a GitHub package install",
      successDescription:
        "What installing this package would create: the node outline, per-base record counts, slug collisions, warnings, and whether autoMerge is required. Creates nothing.",
    })
    .input(InstallPlanFromGithubDTOSchema)
    .output(InstallPlanVOSchema),
  fromGithub: oc
    .route({
      method: "POST",
      path: "/install/github",
      tags: ["Install"],
      summary: "Install a package from a GitHub repo",
      successDescription:
        "Created counts plus the number of change requests left for review. Structure (folders, Bases, fields, views) is created immediately — a pending Base has no id to attach a view or record to; content (records, docs, skills, AirApps) lands as change requests unless `autoMerge` is set.",
    })
    .input(InstallFromGithubDTOSchema)
    .output(InstallResultVOSchema),
};
