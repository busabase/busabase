import { implement } from "@orpc/server";
import { busabaseContract } from "busabase-contract/contract/busabase";
import { installFromGithub, planInstallFromGithub } from "./logic/install-logic";

// Install domain oRPC handler slice — server-side "Install from GitHub" (spec
// §15). Thin handlers only; the fetch/SSRF guard, the admin gate, planning, and
// the five-pass apply all live in logic/. Aggregated into the kernel router
// (router.ts).
const os = implement(busabaseContract);

export const installRouter = {
  planFromGithub: os.install.planFromGithub.handler(async ({ input }) =>
    planInstallFromGithub(input),
  ),
  fromGithub: os.install.fromGithub.handler(async ({ input }) => installFromGithub(input)),
};
