"use client";

import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import {
  InstallFailureVOSchema,
  type InstallPlanNodeVO,
  type InstallPlanVO,
  type InstallResultVO,
  installFailureTouchedWorkspace,
} from "busabase-contract/domains/install/types";
import { Alert, AlertDescription, AlertTitle } from "kui/alert";
import { Button } from "kui/button";
import { Checkbox } from "kui/checkbox";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "kui/dialog";
import { Input } from "kui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "kui/tabs";
import { CircleCheck, LoaderCircle, Sparkles, TriangleAlert } from "lucide-react";
import { iStringParse } from "openlib/i18n/i-string";
import { useEffect, useId, useRef, useState } from "react";
import { fmt, useCoreI18n, useCoreLocale } from "../../../i18n";
import { GithubIcon } from "../helpers/brand-icons";
import { nodeIconForType } from "../helpers/node-icons";
import { presentInstallError } from "../utils/install-error";
import { AgentInstallPanel, type AgentIntegrationTarget } from "./agent-install-panel";
import { DialogContent } from "./localized-dialog-content";

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

const errorDetailFor = (caught: unknown, primary: string): string | null =>
  caught instanceof Error && caught.message.trim() && caught.message !== primary
    ? caught.message
    : null;

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
          // A package's skill and app can share one path (both take the package
          // slug), so the path alone is not unique among siblings.
          <li key={`${entry.node.type}:${entry.node.path}`}>
            <div className="flex min-w-0 items-center gap-2 py-0.5 text-sm">
              <Icon className="size-4 shrink-0 text-muted-foreground" />
              <bdi className="truncate text-foreground" dir="auto">
                {entry.node.name}
              </bdi>
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
   *
   * `null` means the install FAILED after it had already created something. The
   * tree is just as stale in that case, and the host that skips the refresh is
   * the reason a half-installed folder appears out of nowhere on the next
   * navigation.
   */
  onInstalled: (result: InstallResultVO | null) => void;
  /**
   * Host navigation to the change-requests inbox, offered on the result step when
   * anything is pending. Omit to render the pending count without a link.
   */
  onReviewChangeRequests?: () => void;
  /**
   * Pre-fill the URL and go straight to the preview.
   *
   * Set by the Template Center: the user already chose a template from a card,
   * so making them look at an empty URL field — for a URL they never typed and
   * would have to be told — turns one decision into two.
   */
  initialRepoUrl?: string;
  /** @deprecated UI installs always create their own folder; kept for host compatibility. */
  initialIntoFolder?: string;
  /** Package name already known by catalog entry points, used in the title and to omit repeated details. */
  initialPackageName?: string;
  /**
   * Host configuration for the Agent install prompt — which edition's setup
   * guidance to include, and which space to pin it to. Omit and it falls back to
   * Desktop's local guidance.
   */
  agentIntegration?: AgentIntegrationTarget;
  /**
   * Opens the host's "New item" modal, offered as the way out of the Agent
   * install tab for a user who has no agent set up yet. Closes this modal first
   * — two stacked dialogs is not a place to leave anyone.
   */
  onCreateNode?: () => void;
}

export function InstallFromGithubModal({
  open,
  apiClient,
  onOpenChange,
  onInstalled,
  onReviewChangeRequests,
  initialRepoUrl,
  initialPackageName,
  agentIntegration,
  onCreateNode,
}: InstallFromGithubModalProps) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const [repoUrl, setRepoUrl] = useState(initialRepoUrl ?? "");
  const [plan, setPlan] = useState<InstallPlanVO | null>(null);
  const [planning, setPlanning] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [nameError, setNameError] = useState(false);
  const [failureState, setFailureState] = useState<"unchanged" | "changed" | "unknown" | null>(
    null,
  );
  const folderNameId = useId();
  const folderNameInput = useRef<HTMLInputElement>(null);
  const folderNameValue = useRef<string | null>(null);
  const newFolderSlug = useRef<string | undefined>(undefined);
  const planRequest = useRef(0);
  const intent = useRef(0);
  const installingNow = useRef(false);
  /**
   * Opt-in, not opt-out. Left alone, `autoMerge` is omitted and the server
   * decides by permission like every other write — and only a space manager can
   * install, so in practice the content goes live. Sending an explicit `false`
   * by default is what used to drop every UI install into Change Requests.
   */
  const [requireReview, setRequireReview] = useState(false);
  const [installing, setInstalling] = useState(false);
  /**
   * The latest line the server reported for the install in flight.
   *
   * Only the latest, not a log: the passes are sequential and the useful
   * question during a wait is "what is it doing NOW", not what it already did.
   */
  const [installProgress, setInstallProgress] = useState<string | null>(null);
  const [result, setResult] = useState<InstallResultVO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  /**
   * Set when an install failed AFTER creating something. Structure is created
   * immediately, so a failure partway through leaves a real folder and real
   * Bases behind — the tree on screen is stale in exactly the way a successful
   * install makes it stale, and treating the failure as "nothing happened" is
   * what makes the leftovers look like they appeared on their own.
   */
  const [workspaceTouchedByFailure, setWorkspaceTouchedByFailure] = useState(false);
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
  const binding = useRef({ apiClient, initialRepoUrl });

  const reset = () => {
    setRepoUrl(initialRepoUrl ?? "");
    setPlan(null);
    setPlanning(false);
    setFolderName("");
    setNameError(false);
    setFailureState(null);
    folderNameValue.current = null;
    newFolderSlug.current = undefined;
    planRequest.current += 1;
    intent.current += 1;
    installingNow.current = false;
    setRequireReview(false);
    setInstalling(false);
    setInstallProgress(null);
    setResult(null);
    setError(null);
    setErrorDetail(null);
    setWorkspaceTouchedByFailure(false);
    setTab("agent");
    setAgentAfterInstall(false);
    planSeen.current = false;
    autoPlanned.current = false;
  };

  /** A preview allocates the internal address once; the user only edits its display name. */
  const runPlan = async (urlOverride?: string) => {
    const trimmedUrl = (urlOverride ?? repoUrl).trim();
    if (!trimmedUrl) {
      setError(messages.install.repoUrlRequired);
      return;
    }
    const request = ++planRequest.current;
    setPlanning(true);
    setError(null);
    setErrorDetail(null);
    setFailureState(null);
    try {
      const next = await apiClient.planInstallFromGithub({
        repoUrl: trimmedUrl,
        newFolder: {
          ...(newFolderSlug.current ? { slug: newFolderSlug.current } : {}),
          ...(folderNameValue.current?.trim() ? { name: folderNameValue.current.trim() } : {}),
        },
      });
      if (request !== planRequest.current) return;
      if (!next.newFolder) {
        setPlan(null);
        setError(messages.install.installUnavailable);
        return;
      }
      newFolderSlug.current = next.newFolder.slug;
      setPlan(next);
      if (folderNameValue.current === null) {
        const defaultName = next.package.displayName
          ? iStringParse(next.package.displayName, locale) || next.package.name
          : next.package.name;
        folderNameValue.current = defaultName;
        setFolderName(defaultName);
      }
      if (!planSeen.current) {
        planSeen.current = true;
        if (next.counts.skills === 0) setTab("ui");
      }
    } catch (caught) {
      if (request !== planRequest.current) return;
      const visible = presentInstallError(
        messages,
        locale,
        caught,
        messages.install.previewFailed,
        {
          slug: newFolderSlug.current,
          name: folderNameValue.current ?? undefined,
        },
      );
      setError(visible);
      setErrorDetail(errorDetailFor(caught, visible));
      setPlan(null);
    } finally {
      if (request === planRequest.current) setPlanning(false);
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
    if (
      binding.current.apiClient !== apiClient ||
      binding.current.initialRepoUrl !== initialRepoUrl
    ) {
      binding.current = { apiClient, initialRepoUrl };
      reset();
    }
    if (!open) {
      reset();
      return;
    }
    if (!initialRepoUrl || autoPlanned.current) {
      return;
    }
    autoPlanned.current = true;
    void runPlan(initialRepoUrl);
  }, [open, initialRepoUrl, apiClient]);

  useEffect(() => {
    if (nameError && !installing) folderNameInput.current?.focus();
  }, [nameError, installing]);

  const submitInstall = async () => {
    if (!plan?.newFolder || planning || installingNow.current) return;
    const name = (folderNameValue.current ?? folderName).trim();
    if (!name) {
      setError(null);
      setErrorDetail(null);
      setFailureState(null);
      setNameError(true);
      return;
    }
    const currentIntent = intent.current;
    installingNow.current = true;
    setInstalling(true);
    setError(null);
    setErrorDetail(null);
    setFailureState(null);
    setWorkspaceTouchedByFailure(false);
    setInstallProgress(null);
    try {
      const events = await apiClient.installFromGithubStream({
        repoUrl: repoUrl.trim(),
        newFolder: { slug: plan.newFolder.slug, name },
        ...(requireReview ? { autoMerge: false } : {}),
      });
      let installed: InstallResultVO | null = null;
      for await (const event of events) {
        if (currentIntent !== intent.current) return;
        if (event.kind === "progress") {
          setInstallProgress(event.message);
        } else {
          installed = event.result;
          break;
        }
      }
      if (currentIntent !== intent.current) return;
      if (!installed) {
        setError(messages.install.installUnknown);
        setFailureState("unknown");
        setWorkspaceTouchedByFailure(true);
        return;
      }
      setResult(installed);
    } catch (caught) {
      if (currentIntent !== intent.current) return;
      const issues = (caught as { data?: { issues?: unknown } } | null)?.data?.issues;
      const nameRejected =
        Array.isArray(issues) &&
        issues.some(
          (issue) =>
            Array.isArray(issue?.path) &&
            issue.path.length === 2 &&
            issue.path[0] === "newFolder" &&
            issue.path[1] === "name",
        );
      if (nameRejected) {
        setNameError(true);
        return;
      }
      const failure = InstallFailureVOSchema.safeParse(
        (caught as { data?: unknown } | null)?.data ?? undefined,
      );
      const visible = presentInstallError(
        messages,
        locale,
        caught,
        failure.success ? messages.install.installFailed : messages.install.installUnknown,
        { slug: newFolderSlug.current, name: folderNameValue.current ?? undefined },
      );
      setError(visible);
      setErrorDetail(errorDetailFor(caught, visible));
      if (failure.success) {
        const touched = installFailureTouchedWorkspace(failure.data);
        setFailureState(touched ? "changed" : "unchanged");
        setWorkspaceTouchedByFailure(touched);
      } else {
        setFailureState("unknown");
        setWorkspaceTouchedByFailure(true);
      }
    } finally {
      if (currentIntent === intent.current) {
        installingNow.current = false;
        setInstalling(false);
      }
    }
  };

  const close = () => {
    const finished = result;
    const touched = workspaceTouchedByFailure || installingNow.current;
    reset();
    onOpenChange(false);
    if (finished) {
      onInstalled(finished);
    } else if (touched) {
      onInstalled(null);
    }
  };

  // Runs the full `close()` (not a bare `onOpenChange(false)`) so a refresh
  // still fires when the user reached the Agent tab AFTER installing — the
  // workspace changed, and bailing out to "New item" must not lose that.
  const createNodeFromHere = onCreateNode
    ? () => {
        close();
        onCreateNode();
      }
    : undefined;

  // A collision the server could not resolve — `renamedTo` is set only when
  // `rename` was on and produced a free slug.
  const unresolvedCollisions = plan?.collisions.filter((collision) => !collision.renamedTo) ?? [];
  // Derived from the plan's structured signals rather than its `applicable`
  // flag: `applicable` reflects the autoMerge the plan was FETCHED with, but the
  // checkbox below can change after that without a re-plan. Recomputing locally
  // keeps the button in sync with the box on the same tick.
  const autoMergeUnmet = Boolean(plan?.requiresAutoMerge) && requireReview;
  const canInstall =
    plan?.newFolder !== undefined &&
    !planning &&
    !installing &&
    unresolvedCollisions.length === 0 &&
    !autoMergeUnmet &&
    failureState !== "unknown";

  /**
   * A card-supplied URL is not editable: changing it here would silently turn
   * "install this template" into "install something else", with the card's name
   * still on the dialog.
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
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {initialPackageName ? (
              <Sparkles className="size-4" />
            ) : (
              <GithubIcon className="size-4" />
            )}
            {initialPackageName
              ? fmt(messages.install.packageTitle, { name: initialPackageName })
              : messages.install.title}
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

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
          {result && agentAfterInstall && plan ? (
            // Installed, and now asked for the manual as well. The two installs
            // are complementary rather than alternatives — the UI tab says so,
            // and this is where that sentence has to be actionable, because it
            // is the moment the user has just proved they want the app.
            <AgentInstallPanel
              agentIntegration={agentIntegration}
              onCreateNode={createNodeFromHere}
              plan={plan}
            />
          ) : result ? (
            <ResultStep
              messages={messages}
              onAgentInstall={
                plan && plan.counts.skills > 0 ? () => setAgentAfterInstall(true) : undefined
              }
              onReviewChangeRequests={onReviewChangeRequests}
              result={result}
              folderName={result.targetFolderName ?? folderName.trim()}
            />
          ) : (
            <>
              {urlLocked ? null : (
                <div className="flex flex-col gap-1.5 text-sm">
                  <label className="text-muted-foreground" htmlFor={`${folderNameId}-repo`}>
                    {messages.install.repoUrl}
                  </label>
                  <Input
                    autoFocus
                    id={`${folderNameId}-repo`}
                    disabled={planning || installing}
                    onChange={(event) => {
                      setRepoUrl(event.target.value);
                      planRequest.current += 1;
                      newFolderSlug.current = undefined;
                      folderNameValue.current = null;
                      setFolderName("");
                      setFailureState(null);
                      // The plan on screen describes the previous URL — drop it
                      // rather than let it look like an answer for this one.
                      setPlan(null);
                      setError(null);
                      setErrorDetail(null);
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
                  <PackageSummary
                    initialPackageName={initialPackageName}
                    messages={messages}
                    plan={plan}
                  />

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
                      <AgentInstallPanel
                        agentIntegration={agentIntegration}
                        onCreateNode={createNodeFromHere}
                        plan={plan}
                      />
                    </TabsContent>

                    <TabsContent className="mt-4 flex flex-col gap-4" value="ui">
                      <p className="text-muted-foreground text-sm">{messages.install.uiIntro}</p>

                      <div className="flex flex-col gap-1.5 text-sm">
                        <label className="text-muted-foreground" htmlFor={folderNameId}>
                          {messages.install.folderName}
                        </label>
                        <Input
                          aria-describedby={`${folderNameId}-hint${nameError ? ` ${folderNameId}-error` : ""}`}
                          aria-invalid={nameError}
                          dir="auto"
                          disabled={installing}
                          id={folderNameId}
                          onChange={(event) => {
                            folderNameValue.current = event.target.value;
                            setFolderName(event.target.value);
                            if (event.target.value.trim()) setNameError(false);
                          }}
                          ref={folderNameInput}
                          value={folderName}
                        />
                        <span className="text-muted-foreground text-xs" id={`${folderNameId}-hint`}>
                          {messages.install.folderNameHint}
                        </span>
                        {nameError ? (
                          <p
                            className="text-destructive text-xs"
                            id={`${folderNameId}-error`}
                            role="alert"
                          >
                            {messages.install.folderNameRequired}
                          </p>
                        ) : null}
                      </div>

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

                      {unresolvedCollisions.length > 0 ? (
                        <Alert variant="destructive">
                          <TriangleAlert className="size-4" />
                          <AlertTitle>{messages.install.installUnavailable}</AlertTitle>
                        </Alert>
                      ) : null}

                      {plan.warnings.length > 0 ? (
                        <details className="rounded-md border border-border p-3 text-sm">
                          <summary className="cursor-pointer">
                            {messages.install.warningsTitle}
                          </summary>
                          <ul className="mt-2 flex flex-col gap-1 text-muted-foreground text-xs">
                            {plan.warnings.map((warning) => (
                              <li key={warning}>{warning}</li>
                            ))}
                          </ul>
                        </details>
                      ) : null}

                      {/* A package whose records link to each other cannot be held for
                          review (a link needs a record that already exists), so the
                          option is replaced by the reason it is not offered. */}
                      {plan.requiresAutoMerge ? (
                        <Alert>
                          <TriangleAlert className="size-4" />
                          <AlertTitle>{messages.install.autoMergeRequiredTitle}</AlertTitle>
                          <AlertDescription>
                            {messages.install.autoMergeRequiredBody}
                          </AlertDescription>
                        </Alert>
                      ) : (
                        <label
                          className="flex items-start gap-2 rounded-md border border-border p-3 text-sm"
                          htmlFor="install-require-review"
                        >
                          <Checkbox
                            checked={requireReview}
                            disabled={installing}
                            id="install-require-review"
                            onCheckedChange={(checked) => setRequireReview(checked === true)}
                          />
                          <span className="flex flex-col gap-0.5">
                            <span className="text-foreground">
                              {messages.install.requireReview}
                            </span>
                            <span className="text-muted-foreground text-xs">
                              {messages.install.requireReviewBody}
                            </span>
                          </span>
                        </label>
                      )}
                    </TabsContent>
                  </Tabs>
                </>
              ) : null}
            </>
          )}
        </div>

        {error || (installing && tab === "ui") ? (
          <div className="flex max-h-[35dvh] shrink-0 flex-col gap-2 overflow-y-auto border-t border-border pt-3">
            {error ? (
              <div className="flex flex-col gap-1" role="alert">
                <p className="break-words text-destructive text-sm">{error}</p>
                {failureState && error !== messages.install.installUnknown ? (
                  <p className="text-muted-foreground text-sm">
                    {failureState === "unchanged"
                      ? messages.install.installNoChanges
                      : failureState === "changed"
                        ? messages.install.installPartial
                        : messages.install.installUnknown}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-muted-foreground text-sm" role="status">
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                {messages.install.installingHint}
              </div>
            )}
            {errorDetail || installProgress ? (
              <details className="max-h-28 overflow-y-auto text-muted-foreground text-xs">
                <summary className="cursor-pointer">{messages.install.technicalDetails}</summary>
                <p className="mt-1 whitespace-pre-wrap break-words">
                  {errorDetail ?? installProgress}
                </p>
              </details>
            ) : null}
          </div>
        ) : null}

        {result || !plan || tab === "ui" ? (
          <DialogFooter className="shrink-0 flex-col gap-2 sm:flex-row">
            {result ? (
              <Button onClick={close}>{messages.install.done}</Button>
            ) : (
              <>
                <Button
                  disabled={installing}
                  // `close`, not a bare `reset` + dismiss: after a failed install
                  // this is the button the user actually reaches for (there is no
                  // "Done" without a result), and it is the one that has to tell
                  // the host its tree is stale.
                  onClick={close}
                  variant="outline"
                >
                  {messages.common.cancel}
                </Button>
                {plan ? (
                  <Button
                    className="min-w-28"
                    disabled={!canInstall}
                    onClick={() => void submitInstall()}
                  >
                    {installing ? messages.install.installing : messages.install.install}
                  </Button>
                ) : (
                  <Button
                    className="min-w-28"
                    disabled={planning || repoUrl.trim().length === 0}
                    onClick={() => void runPlan()}
                  >
                    {planning ? messages.install.previewing : messages.install.preview}
                  </Button>
                )}
              </>
            )}
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Package identity for the manual URL flow, where no preceding detail page supplied it. */
export function PackageSummary({
  initialPackageName,
  messages,
  plan,
}: {
  initialPackageName?: string;
  messages: ReturnType<typeof useCoreI18n>;
  plan: InstallPlanVO;
}) {
  // Called before the early return below — Rules of Hooks, not style.
  const locale = useCoreLocale();
  // Template Center already showed this information on the detail page. The
  // manual GitHub flow still needs it because the URL is the user's only input.
  if (initialPackageName) {
    return null;
  }

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

  // Checked after flattening, not before: an empty-per-locale iString object
  // is still a truthy object, so the old `plan.package.description ? ...`
  // guard would have rendered an empty <span> instead of hiding it.
  const description = iStringParse(plan.package.description, locale);
  const title = plan.package.displayName
    ? iStringParse(plan.package.displayName, locale)
    : plan.package.name;

  return (
    <section className="flex flex-col gap-1 rounded-md border border-border bg-muted/40 p-3">
      <span className="font-medium text-foreground text-sm">{title}</span>
      {description ? <span className="text-muted-foreground text-sm">{description}</span> : null}
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
 * may still be waiting (`--require-review`, or a credential that cannot write),
 * and saying so plainly is what keeps the result honest — hence the branch on
 * `pendingChangeRequests > 0`.
 */
function ResultStep({
  messages,
  onAgentInstall,
  onReviewChangeRequests,
  result,
  folderName,
}: {
  messages: ReturnType<typeof useCoreI18n>;
  /** Offered only when the package actually carries a manual to hand over. */
  onAgentInstall?: () => void;
  onReviewChangeRequests?: () => void;
  result: InstallResultVO;
  folderName: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <CircleCheck className="size-4 text-primary" />
        <span className="font-medium text-foreground text-sm">
          {fmt(messages.install.resultTitle, { folder: folderName })}
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
        <details className="rounded-md border border-border p-3 text-sm">
          <summary className="cursor-pointer">{messages.install.warningsTitle}</summary>
          <ul className="mt-2 flex flex-col gap-1 text-muted-foreground text-xs">
            {result.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {onAgentInstall ? (
        <Button className="w-fit px-0" onClick={onAgentInstall} variant="link">
          {messages.install.alsoInstallToAgent}
        </Button>
      ) : null}
    </div>
  );
}
