import { implement, ORPCError } from "@orpc/server";
import { busabaseContract } from "busabase-contract/contract/busabase";
import type { GuideTopicVO, GuideVO } from "busabase-contract/domains/guides/types";
import { getContextSpaceId, LOCAL_SPACE_ID } from "../../context";
import { buildGuides } from "../../mcp-skill";

const os = implement(busabaseContract);

/**
 * The REST face of the guide catalog.
 *
 * Same source as MCP's `busabase_guide` tool and its `resources/*` documents, so
 * the two surfaces cannot end up saying different things — that was the whole
 * problem: anything driving `/api/v1` (busabase-cli, a script, a CI step) was
 * told none of the approval-first rules an MCP client is told on connect.
 *
 * Not served here are the workspace-dynamic topics `apps` and `skill:<slug>`.
 * They read the manuals installed in this particular workspace and need a
 * client to do it; a shell caller can already reach them with `skills list` /
 * `skills read-file`. They stay MCP-only until that is worth wiring.
 */

/**
 * This router is mounted by BOTH the self-hosted app and Cloud, so the catalog
 * is resolved per request rather than at module load. The two walkthroughs are
 * guided onboarding written around choosing a space, which is not a step that
 * exists on a single-workspace install, and the `workspace` reference has to be
 * built with space targeting OFF there or it teaches `targetSpaceId` — an
 * argument that server rejects. This mirrors exactly what the MCP handlers pass.
 */
const catalog = () => {
  const selfHosted = getContextSpaceId() === LOCAL_SPACE_ID;
  const guides = buildGuides({ spaceTargeting: !selfHosted });
  const topics = selfHosted ? ["workspace", "airapp"] : Object.keys(guides);
  return { guides, topics };
};

export const guidesRouter = {
  list: os.guides.list.handler((): GuideTopicVO[] => {
    const { guides, topics } = catalog();
    return topics.map((topic) => ({
      topic,
      title: guides[topic].title,
      kind: guides[topic].kind,
      summary: guides[topic].summary,
    }));
  }),
  read: os.guides.read.handler(({ input }): GuideVO => {
    const { guides, topics } = catalog();
    const guide = topics.includes(input.topic) ? guides[input.topic] : undefined;
    if (!guide) {
      // Listing the valid topics beats a bare "not found": the caller retries in
      // one step instead of guessing a second time.
      throw new ORPCError("NOT_FOUND", {
        message: `Unknown guide topic "${input.topic}". Available: ${topics.join(", ")}.`,
      });
    }
    return {
      topic: input.topic,
      title: guide.title,
      kind: guide.kind,
      content: guide.build(),
      otherTopics: topics.filter((name) => name !== input.topic),
    };
  }),
};
