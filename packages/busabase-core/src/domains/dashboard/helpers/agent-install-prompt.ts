/**
 * "Agent install" — the copy-pasteable half of the install dialog.
 *
 * A template carries two things that travel separately: the *resources* (Folder,
 * Bases, AirApp) and the *manual* (`SKILL.md`) that tells an agent how to drive
 * them. "UI install" puts the resources in this space and leaves an external
 * agent none the wiser; this is the other direction — it hands the manual to an
 * agent and touches nothing in the space.
 *
 * Deliberately install-only: the prompt tells the agent to add the skill and
 * then STOP. An agent that helpfully provisions a Folder on the way would make
 * the two tabs do the same thing by different routes, and the user picked a tab
 * precisely to say which one they wanted.
 *
 * Pure: takes a resolved source + the localized strings, returns text. No react,
 * no db, no transport — so the command it prints can be asserted in a unit test
 * rather than read off a screenshot.
 */

/** The `source` a plan echoes back, narrowed to what a command line needs. */
export interface AgentInstallSource {
  owner: string;
  repo: string;
  ref?: string;
  subdir?: string;
}

/**
 * The skill's own name in the `skills` CLI sense — the LAST path segment of the
 * package's subdirectory (`skills/kelly-email` → `kelly-email`), which is the
 * directory `npx skills add --skill` matches on.
 *
 * A package installed from a repository root has no subdirectory and therefore
 * no name to select: the repository IS the skill.
 */
export const skillNameForSource = (source: AgentInstallSource): string | null => {
  const segments = (source.subdir ?? "").split("/").filter(Boolean);
  return segments.length > 0 ? (segments.at(-1) as string) : null;
};

/**
 * `npx skills add <owner>/<repo> [--skill <name>]`.
 *
 * The ref is NOT passed as a flag. `skills add` takes a repository, and inventing
 * a `--ref` it may not have would produce a command that fails in the user's
 * terminal — worse than a command that installs the default branch, which is
 * what the catalog is built from anyway. Callers surface the ref as prose.
 */
export const buildAgentInstallCommand = (source: AgentInstallSource): string => {
  const skill = skillNameForSource(source);
  const repo = `${source.owner}/${source.repo}`;
  return skill ? `npx skills add ${repo} --skill ${skill}` : `npx skills add ${repo}`;
};

export interface AgentInstallPromptOptions {
  source: AgentInstallSource;
  /** The package's display name, used when the source carries no subdirectory. */
  packageName: string;
  /**
   * Localized body with `{name}` and `{command}` placeholders — the dialog passes
   * `messages.install.agentPromptBody`, so the pasted text follows the UI
   * language the way `createAgentSkillPrompt` already does.
   */
  template: string;
  fmt: (template: string, values: Record<string, string>) => string;
}

/** The text the user copies and pastes into their agent. */
export const buildAgentInstallPrompt = ({
  source,
  packageName,
  template,
  fmt,
}: AgentInstallPromptOptions): string =>
  fmt(template, {
    name: skillNameForSource(source) ?? packageName,
    command: buildAgentInstallCommand(source),
  });
