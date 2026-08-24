import { implement } from "@orpc/server";
import { busabaseContract } from "busabase-contract/contract/busabase";
import { listTemplates } from "./logic/catalog";

/**
 * Template Center catalog — a thin read. Fetching, caching and URL resolution
 * live in logic/.
 *
 * Unguarded on purpose: the catalog lists open-source repositories, carries
 * nothing about this workspace, and a member who cannot install still benefits
 * from seeing what exists. The role check belongs on `install.*`, and is
 * already there.
 */
const os = implement(busabaseContract);

export const templatesRouter = {
  list: os.templates.list.handler(async ({ input }) => listTemplates(input)),
};
