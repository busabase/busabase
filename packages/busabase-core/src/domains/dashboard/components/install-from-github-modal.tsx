"use client";

import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type {
  InstallCollisionVO,
  InstallPlanNodeVO,
  InstallPlanVO,
  InstallResultVO,
} from "busabase-contract/domains/install/types";
import { Alert, AlertDescription, AlertTitle } from "kui/alert";
import { Button } from "kui/button";
import { Checkbox } from "kui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "kui/dialog";
import { Input } from "kui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "kui/tabs";
import { CircleCheck, Github, LoaderCircle, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fmt, useCoreI18n } from "../../../i18n";
import { nodeIconForType } from "../helpers/node-icons";
import { AgentInstallPanel, type AgentIntegrationTarget } from "./agent-install-panel";

/**
 * "Install from GitHub" — the web face of spec §15.6.
 *
 * Three steps, because the middle one is the whole point of the feature: paste a
 * URL → **see exactly what would be created** → confirm. The preview is not a
 * courtesy; a package can carry skills and AirApps, i.e. code this space's agents
 * will execute, so the user has to be able to read what they are about to trust
 * before they commit to it.
 *
 * Past the preview the dialog forks, because "install" means two different things
 * to the same person on the same package:
 *   **UI install**    — create the folder, tables and app in THIS space. The
 *                       user's own agent learns nothing.
 *   **Agent install** — hand the package's `SKILL.md` to an agent they already
 *                       use (`npx skills add`). Nothing here is created.
 * They are not steps of one flow and neither implies the other, so they are tabs
 * rather than an order — and each tab says what the other one does not do.
 *
 * The two entry points differ only in where they join: the menu item starts at
 * the URL field, while a Template Center card arrives with the URL already chosen
 * and is planned on open, landing straight on the tabs.
 *
 * The browser never fetches the repo itself (CORS, and handing a client's fetch
 * target to the server is the SSRF hole) — it only sends a URL and renders the
 * plan the server hands back.
 */

/** The flat, depth-tagged plan outline rebuilt into a real tree for rendering. */
interface PlanTreeNode {
  node: InstallPlanNodeVO;
  children: PlanTreeNode[];
}

/**
 * The plan VO is deliberately flat (`depth` instead of nesting, so the contract
 * needs no `z.lazy`), but a reviewer reads a package as a tree. Rebuild it with a
 * depth stack — the list is already in pre-order, so one pass is enough.
 */
const buildPlanTree = (nodes: readonly InstallPlanNodeVO[]): PlanTreeNode[] => {
  const roots: PlanTreeNode[] = [];
  const stack: PlanTreeNode[] = [];
  for (const node of nodes) {
    const entry: PlanTreeNode = { node, children: [] };
    stack.length = Math.min(stack.length, node.depth);
    const parent = stack[node.depth - 1];
    if (parent) {
      parent.children.push(entry);
    } else {
      roots.push(entry);
    }
    stack[node.depth] = entry;
  }
  return roots;
};

function PlanTree({
  nodes,
  summaryFor,
}: {
  nodes: PlanTreeNode[];
  summaryFor: (node: InstallPlanNodeVO) => string | null;
}) {
  return (
    <ul className="flex flex-col gap-0.5">
      {nodes.map((entry) => {
        const Icon = nodeIconForType(entry.node.type);
        const summary = summaryFor(entry.node);
        return (
          <li key={entry.node.path}>
            <div className="flex min-w-0 items-center gap-2 py-0.5 text-sm">
              <Icon className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate text-foreground">{entry.node.name}</span>
              <span className="shrink-0 text-muted-foreground text-xs">{entry.node.slug}</span>
              {summary ? (
                <span className="shrink-0 text-muted-foreground text-xs">· {summary}</span>
              ) : null}
            </div>
            {entry.children.length > 0 ? (
              <div className="ml-2 border-border border-l pl-3">
                <PlanTree nodes={entry.children} summaryFor={summaryFor} />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

interface InstallFromGithubModalProps {
  open: boolean;
  apiClient: BusabaseDashboardApiClient;
  onOpenChange: (open: boolean) => void;
  /**
   * Fired once the user dismisses the result step — the host refreshes its data
   * (structure is created immediately, so the tree changed even when every
   * record is still pending review).
   */
  onInstalled: (result: InstallResultVO) => void;
  /**
   * Host navigation to the change-requests inbox, offered on the result step when
   * anything is pending. Omit to render the pending count without a link.
   */
  onReviewChangeRequests?: () => void;
  /**
   * Pre-fill the URL and target folder, and go straight to the preview.
   *
   * Set by the Template Center: the user already chose a template from a card,
   * so making them look at an empty URL field — for a URL they never typed and
   * would have to be told — turns one decision into two.
   */
  initialRepoUrl?: string;
  initialIntoFolder?: string;
  /**
   * Host configuration for the "Connect your agent" dialog offered on the Agent
   * install tab — which edition's guidance to show, and which space to pin the
   * copied setup prompt to. Omit and it falls back to Desktop's local guidance.
   */
  agentIntegration?: AgentIntegrationTarget;
}

export function InstallFromGithubModal({
  open,
  apiClient,
  onOpenChange,
  onInstalled,
  onReviewChangeRequests,
  initialRepoUrl,
  initialIntoFolder,
  agentIntegration,
}: InstallFromGithubModalProps) {
  const messages = useCoreI18n();
  const [repoUrl, setRepoUrl] = useState(initialRepoUrl ?? "");
  const [plan, setPlan] = useState<InstallPlanVO | null>(null);
  const [planning, setPlanning] = useState(false);
  const [intoFolder, setIntoFolder] = useState(initialIntoFolder ?? "");
  const [rename, setRename] = useState(false);
  const [autoMerge, setAutoMerge] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [result, setResult] = useState<InstallResultVO | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * Which install the user is choosing. Agent-first on purpose: handing an agent
   * the manual is the cheaper, reversible half — it writes nothing to the space —
   * and it is the one a user would not think to ask for.
   */
  const [tab, setTab] = useState<"agent" | "ui">("agent");
  /**
   * Set from the result step: the resources are in the space, and the user asked
   * for the manual too. Kept separate from `tab` so the install result is not
   * thrown away — closing still reports it to the host.
   */
  const [agentAfterInstall, setAgentAfterInstall] = useState(false);
  /** So the tab is only auto-corrected on the FIRST plan, never under the user. */
  const planSeen = useRef(false);
  const autoPlanned = useRef(false);

  const reset = () => {
    setRepoUrl(initialRepoUrl ?? "");
    setPlan(null);
    setPlanning(false);
    setIntoFolder(initialIntoFolder ?? "");
    setRename(false);
    setAutoMerge(false);
    setInstalling(false);
    setResult(null);
    setError(null);
    setTab("agent");
    setAgentAfterInstall(false);
    planSeen.current = false;
  };

  /**
   * Ask the server what this URL would create. Re-run whenever an input that
   * changes the answer changes (the target folder decides which node slugs
   * collide; `rename` decides whether a collision is resolved and under what
   * slug), so the preview on screen is never a stale answer to a different
   * question.
   */
  const runPlan = async (overrides?: { intoFolder?: string; rename?: boolean }) => {
    const trimmedUrl = repoUrl.trim();
    if (!trimmedUrl) {
      setError(messages.install.repoUrlRequired);
      return;
    }
    const nextFolder = (overrides?.intoFolder ?? intoFolder).trim();
    const nextRename = overrides?.rename ?? rename;
    setPlanning(true);
    setError(null);
    try {
      const next = await apiClient.planInstallFromGithub({
        repoUrl: trimmedUrl,
        ...(nextFolder ? { intoFolder: nextFolder } : {}),
        rename: nextRename,
      });
      setPlan(next);
      if (!planSeen.current) {
        planSeen.current = true;
        // A package with no skill node carries no manual, so "Agent install"
        // would open on an apology. Land on the tab that can do something —
        // once, and never again afterwards: re-planning happens when the target
        // folder or `rename` changes, and yanking the user back to another tab
        // then would be the dialog arguing with them.
        if (next.counts.skills === 0) {
          setTab("ui");
        }
      }
      // Seed the target-folder field from the plan's own suggestion (the
      // manifest name) the first time; afterwards the user's value wins.
      setIntoFolder(nextFolder || next.targetFolderSlug);
    } catch (caught) {
      // The server's messages are written to be read by a person — "Not a
      // Busabase package — expected busabase.json at …", "Your role does not
      // have access", the SSRF/allowlist refusal. Show them as-is; a generic
      // "something went wrong" would throw away the only useful part.
      setError(caught instanceof Error ? caught.message : messages.install.previewFailed);
      setPlan(null);
    } finally {
      setPlanning(false);
    }
  };

  /**
   * Plan on open when the URL was chosen for the user.
   *
   * A Template Center card has already answered "which package"; opening on a
   * filled field and an un-pressed Preview button makes them answer it twice,
   * and the second answer is one they cannot check — they never typed the URL.
   * The menu entry point, where the user IS the one supplying the URL, still
   * waits for them to press Preview.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per opened dialog; runPlan is re-created every render and is not a trigger
  useEffect(() => {
    if (!open || !initialRepoUrl || autoPlanned.current) {
      return;
    }
    autoPlanned.current = true;
    void runPlan();
  }, [open, initialRepoUrl]);

  const submitInstall = async () => {
    if (!plan) {
      return;
    }
    const trimmedFolder = intoFolder.trim();
    setInstalling(true);
    setError(null);
    try {
      const installed = await apiClient.installFromGithub({
        repoUrl: repoUrl.trim(),
        ...(trimmedFolder ? { intoFolder: trimmedFolder } : {}),
        rename,
        autoMerge,
      });
      setResult(installed);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : messages.install.installFailed);
    } finally {
      setInstalling(false);
    }
  };

  const close = () => {
    const finished = result;
    reset();
    onOpenChange(false);
    if (finished) {
      onInstalled(finished);
    }
  };

  // A collision the server could not resolve — `renamedTo` is set only when
  // `rename` was on and produced a free slug.
  const unresolvedCollisions = plan?.collisions.filter((collision) => !collision.renamedTo) ?? [];
  // Derived from the plan's structured signals rather than its `applicable`
  // flag: `applicable` reflects the autoMerge the plan was FETCHED with, but the
  // checkbox below can change after that without a re-plan. Recomputing locally
  // keeps the button in sync with the box on the same tick — and a package that
  // requires auto-merge is a prompt here, not a dead end.
  const autoMergeUnmet = Boolean(plan?.requiresAutoMerge) && !autoMerge;
  const canInstall =
    plan !== null &&
    !planning &&
    !installing &&
    unresolvedCollisions.length === 0 &&
    !autoMergeUnmet;

  /**
   * A card-supplied URL is shown as provenance in the package summary, not as an
   * editable field: editing it here would silently turn "install this template"
   * into "install something else", with the card's name still on the dialog.
   */
  const urlLocked = Boolean(initialRepoUrl);

  const summaryFor = (node: InstallPlanNodeVO): string | null => {
    if (node.type === "base") {
      return fmt(messages.install.baseSummary, {
        fields: node.fieldCount ?? 0,
        records: node.recordCount ?? 0,
      });
    }
    if (node.fileCount !== undefined) {
      return fmt(messages.install.fileTreeSummary, { files: node.fileCount });
    }
    return null;
  };

  const collisionLine = (collision: InstallCollisionVO): string =>
    collision.kind === "base"
      ? fmt(messages.install.collisionBase, { slug: collision.slug })
      : fmt(messages.install.collisionNode, { slug: collision.slug, path: collision.path });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          close();
          return;
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Github className="size-4" />
            {messages.install.title}
          </DialogTitle>
          {/* The framing has to follow the step: "paste a link" is wrong copy to
              be reading once the package is already fetched and the question on
              screen has become which KIND of install you want. */}
          <DialogDescription>
            {result
              ? messages.install.resultDescription
              : plan
                ? messages.install.chooseHow
                : messages.install.description}
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
          {result && agentAfterInstall && plan ? (
            // Installed, and now asked for the manual as well. The two installs
            // are complementary rather than alternatives — the UI tab says so,
            // and this is where that sentence has to be actionable, because it
            // is the moment the user has just proved they want the app.
            <AgentInstallPanel agentIntegration={agentIntegration} plan={plan} />
          ) : result ? (
            <ResultStep
              messages={messages}
              onAgentInstall={
                plan && plan.counts.skills > 0 ? () => setAgentAfterInstall(true) : undefined
              }
              onReviewChangeRequests={onReviewChangeRequests}
              result={result}
            />
          ) : (
            <>
              {urlLocked ? null : (
                <div className="flex flex-col gap-1.5 text-sm">
                  <span className="text-muted-foreground">{messages.install.repoUrl}</span>
                  <Input
                    autoFocus
                    disabled={planning || installing}
                    onChange={(event) => {
                      setRepoUrl(event.target.value);
                      // The plan on screen describes the previous URL — drop it
                      // rather than let it look like an answer for this one.
                      setPlan(null);
                      setError(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !plan) {
                        event.preventDefault();
                        void runPlan();
                      }
                    }}
                    placeholder={messages.install.repoUrlPlaceholder}
                    value={repoUrl}
                  />
                  <span className="text-muted-foreground text-xs">
                    {messages.install.repoUrlHint}
                  </span>
                </div>
              )}

              {plan ? (
                <>
                  <PackageSummary messages={messages} plan={plan} />

                  <Tabs onValueChange={(next) => setTab(next as "agent" | "ui")} value={tab}>
                    <TabsList className="w-full">
                      <TabsTrigger className="flex-1" value="agent">
                        {messages.install.tabAgent}
                      </TabsTrigger>
                      <TabsTrigger className="flex-1" value="ui">
                        {messages.install.tabUi}
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent className="mt-4" value="agent">
                      <AgentInstallPanel agentIntegration={agentIntegration} plan={plan} />
                    </TabsContent>

                    <TabsContent className="mt-4 flex flex-col gap-4" value="ui">
                      <p className="text-muted-foreground text-sm">{messages.install.uiIntro}</p>

                      <section className="flex flex-col gap-2">
                        <span className="font-medium text-foreground text-sm">
                          {messages.install.contents}
                        </span>
                        {plan.nodes.length === 0 ? (
                          <p className="text-muted-foreground text-sm">
                            {messages.install.emptyPackage}
                          </p>
                        ) : (
                          <>
                            <div className="rounded-md border border-border p-3">
                              <PlanTree nodes={buildPlanTree(plan.nodes)} summaryFor={summaryFor} />
                            </div>
                            <span className="text-muted-foreground text-xs">
                              {fmt(messages.install.countsSummary, {
                                folders: plan.counts.folders,
                                docs: plan.counts.docs,
                                bases: plan.counts.bases,
                                records: plan.counts.records,
                                files: plan.counts.files,
                              })}
                            </span>
                          </>
                        )}
                      </section>

                      {plan.collisions.length > 0 ? (
                        <Alert
                          variant={unresolvedCollisions.length > 0 ? "destructive" : "default"}
                        >
                          <TriangleAlert className="size-4" />
                          <AlertTitle>{messages.install.collisionsTitle}</AlertTitle>
                          <AlertDescription>
                            <p>{messages.install.collisionsBody}</p>
                            <ul className="mt-2 flex flex-col gap-1">
                              {plan.collisions.map((collision) => (
                                <li key={`${collision.kind}:${collision.path}:${collision.slug}`}>
                                  <span>{collisionLine(collision)}</span>
                                  {collision.renamedTo ? (
                                    <span className="text-muted-foreground">
                                      {" "}
                                      {fmt(messages.install.collisionRenamedTo, {
                                        renamedTo: collision.renamedTo,
                                      })}
                                    </span>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          </AlertDescription>
                        </Alert>
                      ) : null}

                      {plan.warnings.length > 0 ? (
                        <Alert>
                          <TriangleAlert className="size-4" />
                          <AlertTitle>{messages.install.warningsTitle}</AlertTitle>
                          <AlertDescription>
                            <ul className="flex flex-col gap-1">
                              {plan.warnings.map((warning) => (
                                <li key={warning}>{warning}</li>
                              ))}
                            </ul>
                          </AlertDescription>
                        </Alert>
                      ) : null}

                      <div className="flex flex-col gap-1.5 text-sm">
                        <span className="text-muted-foreground">
                          {messages.install.targetFolder}
                        </span>
                        <Input
                          disabled={planning || installing}
                          onBlur={() => {
                            // The target folder decides which node slugs collide, so
                            // a changed value makes the preview stale — re-ask.
                            if (intoFolder.trim() && intoFolder.trim() !== plan.targetFolderSlug) {
                              void runPlan();
                            }
                          }}
                          onChange={(event) => setIntoFolder(event.target.value)}
                          value={intoFolder}
                        />
                        <span className="text-muted-foreground text-xs">
                          {messages.install.targetFolderHint}
                        </span>
                      </div>

                      {plan.collisions.length > 0 ? (
                        <label className="flex items-start gap-2 text-sm" htmlFor="install-rename">
                          <Checkbox
                            checked={rename}
                            disabled={planning || installing}
                            id="install-rename"
                            onCheckedChange={(checked) => {
                              const next = checked === true;
                              setRename(next);
                              void runPlan({ rename: next });
                            }}
                          />
                          <span className="flex flex-col gap-0.5">
                            <span className="text-foreground">{messages.install.rename}</span>
                            <span className="text-muted-foreground text-xs">
                              {messages.install.renameHint}
                            </span>
                          </span>
                        </label>
                      ) : null}

                      {plan.requiresAutoMerge ? (
                        <Alert variant="destructive">
                          <TriangleAlert className="size-4" />
                          <AlertTitle>{messages.install.autoMergeRequiredTitle}</AlertTitle>
                          <AlertDescription>
                            {messages.install.autoMergeRequiredBody}
                          </AlertDescription>
                        </Alert>
                      ) : null}

                      <label
                        className="flex items-start gap-2 rounded-md border border-border p-3 text-sm"
                        htmlFor="install-auto-merge"
                      >
                        <Checkbox
                          checked={autoMerge}
                          disabled={installing}
                          id="install-auto-merge"
                          onCheckedChange={(checked) => setAutoMerge(checked === true)}
                        />
                        <span className="flex flex-col gap-0.5">
                          <span className="text-foreground">{messages.install.autoMerge}</span>
                          <span className="text-muted-foreground text-xs">
                            {messages.install.autoMergeBody}
                          </span>
                        </span>
                      </label>
                    </TabsContent>
                  </Tabs>
                </>
              ) : null}

              {error ? <p className="text-destructive text-sm">{error}</p> : null}
              {installing ? (
                <p className="flex items-center gap-2 text-muted-foreground text-sm">
                  <LoaderCircle className="size-4 animate-spin" />
                  {messages.install.installingHint}
                </p>
              ) : null}
            </>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          {result ? (
            <Button onClick={close}>{messages.install.done}</Button>
          ) : (
            <>
              <Button
                disabled={installing}
                onClick={() => {
                  reset();
                  onOpenChange(false);
                }}
                variant="outline"
              >
                {plan && tab === "agent" ? messages.common.close : messages.common.cancel}
              </Button>
              {plan && tab === "ui" ? (
                <Button disabled={!canInstall} onClick={() => void submitInstall()}>
                  {installing ? messages.install.installing : messages.install.install}
                </Button>
              ) : plan ? null : (
                <Button
                  disabled={planning || repoUrl.trim().length === 0}
                  onClick={() => void runPlan()}
                >
                  {planning ? messages.install.previewing : messages.install.preview}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The package's own identity, so the user can tell what they actually fetched. */
function PackageSummary({
  messages,
  plan,
}: {
  messages: ReturnType<typeof useCoreI18n>;
  plan: InstallPlanVO;
}) {
  const meta = [
    plan.package.version
      ? fmt(messages.install.packageVersion, { version: plan.package.version })
      : null,
    plan.package.author
      ? fmt(messages.install.packageAuthor, { author: plan.package.author })
      : null,
    plan.package.license
      ? fmt(messages.install.packageLicense, { license: plan.package.license })
      : null,
  ].filter((entry): entry is string => entry !== null);

  const source = [
    `${plan.source.owner}/${plan.source.repo}`,
    plan.source.ref ? fmt(messages.install.sourceRef, { ref: plan.source.ref }) : null,
    plan.source.subdir ? fmt(messages.install.sourceSubdir, { subdir: plan.source.subdir }) : null,
  ].filter((entry): entry is string => entry !== null);

  return (
    <section className="flex flex-col gap-1 rounded-md border border-border bg-muted/40 p-3">
      <span className="font-medium text-foreground text-sm">{plan.package.name}</span>
      {plan.package.description ? (
        <span className="text-muted-foreground text-sm">{plan.package.description}</span>
      ) : null}
      {meta.length > 0 ? (
        <span className="text-muted-foreground text-xs">{meta.join(" · ")}</span>
      ) : null}
      <span className="text-muted-foreground text-xs">
        {messages.install.source}: {source.join(" ")}
      </span>
    </section>
  );
}

/**
 * What actually happened. The pending-change-request pointer is the important
 * half: structure is materialized immediately (a pending Base has no id to hang a
 * view or a record on), so the tree already changed — but the package's *content*
 * is only proposed, and saying so plainly is what keeps the approval-first
 * promise legible.
 */
function ResultStep({
  messages,
  onAgentInstall,
  onReviewChangeRequests,
  result,
}: {
  messages: ReturnType<typeof useCoreI18n>;
  /** Offered only when the package actually carries a manual to hand over. */
  onAgentInstall?: () => void;
  onReviewChangeRequests?: () => void;
  result: InstallResultVO;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <CircleCheck className="size-4 text-primary" />
        <span className="font-medium text-foreground text-sm">
          {fmt(messages.install.resultTitle, { folder: result.targetFolderSlug })}
        </span>
      </div>
      <span className="text-muted-foreground text-sm">
        {fmt(messages.install.resultCounts, {
          folders: result.created.folders,
          bases: result.created.bases,
          views: result.created.views,
          docs: result.created.docs,
          records: result.created.records,
          files: result.created.files,
        })}
      </span>

      {result.pendingChangeRequests > 0 ? (
        <Alert>
          <TriangleAlert className="size-4" />
          <AlertTitle>
            {fmt(messages.install.pendingTitle, { count: result.pendingChangeRequests })}
          </AlertTitle>
          <AlertDescription>
            <p>{messages.install.pendingBody}</p>
            {onReviewChangeRequests ? (
              <Button className="mt-2 px-0" onClick={onReviewChangeRequests} variant="link">
                {messages.install.reviewNow}
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : (
        <p className="text-muted-foreground text-sm">{messages.install.noPending}</p>
      )}

      {result.warnings.length > 0 ? (
        <Alert>
          <TriangleAlert className="size-4" />
          <AlertTitle>{messages.install.warningsTitle}</AlertTitle>
          <AlertDescription>
            <ul className="flex flex-col gap-1">
              {result.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {onAgentInstall ? (
        <Button className="w-fit px-0" onClick={onAgentInstall} variant="link">
          {messages.install.alsoInstallToAgent}
        </Button>
      ) : null}
    </div>
  );
}
