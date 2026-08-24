import { oc } from "@orpc/contract";
import { ListTemplatesDTOSchema, TemplateCatalogVOSchema } from "./types";

/**
 * Template Center — the catalog a user browses before installing.
 *
 * Read-only and server-side on purpose. The catalog lives in a GitHub
 * repository, and a browser fetching it directly would hit CORS, would have no
 * cache shared between users, and would let the page decide which host to trust.
 * Installing is NOT here: a card's button hands its URL to the existing
 * `install.*` routes, so browsing and installing cannot disagree about what a
 * package is or who is allowed to install it.
 */
export const templatesContract = {
  list: oc
    .route({
      method: "GET",
      path: "/templates",
      tags: ["Templates"],
      summary: "List the Template Center catalog",
      successDescription:
        "The templates this server's configured catalog publishes, with provenance and per-template stats. `error` is set when the catalog could not be fetched, so an empty gallery can say why.",
    })
    .input(ListTemplatesDTOSchema)
    .output(TemplateCatalogVOSchema),
};
