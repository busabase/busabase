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
import { CircleCheck, Github, LoaderCircle, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { fmt, useCoreI18n } from "../../../i18n";
import { nodeIconForType } from "../helpers/node-icons";

/**
 * "Install from GitHub" — the web face of spec §15.6.
 *
 * Three steps, because the middle one is the whole point of the feature: paste a
 * URL → **see exactly what would be created** → confirm. The preview is not a
 * courtesy; a package can carry skills and AirApps, i.e. code this space's agents
 * will execute, so the user has to be able to read what they are about to trust
 * before they commit to it.
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
}

export function InstallFromGithubModal({
  open,
  apiClient,
  onOpenChange,
  onInstalled,
  onReviewChangeRequests,
}: InstallFromGithubModalProps) {
  const messages = useCoreI18n();
  const [repoUrl, setRepoUrl] = useState("");
  const [plan, setPlan] = useState<InstallPlanVO | null>(null);
  const [planning, setPlanning] = useState(false);
  const [intoFolder, setIntoFolder] = useState("");
  const [rename, setRename] = useState(false);
  const [autoMerge, setAutoMerge] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [result, setResult] = useState<InstallResultVO | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setRepoUrl("");
    setPlan(null);
    setPlanning(false);
    setIntoFolder("");
    setRename(false);
    setAutoMerge(false);
    setInstalling(false);
    setResult(null);
    setError(null);
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
          <DialogDescription>{messages.install.description}</DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
          {result ? (
            <ResultStep
              messages={messages}
              onReviewChangeRequests={onReviewChangeRequests}
              result={result}
            />
          ) : (
            <>
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

              {plan ? (
                <>
                  <PackageSummary messages={messages} plan={plan} />

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
                    <Alert variant={unresolvedCollisions.length > 0 ? "destructive" : "default"}>
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
                    <span className="text-muted-foreground">{messages.install.targetFolder}</span>
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
                      <AlertDescription>{messages.install.autoMergeRequiredBody}</AlertDescription>
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
                {messages.common.cancel}
              </Button>
              {plan ? (
                <Button disabled={!canInstall} onClick={() => void submitInstall()}>
                  {installing ? messages.install.installing : messages.install.install}
                </Button>
              ) : (
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
  onReviewChangeRequests,
  result,
}: {
  messages: ReturnType<typeof useCoreI18n>;
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
    </div>
  );
}
