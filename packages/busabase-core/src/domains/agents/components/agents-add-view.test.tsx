import type { AgentCatalogEntryVO } from "busabase-contract/domains/agents/types";
import { describe, expect, it } from "vitest";
import { dashboardJa } from "../../../i18n/ja";
import { coreMessagesEn } from "../../../i18n/messages";
import { dashboardZhCN } from "../../../i18n/zh-CN";
import {
  catalogDescription,
  isExpectedLimitation,
  localizeUnavailableReason,
} from "./agents-add-view";

const entry = (slug: string, description: string) => ({ slug, description }) as AgentCatalogEntryVO;

describe("AgentsAddView catalog localization", () => {
  it("translates known bundled descriptions but preserves registry-authored metadata", () => {
    expect(
      catalogDescription(
        entry("claude-acp", coreMessagesEn.agents.catalogClaudeDescription),
        dashboardZhCN,
      ),
    ).toBe(dashboardZhCN.agents.catalogClaudeDescription);
    expect(catalogDescription(entry("claude-acp", "Registry description"), dashboardZhCN)).toBe(
      "Registry description",
    );
    expect(catalogDescription(entry("external", "External description"), dashboardJa)).toBe(
      "External description",
    );
  });

  it("keeps actionable recovery advice in a localized unavailable state", () => {
    expect(
      localizeUnavailableReason(coreMessagesEn.agents.unavailableOnCloud, dashboardZhCN, "zh-CN"),
    ).toBe(dashboardZhCN.agents.unavailableOnCloud);
    expect(
      localizeUnavailableReason(
        "`npx` was not found on this machine. Install Node.js to use Codex CLI.",
        dashboardJa,
        "ja",
      ),
    ).toContain("Node.js");
    expect(
      localizeUnavailableReason(coreMessagesEn.agents.budaEnvRequired, dashboardJa, "ja"),
    ).toContain("BUDA_AGENT_ID");
    expect(localizeUnavailableReason("Registry error", dashboardZhCN, "zh-CN")).toBe(
      "Registry error",
    );
  });

  it("classifies a Cloud host limitation and a coming-soon entry as expected, not a failure", () => {
    expect(isExpectedLimitation(coreMessagesEn.agents.unavailableOnCloud)).toBe(true);
    expect(isExpectedLimitation("Coming soon.")).toBe(true);
  });

  it("classifies a missing binary or a registry error as a genuine failure", () => {
    expect(
      isExpectedLimitation(
        "`npx` was not found on this machine. Install Node.js to use Codex CLI.",
      ),
    ).toBe(false);
    expect(isExpectedLimitation("Registry error")).toBe(false);
    expect(isExpectedLimitation(null)).toBe(false);
  });
});
