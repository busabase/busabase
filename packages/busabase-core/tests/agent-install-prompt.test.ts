import { describe, expect, it } from "vitest";
import { createSetupSkillUrl } from "../src/domains/dashboard/components/agent-skill-button";
import {
  buildAgentInstallCommand,
  buildAgentInstallPrompt,
  skillNameForSource,
} from "../src/domains/dashboard/helpers/agent-install-prompt";
import { coreMessagesByLocale } from "../src/i18n";
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
    const setupUrl = createSetupSkillUrl("https://app.busabase.com", "cloud", true, "space_target");
    const prompt = buildAgentInstallPrompt({
      source: catalogSource,
      packageName: "Kelly Email",
      setupUrl,
      targetSpaceId: "space_target",
      template: coreMessagesEn.install.agentPromptBody,
      fmt,
    });
    expect(prompt).toContain("npx skills add busabase/skills --skill kelly-email");
    expect(prompt).toContain("kelly-email");
    expect(prompt).toContain("space_target");
    expect(prompt).toContain(setupUrl);
    expect(prompt).toContain("edition=cloud");
    expect(prompt).toContain("editionConfirmed=1");
    expect(prompt).toContain("space=space_target");
    expect(prompt).toMatch(/do not create, change or delete anything/i);
    expect(prompt).not.toMatch(/\{[a-zA-Z]+\}/);
    expect(prompt).not.toMatch(/api[_ -]?key|access[_ -]?token|secret/i);
  });

  it("falls back to the package name when there is no subdirectory to name", () => {
    const prompt = buildAgentInstallPrompt({
      source: { owner: "acme", repo: "crm-package" },
      packageName: "Acme CRM",
      setupUrl: createSetupSkillUrl("http://localhost:15419", "desktop", true),
      template: coreMessagesEn.install.agentPromptBody,
      fmt,
    });
    expect(prompt).toContain("Acme CRM");
  });

  it("keeps Cloud space information out of Desktop setup guidance", () => {
    const setupUrl = createSetupSkillUrl(
      "http://localhost:15419",
      "desktop",
      true,
      "must_not_leak",
    );
    const prompt = buildAgentInstallPrompt({
      source: catalogSource,
      packageName: "Kelly Email",
      setupUrl,
      template: coreMessagesEn.install.agentPromptBody,
      fmt,
    });

    expect(prompt).toContain("edition=desktop");
    expect(prompt).toContain("editionConfirmed=1");
    expect(prompt).not.toContain("space=");
    expect(prompt).not.toContain("must_not_leak");
  });

  it("resolves every connection placeholder in every supported locale", () => {
    const setupUrl = createSetupSkillUrl(
      "https://app.busabase.com",
      "cloud",
      true,
      "space_localized",
    );

    for (const messages of Object.values(coreMessagesByLocale)) {
      const prompt = buildAgentInstallPrompt({
        source: catalogSource,
        packageName: "Kelly Email",
        setupUrl,
        targetSpaceId: "space_localized",
        template: messages.install.agentPromptBody,
        fmt,
      });

      expect(prompt).toContain(setupUrl);
      expect(prompt).toContain("space_localized");
      expect(prompt).not.toMatch(/\{[a-zA-Z]+\}/);
      expect(prompt).not.toMatch(/api[_ -]?key|access[_ -]?token|secret/i);
    }
  });
});
