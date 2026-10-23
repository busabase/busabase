/**
 * "Agent install" — the copy-pasteable half of the install dialog.
 *
 * A template carries two things that travel separately: the *resources* (Folder,
 * Bases, AirApp) and the *manual* (`SKILL.md`) that tells an agent how to drive
 * them. Template packages use Busabase's CLI for resources in the connected
 * space and the skills CLI for the local manual. Standalone skills need only
 * the skills CLI.
 *
 * Pure: takes a resolved source + the localized strings, returns text. No react,
 * no db, no transport — so the command it prints can be asserted in a unit test
 * rather than read off a screenshot.
 */

import { renderAgentConnectionCheck } from "./agent-prompt-dispatch";

/** The `source` a plan echoes back, narrowed to what a command line needs. */
export interface AgentInstallSource {
  owner: string;
  repo: string;
  ref?: string;
  subdir?: string;
}

/**
 * The package selector is the LAST path segment of its subdirectory.
 *
 * A package installed from a repository root has no subdirectory and therefore
 * no name to select: the repository IS the skill.
 */
export const skillNameForSource = (source: AgentInstallSource): string | null => {
  const segments = (source.subdir ?? "").split("/").filter(Boolean);
  return segments.length > 0 ? (segments.at(-1) as string) : null;
};

export const isTemplateInstallSource = (source: AgentInstallSource): boolean =>
  (source.subdir ?? "").split("/").filter(Boolean).join("/").startsWith("templates/");

/** Templates install both space resources and the local agent skill. */
export const buildAgentInstallCommand = (source: AgentInstallSource): string => {
  if (isTemplateInstallSource(source)) {
    const ref = source.ref || "main";
    const encodedRef = encodeURIComponent(ref);
    const repo = `${source.owner}/${source.repo}`;
    const repoUrl = `https://github.com/${repo}/tree/${encodedRef}`;
    const subdir = (source.subdir ?? "")
      .split("/")
      .filter(Boolean)
      .map(encodeURIComponent)
      .join("/");
    // skills decodes fragment refs, but treats encoded tree refs as literal branch names.
    const localSkillSource =
      encodedRef === ref ? `${repoUrl}/${subdir}` : `${repo}/${subdir}#${encodedRef}`;
    return [
      `npx --yes busabase-cli@latest install ${repoUrl} --skill ${skillNameForSource(source)}`,
      `npx skills add ${localSkillSource}`,
    ].join("\n");
  }

  const skill = skillNameForSource(source);
  const repo = `${source.owner}/${source.repo}`;
  return skill ? `npx skills add ${repo} --skill ${skill}` : `npx skills add ${repo}`;
};

export interface AgentInstallPromptOptions {
  source: AgentInstallSource;
  /** The package's display name, used when the source carries no subdirectory. */
  packageName: string;
  /** Credential-free onboarding guide for this host and target space. */
  setupUrl: string;
  /** Cloud only: the exact space the agent must verify before installing. */
  targetSpaceId?: string;
  /**
   * Localized body with `{name}`, `{command}` and `{connectionCheck}`
   * placeholders — the dialog passes `messages.install.agentPromptBody`, so the
   * pasted text follows the UI language the way `createAgentSkillPrompt` does.
   */
  template: string;
  /**
   * The "is this environment even connected?" paragraph, shared verbatim with
   * the node Agent-prompts dialog (`messages.agentPrompts.connectionCheck`).
   *
   * It lives in its own key rather than inline in `template` because both
   * surfaces hand a prompt to an agent that may have never heard of this space,
   * and two hand-maintained copies of that paragraph would drift the moment one
   * of them is reworded. The install-specific lead-in ("Before installing, ")
   * stays inside `template`, so this reads as one sentence in either caller.
   */
  connectionCheck: string;
  fmt: (template: string, values: Record<string, string>) => string;
}

/** The text the user copies and pastes into their agent. */
export const buildAgentInstallPrompt = ({
  source,
  packageName,
  setupUrl,
  targetSpaceId,
  template,
  connectionCheck,
  fmt,
}: AgentInstallPromptOptions): string =>
  fmt(template, {
    name: skillNameForSource(source) ?? packageName,
    command: buildAgentInstallCommand(source),
    // Rendered FIRST, then spliced in: `fmt` is a single pass whose replacements
    // are not rescanned, so `{setupUrl}`/`{targetSpace}` inside the shared
    // paragraph would survive as literal braces if they were left to the outer
    // call. Same reason `renderAgentConnectionCheck` exists at all.
    connectionCheck: renderAgentConnectionCheck({
      connectionCheck,
      fmt,
      setupUrl,
      targetSpaceId,
    }),
  });
