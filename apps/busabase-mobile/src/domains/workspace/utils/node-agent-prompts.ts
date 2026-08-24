import {
  buildNodeAgentPrompts as buildSharedNodeAgentPrompts,
  type NodePrompt,
  type NodePromptContext,
} from "busabase-core/dashboard/node-agent-prompts";
import { coreMessagesEn } from "busabase-core/i18n/messages";
import { dashboardZhCN } from "busabase-core/i18n/zh-cn";
import type { Locale } from "~/i18n/messages";

export type { NodePrompt, NodePromptContext };

/** Bind the shared prompt rules to the mobile app's supported locale set. */
export function buildNodeAgentPrompts(context: NodePromptContext, locale: Locale) {
  const messages = locale === "zh-CN" ? dashboardZhCN : coreMessagesEn;
  return buildSharedNodeAgentPrompts(context, locale, messages);
}
