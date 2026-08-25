import { oc } from "@orpc/contract";
import { z } from "zod";
import { GuideTopicVOSchema, GuideVOSchema, ReadGuideInputSchema } from "./types";

export const guidesContract = {
  list: oc
    .route({
      method: "GET",
      path: "/guides",
      tags: ["Guides"],
      summary: "List the guides this deployment serves",
      successDescription:
        "The guide catalog: topic, title, kind, and a one-line summary. Read one with `GET /guides/{topic}`.",
    })
    .output(z.array(GuideTopicVOSchema)),
  read: oc
    .route({
      method: "GET",
      path: "/guides/{topic}",
      tags: ["Guides"],
      summary: "Read one guide",
      successDescription:
        "The full markdown document, plus the other topics served here. Read `workspace` before proposing changes and `airapp` before writing any AirApp file.",
    })
    .input(ReadGuideInputSchema)
    .output(GuideVOSchema),
};
