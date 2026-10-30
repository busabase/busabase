"use client";

/**
 * Copy a node's locator prompt (target line + connection check) and show the
 * one shared feedback toast every "copy locator" entry point uses: what was
 * copied, what to do next, and two example requests that copy "locator + this
 * sentence" in one click.
 *
 * Feedback goes through `sonner`'s package-root `toast`, the same instance the
 * rest of this package uses for copy feedback (`share.linkCopied` and friends)
 * and the one each host mounts a `<Toaster>` for. Never `kui/sonner`: that
 * wrapper pins its own copy, and a toast fired on a copy with no mounted
 * Toaster is silently dropped.
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { type CoreLocale, fmt, useCoreI18n, useCoreLocale } from "../../../i18n";
import type { CoreI18nMessages } from "../../../i18n/messages";
import { useAgentIntegrationTarget } from "../agent-integration-context";
import type { AgentIntegrationTarget } from "../components/agent-install-panel";
import { createSetupSkillUrl } from "../components/agent-skill-button";
import {
  buildLocatorPrompt,
  type LocatorExampleKind,
  locatorExampleKind,
  locatorExamples,
} from "../helpers/agent-locator";
import { copyAgentPromptSnapshot } from "../helpers/agent-prompt-clipboard";
import { isApplePlatform, locatorShortcutLabel } from "../helpers/locator-shortcut";
import {
  type NodePromptScope,
  renderCreateTargetLine,
  renderNodeLocatorTarget,
} from "../helpers/node-agent-prompts";

/** What a "copy locator" entry point needs to know about where it points. */
export interface AgentLocator {
  /** The target line — `renderNodeLocatorTarget` / `renderCreateTargetLine`. */
  target: string;
  exampleKind: LocatorExampleKind;
}

/**
 * Radix modal dialogs set `pointer-events: none` on <body>, which the toaster
 * (a body child) inherits — so a toast fired from inside a dialog could not be
 * clicked. The class puts pointer events back on the toast itself; the shared
 * `DialogContent` ignores outside-presses that land in the toaster, so clicking
 * a chip does not dismiss the dialog the copy came from.
 */
const TOAST_CLASS = "pointer-events-auto";
const LOCATOR_TOAST_ID = "busabase-agent-locator-copied";

export const useNodeLocator = ({
  nodeId,
  nodeName,
  nodeType,
  scope,
  spaceId,
  spaceName,
  agentIntegration,
}: {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  scope?: NodePromptScope;
  spaceId?: string;
  spaceName?: string;
  agentIntegration?: AgentIntegrationTarget;
}): AgentLocator => {
  const locale = useCoreLocale();
  const integrationFromContext = useAgentIntegrationTarget();
  // Same resolution `useNodeAgentPrompts` applies, so the locator and the
  // dialog's prompts name the space identically.
  const resolvedSpaceId = spaceId ?? (agentIntegration ?? integrationFromContext)?.targetSpaceId;
  return useMemo(
    () => ({
      target: renderNodeLocatorTarget(
        { nodeId, nodeName, nodeType, scope, spaceId: resolvedSpaceId, spaceName },
        locale,
      ),
      exampleKind: locatorExampleKind(nodeType, scope?.kind),
    }),
    [locale, nodeId, nodeName, nodeType, resolvedSpaceId, scope, spaceName],
  );
};

export const createLocator = (
  context: Parameters<typeof renderCreateTargetLine>[0],
  locale: Parameters<typeof renderCreateTargetLine>[1],
): AgentLocator => ({ target: renderCreateTargetLine(context, locale), exampleKind: "create" });

function LocatorToastBody({
  body,
  examples,
  onPick,
}: {
  body: string;
  examples: string[];
  onPick: (request: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <p>{body}</p>
      <div className="flex flex-wrap gap-1.5">
        {examples.map((example) => (
          <button
            className="rounded-full border border-border bg-background px-2 py-0.5 text-left text-foreground text-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="agent-locator-example"
            key={example}
            onClick={() => onPick(example)}
            type="button"
          >
            {example}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Everything a copy needs besides the locator — resolved by the caller. */
export interface CopyLocatorEnv {
  messages: CoreI18nMessages;
  locale: CoreLocale;
  integration?: AgentIntegrationTarget;
}

/**
 * The locator prompt for the live browser origin — never a host's SSR
 * placeholder, same rule `AgentPromptsView` follows. No edition → no
 * connection check, rather than a guessed setup URL.
 */
export const renderAgentLocator = (
  { messages, integration }: CopyLocatorEnv,
  locator: AgentLocator,
  request?: string,
): string => {
  const edition = integration?.edition;
  // A stray targetSpaceId must never leak into Desktop guidance.
  const targetSpaceId = edition === "cloud" ? integration?.targetSpaceId : undefined;
  const origin = typeof window === "undefined" ? undefined : window.location.origin;
  return buildLocatorPrompt({
    target: locator.target,
    request,
    setupUrl:
      edition && origin ? createSetupSkillUrl(origin, edition, true, targetSpaceId) : undefined,
    targetSpaceId,
    leadIn: messages.agentPrompts.connectionCheckLeadIn,
    connectionCheck: messages.agentPrompts.connectionCheck,
    fmt,
  });
};

/**
 * Copy, then show the shared feedback toast. Not a hook, so chrome that sits
 * outside the dashboard's i18n/integration providers (the sidebar shell) can
 * call it with what it already holds; components use `useCopyLocator`.
 */
export const copyAgentLocator = async (
  env: CopyLocatorEnv,
  locator: AgentLocator,
  request?: string,
): Promise<boolean> => {
  const { messages, locale } = env;
  try {
    await copyAgentPromptSnapshot({ text: renderAgentLocator(env, locator, request) });
  } catch {
    toast.error(messages.agentPrompts.locatorCopyFailed, {
      className: TOAST_CLASS,
      id: LOCATOR_TOAST_ID,
    });
    return false;
  }
  if (request) {
    toast.success(fmt(messages.agentPrompts.locatorExampleCopied, { request }), {
      className: TOAST_CLASS,
      id: LOCATOR_TOAST_ID,
    });
    return true;
  }
  toast.success(messages.agentPrompts.locatorCopiedTitle, {
    className: TOAST_CLASS,
    id: LOCATOR_TOAST_ID,
    duration: 10_000,
    description: (
      <LocatorToastBody
        body={messages.agentPrompts.locatorCopiedBody}
        examples={locatorExamples(locator.exampleKind, locale)}
        onPick={(example) => void copyAgentLocator(env, locator, example)}
      />
    ),
  });
  return true;
};

/** `copyLocator(locator, request?)` bound to this component's locale and target. */
export const useCopyLocator = (explicitIntegration?: AgentIntegrationTarget) => {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const integrationFromContext = useAgentIntegrationTarget();
  const integration = explicitIntegration ?? integrationFromContext;
  const env = useMemo<CopyLocatorEnv>(
    () => ({ messages, locale, integration }),
    [messages, locale, integration],
  );
  const copyLocator = useCallback(
    (locator: AgentLocator, request?: string) => copyAgentLocator(env, locator, request),
    [env],
  );
  return { copyLocator };
};

const subscribeNever = () => () => {};

/** "⌘⇧." on Apple platforms, "Ctrl+Shift+." elsewhere; the latter during SSR. */
export const useLocatorShortcutLabel = (): string =>
  useSyncExternalStore(
    subscribeNever,
    () =>
      locatorShortcutLabel(
        isApplePlatform(
          (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
            ?.platform ||
            navigator.platform ||
            navigator.userAgent,
        ),
      ),
    () => locatorShortcutLabel(false),
  );
