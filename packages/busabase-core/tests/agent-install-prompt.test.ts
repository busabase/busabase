import { describe, expect, it } from "vitest";
import {
  buildAgentInstallCommand,
  buildAgentInstallPrompt,
  skillNameForSource,
} from "../src/domains/dashboard/helpers/agent-install-prompt";
import { fmt } from "../src/i18n/fmt";
import { coreMessagesEn } from "../src/i18n/messages";

/**
 * The Agent install tab's whole product is one command line the user pastes into
 * a terminal. It is worth asserting rather than eyeballing: a wrong skill name
 * fails in the user's shell, several minutes and one context switch away from
 * the screen that produced it.
 */
describe("agent install prompt", () => {
  const catalogSource = {
    owner: "busabase",
    repo: "skills",
    ref: "main",
    subdir: "skills/kelly-email",
  };

  it("selects the skill by its directory name inside a skills repository", () => {
    expect(skillNameForSource(catalogSource)).toBe("kelly-email");
    expect(buildAgentInstallCommand(catalogSource)).toBe(
      "npx skills add busabase/skills --skill kelly-email",
    );
  });

  it("omits --skill when the repository root IS the package", () => {
    const source = { owner: "mr-kelly", repo: "kelly-email" };
    expect(skillNameForSource(source)).toBeNull();
    expect(buildAgentInstallCommand(source)).toBe("npx skills add mr-kelly/kelly-email");
  });

  it("never passes the ref as a flag `skills add` may not have", () => {
    // The ref is surfaced as prose next to the box instead — a command that
    // fails to parse is worse than one that installs the default branch.
    expect(buildAgentInstallCommand(catalogSource)).not.toContain("main");
  });

  it("builds a prompt that carries the command and tells the agent not to write", () => {
    const prompt = buildAgentInstallPrompt({
      source: catalogSource,
      packageName: "Kelly Email",
      template: coreMessagesEn.install.agentPromptBody,
      fmt,
    });
    expect(prompt).toContain("npx skills add busabase/skills --skill kelly-email");
    expect(prompt).toContain("kelly-email");
    expect(prompt).toMatch(/do not create, change or delete anything/i);
    expect(prompt).not.toContain("{command}");
    expect(prompt).not.toContain("{name}");
  });

  it("falls back to the package name when there is no subdirectory to name", () => {
    const prompt = buildAgentInstallPrompt({
      source: { owner: "acme", repo: "crm-package" },
      packageName: "Acme CRM",
      template: coreMessagesEn.install.agentPromptBody,
      fmt,
    });
    expect(prompt).toContain("Acme CRM");
  });
});
