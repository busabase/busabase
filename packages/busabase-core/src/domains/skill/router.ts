import { implement } from "@orpc/server";
import { busabaseContract } from "busabase-contract/contract/busabase";
import {
  createSkill,
  createSkillChangeRequest,
  getSkill,
  listSkillFiles,
  listSkills,
  readSkillFile,
} from "./handlers";

// Skill domain oRPC handler slice; aggregated into the kernel router (router.ts).
const os = implement(busabaseContract);

export const skillRouter = {
  list: os.skills.list.handler(async () => listSkills()),
  create: os.skills.create.handler(async ({ input }) => createSkill(input)),
  get: os.skills.get.handler(async ({ input }) => getSkill(input.nodeId)),
  listFiles: os.skills.listFiles.handler(async ({ input }) => listSkillFiles(input.nodeId)),
  readFile: os.skills.readFile.handler(async ({ input }) =>
    readSkillFile(input.nodeId, input.filePath),
  ),
  createChangeRequest: os.skills.createChangeRequest.handler(async ({ input }) => {
    const { nodeId, ...rest } = input;
    return createSkillChangeRequest(nodeId, rest);
  }),
};
