import { makeFileTreeNodeType } from "../filetree/definition";

/** Storage-backed skill (no extra DB tables). Owns the skill_file_* / skill_metadata_* operations. */
export const skillNodeType = makeFileTreeNodeType({
  type: "skill",
  label: "Skill",
  icon: "sparkles",
  routeBase: "skills",
  tag: "Skills",
  entryFile: "SKILL.md",
});
