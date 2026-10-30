"use client";

import { AppWindow, BookOpen, Database, Plus, Shapes, Sparkles, X } from "lucide-react";
import { SPALink } from "openlib/ui/dashboard";
import { Fragment, useId, useState } from "react";
import { type CoreI18nMessages, useCoreI18n } from "../../../i18n";
import type { McpGuideEdition } from "./agent-mcp-guides";
import { AgentIntegrationDialog } from "./agent-skill-button";
import "./agent-connect-cue.css";

/**
 * Host-supplied "this user has not connected an agent yet" signal. Passing it
 * turns the card agent-first: connecting the agent becomes the primary, softly
 * pulsing action and the template drops to a secondary button. Omit it (Desktop,
 * an already-connected user, a dismissed cue) and the template-first layout below
 * is unchanged.
 */
export interface EmptyAgentGuideCue {
  /** Fired when the user opens the integration dialog from the cue. */
  onConnectClick?: () => void;
  /** "Not now" — the host persists this and stops passing `agentCue`. */
  onDismiss: () => void;
  /**
   * Whether to show the speech bubble above the button (default true). The
   * host persists the bubble's × the same way as "Not now" and passes false
   * from then on; the card also hides it locally right away.
   */
  showBubble?: boolean;
  /** The bubble's × was pressed, or the button was clicked (it has done its job). */
  onDismissBubble?: () => void;
}

interface EmptyAgentGuideProps {
  /** Selects Cloud OAuth guidance or Desktop's local no-auth guidance. */
  edition?: McpGuideEdition;
  /** Current UI language — localizes the pasted prompt in the Agent Integration dialog. */
  lang?: string;
  /**
   * Opens the host's "New item" modal. Optional: a host without one (or an
   * embed with no create surface) simply doesn't get the secondary action —
   * the template and agent paths still stand on their own.
   */
  onCreateNode?: () => void;
  /** See {@link EmptyAgentGuideCue}. */
  agentCue?: EmptyAgentGuideCue;
}

/**
 * The first screen of an empty workspace, ordered by "how soon does this user
 * see something happen".
 *
 * It used to offer exactly one action — connect an agent over MCP — which asks
 * a brand-new user to LEAVE Busabase (paste a prompt into Claude Code/Cursor,
 * walk an OAuth flow) before anything at all exists here, and to come back to
 * the same empty screen. That filtered the whole funnel down to people who had
 * already installed an agent, and the fallback ("or use the UI buttons") named
 * a button — the sidebar's lone "+" — that a first-time visitor cannot find.
 *
 * So the primary action is now a template: it is the fastest path from empty to
 * a workspace with Bases, sample rows and — crucially — the author's agent
 * manual, which is what makes the agent's FIRST conversation succeed instead of
 * having it guess at a schema that doesn't exist yet. Connecting an agent stays
 * on this screen, demoted to the text link it should always have been: it is
 * step two, and it reads as step two.
 *
 * Cloud flips that order back for users who have not connected an agent yet
 * (`agentCue`): its signup funnel showed nearly every new user creating content
 * by hand and almost none connecting the agent the product exists for, so there
 * the agent CTA leads, with a gentle ring, and the user can dismiss it.
 */
export function EmptyAgentGuide({
  edition = "desktop",
  lang,
  onCreateNode,
  agentCue,
}: EmptyAgentGuideProps = {}) {
  const messages = useCoreI18n();
  const [open, setOpen] = useState(false);
  // What an agent fills this workspace with: the four bases the homepage hero
  // rotates through and the onboarding wizard's last step shows, with the same
  // names and icons, so the product picks up where the site left off. Review is
  // not the pitch here (see busabase-cloud content/spec/category-definition.md).
  const { emptyGuide } = messages;
  const bases = [
    { icon: Database, name: emptyGuide.baseDataName, desc: emptyGuide.baseDataDesc },
    { icon: BookOpen, name: emptyGuide.baseKnowledgeName, desc: emptyGuide.baseKnowledgeDesc },
    { icon: AppWindow, name: emptyGuide.baseAppsName, desc: emptyGuide.baseAppsDesc },
    { icon: Sparkles, name: emptyGuide.baseSkillsName, desc: emptyGuide.baseSkillsDesc },
  ];
  // Icon · base name · what it holds. Names line up in their own column so the
  // four bases read at a glance.
  const basesList = (
    <div className="mt-3 grid grid-cols-[auto_auto_1fr] items-start gap-x-2 gap-y-2 text-sm">
      {bases.map(({ icon: Icon, name, desc }) => (
        <Fragment key={name}>
          <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="whitespace-nowrap font-medium text-foreground">{name}</span>
          <span className="text-muted-foreground">{desc}</span>
        </Fragment>
      ))}
    </div>
  );

  return (
    <>
      <div className="mx-auto max-w-xl rounded-lg border bg-card p-4 text-left">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
            <Sparkles size={18} />
          </div>
          <div className="min-w-0">
            <h3 className="font-medium text-sm">{messages.emptyGuide.title}</h3>
            <p className="mt-1 text-muted-foreground text-sm leading-6">
              {messages.emptyGuide.body}
            </p>
          </div>
        </div>
        {agentCue ? (
          <>
            <AgentFirstActions
              cue={agentCue}
              messages={messages}
              onConnect={() => {
                agentCue.onConnectClick?.();
                setOpen(true);
              }}
              onCreateNode={onCreateNode}
            />
            {/* Agent-first: the action sits right under the pitch, so it is
                above the fold at 390px; the bases explain what lands here. */}
            <div className="mt-4 border-t pt-3">{basesList}</div>
          </>
        ) : (
          <>
            {basesList}
            <div className="mt-4 flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {/* SPALink, not a raw href: this is inside the dashboard's wouter
                  tree, and it carries the current query string (cloud's
                  `?space=tnl_…`, desktop's `?demo=1`) that a bare anchor drops. */}
                <SPALink
                  className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 font-medium text-primary-foreground text-sm transition hover:bg-primary/90"
                  href="/templates"
                >
                  <Shapes size={15} />
                  {messages.emptyGuide.startFromTemplate}
                </SPALink>
                {onCreateNode ? (
                  <button
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 font-medium text-foreground text-sm transition hover:bg-muted"
                    onClick={onCreateNode}
                    type="button"
                  >
                    <Plus size={15} />
                    {messages.emptyGuide.createManually}
                  </button>
                ) : null}
              </div>
              <span className="text-muted-foreground text-xs">
                {messages.emptyGuide.startFromTemplateHint}
              </span>
              <button
                className="self-start text-muted-foreground text-xs underline underline-offset-4 transition hover:text-foreground"
                onClick={() => setOpen(true)}
                type="button"
              >
                {messages.emptyGuide.connectAgent}
              </button>
            </div>
          </>
        )}
      </div>

      <AgentIntegrationDialog
        open={open}
        onOpenChange={setOpen}
        defaultOrigin="https://busabase.com"
        edition={edition}
        editionConfirmed
        lang={lang}
        // Close this dialog first: the host's New item modal is a sibling, and
        // stacking it under an open Agent Integration dialog leaves the user
        // creating a Base through a scrim they cannot dismiss.
        onCreateNode={
          onCreateNode
            ? () => {
                setOpen(false);
                onCreateNode();
              }
            : undefined
        }
      />
    </>
  );
}

/**
 * The agent-first action block: a violet speech bubble pointing at one clear
 * primary ("Connect your agent", halo + shine), the template and manual paths
 * one tap away as secondary buttons, and a quiet "Not now".
 *
 * The bubble is in normal flow, not absolutely positioned, so it can never
 * cover the card text or the other buttons, and it wraps instead of
 * overflowing at 390px.
 */
function AgentFirstActions({
  cue,
  messages,
  onConnect,
  onCreateNode,
}: {
  cue: EmptyAgentGuideCue;
  messages: CoreI18nMessages;
  onConnect: () => void;
  onCreateNode?: () => void;
}) {
  const { emptyGuide } = messages;
  const bubbleId = useId();
  const [bubbleHidden, setBubbleHidden] = useState(false);
  const showBubble = (cue.showBubble ?? true) && !bubbleHidden;
  const dismissBubble = () => {
    setBubbleHidden(true);
    cue.onDismissBubble?.();
  };

  return (
    <div className="mt-4 flex flex-col gap-2">
      {showBubble ? (
        <div
          className="relative mb-1.5 flex max-w-full items-start gap-1.5 self-start rounded-lg bg-ai py-1.5 pr-1 pl-3 text-sm text-white shadow-md"
          data-agent-cue="bubble"
          id={bubbleId}
          role="note"
        >
          <span className="min-w-0 py-0.5 leading-5">{emptyGuide.connectAgentBubble}</span>
          <button
            aria-label={emptyGuide.dismissAgentBubble}
            className="grid size-6 shrink-0 place-items-center rounded text-white/85 transition hover:bg-white/15 hover:text-white focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-[-2px]"
            onClick={dismissBubble}
            type="button"
          >
            <X aria-hidden="true" size={14} />
          </button>
          {/* The tail, pointing down at the button. */}
          <span
            aria-hidden="true"
            className="-bottom-1.5 absolute left-5 size-3 rotate-45 rounded-[1px] bg-ai"
          />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <button
          aria-describedby={showBubble ? bubbleId : undefined}
          className="inline-flex h-9 items-center gap-2 rounded-md bg-ai px-3 font-medium text-sm text-white transition hover:bg-ai-strong focus-visible:outline-2 focus-visible:outline-ai focus-visible:outline-offset-2"
          data-agent-cue="ring"
          onClick={() => {
            if (showBubble) dismissBubble();
            onConnect();
          }}
          type="button"
        >
          <Sparkles aria-hidden="true" size={15} />
          {emptyGuide.connectAgentPrimary}
        </button>
        <SPALink
          className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 font-medium text-foreground text-sm transition hover:bg-muted"
          href="/templates"
        >
          <Shapes size={15} />
          {emptyGuide.startFromTemplate}
        </SPALink>
        {onCreateNode ? (
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md px-2 font-medium text-muted-foreground text-sm transition hover:bg-muted hover:text-foreground"
            onClick={onCreateNode}
            type="button"
          >
            <Plus size={15} />
            {emptyGuide.createManually}
          </button>
        ) : null}
      </div>
      <div className="flex items-start justify-between gap-3">
        <span className="text-muted-foreground text-xs leading-5">
          {emptyGuide.connectAgentHint}
        </span>
        <button
          className="inline-flex shrink-0 items-center gap-1 rounded text-muted-foreground text-xs leading-5 transition hover:text-foreground"
          onClick={cue.onDismiss}
          type="button"
        >
          <X aria-hidden="true" size={12} />
          {emptyGuide.dismissAgentCue}
        </button>
      </div>
    </div>
  );
}
