import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  InstallCollisionVO,
  InstallPlanNodeVO,
  InstallPlanVO,
  InstallResultVO,
} from "busabase-contract/domains/install/types";
import { CircleCheck, Square, SquareCheck, TriangleAlert } from "lucide-react-native";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { fmt, useI18n } from "~/i18n";
import { nodeIconForType } from "~/search/node-icons";
import { radius, spacing, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import {
  NativeActionBar,
  NativeBottomSheet,
  NativeInlineError,
  NativeLoadingState,
  NativeRow,
} from "../native-screen";
import { Button } from "../ui/Button";
import { TextInput } from "../ui/TextInput";

/**
 * "Install from GitHub" on mobile — the native face of spec §15.6, ported from
 * the web dialog (busabase-core `install-from-github-modal.tsx`).
 *
 * Same three steps, because the middle one IS the feature: paste a URL → see
 * exactly what would be created → confirm. A package can carry skills and
 * AirApps, i.e. code this space's agents will execute, so the preview is what
 * makes "do you trust this author" an answerable question rather than a leap.
 *
 * A bottom sheet rather than a screen: it is reached from the Space Selector
 * sheet, it is a task you finish and dismiss (not a place you navigate to and
 * can back out of halfway), and the result step has to hand you straight back
 * to wherever you were. A route would put a back-stack entry on a finished,
 * unrepeatable action. The body scrolls, so the plan outline is not constrained
 * by the sheet's height.
 *
 * The device never fetches the repo itself — it sends a URL and renders the
 * plan the server hands back (handing a client's fetch target to the server is
 * the SSRF hole the contract is written to avoid).
 */

interface InstallFromGithubSheetProps {
  visible: boolean;
  onClose: () => void;
  /**
   * Host navigation to the change-requests inbox, offered on the result step
   * when anything is pending. The sheet has already refreshed the workspace
   * queries by then; the host only has to move.
   */
  onReviewChangeRequests: () => void;
}

export function InstallFromGithubSheet({
  visible,
  onClose,
  onReviewChangeRequests,
}: InstallFromGithubSheetProps) {
  const tokens = useTokens();
  const { t } = useI18n();
  const buda = useBusabaseOrpc();
  const queryClient = useQueryClient();

  const [repoUrl, setRepoUrl] = useState("");
  const [plan, setPlan] = useState<InstallPlanVO | null>(null);
  const [intoFolder, setIntoFolder] = useState("");
  const [rename, setRename] = useState(false);
  const [autoMerge, setAutoMerge] = useState(false);
  const [result, setResult] = useState<InstallResultVO | null>(null);

  /**
   * Structure (the folder, its Bases, their fields and views) is materialized
   * immediately, so the node tree has changed even when every record is still
   * pending review — the drawer and the Bases/Inbox screens are stale the
   * moment the install returns.
   */
  const refreshWorkspace = () => {
    if (!buda) return;
    void queryClient.invalidateQueries({ queryKey: buda.orpc.nodes.list.key() });
    void queryClient.invalidateQueries({ queryKey: buda.orpc.bases.list.key() });
    void queryClient.invalidateQueries({ queryKey: buda.orpc.changeRequests.list.key() });
  };

  /**
   * Ask the server what this URL would create. Re-run whenever an input that
   * changes the answer changes (the target folder decides which node slugs
   * collide; `rename` decides whether a collision is resolved and under what
   * slug), so the preview on screen is never a stale answer to a different
   * question.
   */
  const planMutation = useMutation<InstallPlanVO, Error, { intoFolder?: string; rename?: boolean }>(
    {
      mutationFn: async (overrides) => {
        if (!buda) throw new Error(t.common.notConnected);
        const trimmedUrl = repoUrl.trim();
        if (!trimmedUrl) throw new Error(t.install.repoUrlRequired);
        const nextFolder = (overrides.intoFolder ?? intoFolder).trim();
        return buda.client.install.planFromGithub({
          repoUrl: trimmedUrl,
          ...(nextFolder ? { intoFolder: nextFolder } : {}),
          rename: overrides.rename ?? rename,
        });
      },
      onSuccess: (next, overrides) => {
        setPlan(next);
        // Seed the target-folder field from the plan's own suggestion (the
        // manifest name) the first time; afterwards the user's value wins.
        setIntoFolder((overrides.intoFolder ?? intoFolder).trim() || next.targetFolderSlug);
      },
    },
  );

  const installMutation = useMutation<InstallResultVO, Error, void>({
    mutationFn: async () => {
      if (!buda) throw new Error(t.common.notConnected);
      const trimmedFolder = intoFolder.trim();
      return buda.client.install.fromGithub({
        repoUrl: repoUrl.trim(),
        ...(trimmedFolder ? { intoFolder: trimmedFolder } : {}),
        rename,
        autoMerge,
      });
    },
    onSuccess: (installed) => {
      setResult(installed);
      refreshWorkspace();
    },
  });

  const reset = () => {
    setRepoUrl("");
    setPlan(null);
    setIntoFolder("");
    setRename(false);
    setAutoMerge(false);
    setResult(null);
    planMutation.reset();
    installMutation.reset();
  };

  const close = () => {
    reset();
    onClose();
  };

  const planning = planMutation.isPending;
  const installing = installMutation.isPending;
  // The server's messages are written to be read by a person — "Not a Busabase
  // package — expected busabase.json at …", "Your role does not have access",
  // the SSRF/allowlist refusal. Show them as-is; a generic "something went
  // wrong" would throw away the only useful part. The localized fallbacks only
  // cover a failure that arrived with no message at all (e.g. a bare transport
  // error), which would otherwise render as an empty red bar.
  const errorFor = (caught: Error | null, fallback: string): string | null =>
    caught ? caught.message || fallback : null;
  const error =
    errorFor(installMutation.error, t.install.installFailed) ??
    errorFor(planMutation.error, t.install.previewFailed);

  // A collision the server could not resolve — `renamedTo` is set only when
  // `rename` was on and produced a free slug.
  const unresolvedCollisions = plan?.collisions.filter((collision) => !collision.renamedTo) ?? [];
  // Derived from the plan's structured signals rather than its `applicable`
  // flag: `applicable` reflects the autoMerge the plan was FETCHED with, but
  // the toggle below can change after that without a re-plan.
  const autoMergeUnmet = Boolean(plan?.requiresAutoMerge) && !autoMerge;
  const canInstall =
    plan !== null &&
    !planning &&
    !installing &&
    unresolvedCollisions.length === 0 &&
    !autoMergeUnmet;

  const summaryFor = (node: InstallPlanNodeVO): string | null => {
    if (node.type === "base") {
      return fmt(t.install.baseSummary, {
        fields: node.fieldCount ?? 0,
        records: node.recordCount ?? 0,
      });
    }
    if (node.fileCount !== undefined) {
      return fmt(t.install.fileTreeSummary, { files: node.fileCount });
    }
    return null;
  };

  const collisionLine = (collision: InstallCollisionVO): string =>
    collision.kind === "base"
      ? fmt(t.install.collisionBase, { slug: collision.slug })
      : fmt(t.install.collisionNode, { slug: collision.slug, path: collision.path });

  const footer = (
    <NativeActionBar>
      {error ? (
        <NativeInlineError
          message={error}
          onReset={() => {
            planMutation.reset();
            installMutation.reset();
          }}
        />
      ) : null}
      {result ? (
        <>
          {result.pendingChangeRequests > 0 ? (
            <Button
              label={t.install.reviewNow}
              fullWidth
              onPress={() => {
                reset();
                onClose();
                onReviewChangeRequests();
              }}
            />
          ) : null}
          <Button
            label={t.install.done}
            variant={result.pendingChangeRequests > 0 ? "ghost" : "primary"}
            fullWidth
            onPress={close}
          />
        </>
      ) : (
        <>
          {plan ? (
            // `loading` is deliberately not used here: the shared Button renders
            // a hardcoded English "Loading..." in that state, and this flow's
            // progress wording is localized (and more specific).
            <Button
              label={installing ? t.install.installing : t.install.install}
              disabled={!canInstall}
              fullWidth
              onPress={() => installMutation.mutate()}
            />
          ) : (
            <Button
              label={planning ? t.install.previewing : t.install.preview}
              disabled={planning || repoUrl.trim().length === 0}
              fullWidth
              onPress={() => planMutation.mutate({})}
            />
          )}
          <Button
            label={t.common.cancel}
            variant="ghost"
            disabled={installing}
            fullWidth
            onPress={close}
          />
        </>
      )}
    </NativeActionBar>
  );

  return (
    <NativeBottomSheet
      visible={visible}
      title={t.install.title}
      description={result ? undefined : t.install.description}
      showCloseButton
      maxHeight="90%"
      onClose={close}
      footer={footer}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
      >
        {result ? (
          <ResultStep result={result} t={t} tokens={tokens} />
        ) : (
          <>
            <TextInput
              label={t.install.repoUrl}
              value={repoUrl}
              placeholder={t.install.repoUrlPlaceholder}
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!planning && !installing}
              returnKeyType="go"
              onSubmitEditing={() => {
                if (!plan) planMutation.mutate({});
              }}
              onChangeText={(value) => {
                setRepoUrl(value);
                // The plan on screen describes the previous URL — drop it
                // rather than let it look like an answer for this one.
                setPlan(null);
                planMutation.reset();
                installMutation.reset();
              }}
            />
            <Text style={[typography.caption, { color: tokens.mutedForeground }]}>
              {t.install.repoUrlHint}
            </Text>

            {planning ? <NativeLoadingState label={t.install.previewing} /> : null}
            {installing ? <NativeLoadingState label={t.install.installingHint} /> : null}

            {plan && !installing ? (
              <>
                <View
                  style={[
                    styles.panel,
                    { borderColor: tokens.border, backgroundColor: tokens.muted },
                  ]}
                >
                  <Text style={[typography.bodyEm, { color: tokens.foreground }]}>
                    {plan.package.name}
                  </Text>
                  {plan.package.description ? (
                    <Text style={[typography.small, { color: tokens.mutedForeground }]}>
                      {plan.package.description}
                    </Text>
                  ) : null}
                  {packageMeta(plan, t).length > 0 ? (
                    <Text style={[typography.caption, { color: tokens.mutedForeground }]}>
                      {packageMeta(plan, t).join(" · ")}
                    </Text>
                  ) : null}
                  <Text style={[typography.caption, { color: tokens.mutedForeground }]}>
                    {`${t.install.source}: ${sourceLine(plan, t)}`}
                  </Text>
                </View>

                <Text style={[typography.bodyEm, { color: tokens.foreground }]}>
                  {t.install.contents}
                </Text>
                {plan.nodes.length === 0 ? (
                  <Text style={[typography.small, { color: tokens.mutedForeground }]}>
                    {t.install.emptyPackage}
                  </Text>
                ) : (
                  <>
                    <View style={[styles.panel, { borderColor: tokens.border }]}>
                      {plan.nodes.map((node) => {
                        const Icon = nodeIconForType(node.type);
                        const summary = summaryFor(node);
                        return (
                          <View
                            key={node.path}
                            style={[styles.treeRow, { paddingLeft: node.depth * 14 }]}
                          >
                            <Icon size={14} color={tokens.mutedForeground} />
                            <Text
                              numberOfLines={1}
                              style={[
                                typography.small,
                                styles.treeName,
                                { color: tokens.foreground },
                              ]}
                            >
                              {node.name}
                            </Text>
                            <Text
                              numberOfLines={1}
                              style={[
                                typography.caption,
                                styles.treeMeta,
                                { color: tokens.mutedForeground },
                              ]}
                            >
                              {summary ?? node.slug}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                    <Text style={[typography.caption, { color: tokens.mutedForeground }]}>
                      {fmt(t.install.countsSummary, {
                        folders: plan.counts.folders,
                        docs: plan.counts.docs,
                        bases: plan.counts.bases,
                        records: plan.counts.records,
                        files: plan.counts.files,
                      })}
                    </Text>
                  </>
                )}

                {plan.collisions.length > 0 ? (
                  <Notice
                    danger={unresolvedCollisions.length > 0}
                    lines={plan.collisions.map((collision) =>
                      [
                        collisionLine(collision),
                        collision.renamedTo
                          ? fmt(t.install.collisionRenamedTo, { renamedTo: collision.renamedTo })
                          : null,
                      ]
                        .filter((part): part is string => part !== null)
                        .join(" "),
                    )}
                    body={t.install.collisionsBody}
                    title={t.install.collisionsTitle}
                    tokens={tokens}
                  />
                ) : null}

                {plan.warnings.length > 0 ? (
                  <Notice lines={plan.warnings} title={t.install.warningsTitle} tokens={tokens} />
                ) : null}

                <TextInput
                  label={t.install.targetFolder}
                  value={intoFolder}
                  editable={!planning && !installing}
                  onChangeText={setIntoFolder}
                  onBlur={() => {
                    // The target folder decides which node slugs collide, so a
                    // changed value makes the preview stale — re-ask.
                    const next = intoFolder.trim();
                    if (next && next !== plan.targetFolderSlug) {
                      planMutation.mutate({});
                    }
                  }}
                />
                <Text style={[typography.caption, { color: tokens.mutedForeground }]}>
                  {t.install.targetFolderHint}
                </Text>

                {plan.collisions.length > 0 ? (
                  <View style={[styles.toggle, { borderColor: tokens.border }]}>
                    <NativeRow
                      title={t.install.rename}
                      subtitle={t.install.renameHint}
                      disabled={planning || installing}
                      trailing={<CheckMark checked={rename} tokens={tokens} />}
                      last
                      onPress={() => {
                        const next = !rename;
                        setRename(next);
                        planMutation.mutate({ rename: next });
                      }}
                    />
                  </View>
                ) : null}

                {plan.requiresAutoMerge ? (
                  <Notice
                    body={t.install.autoMergeRequiredBody}
                    danger
                    title={t.install.autoMergeRequiredTitle}
                    tokens={tokens}
                  />
                ) : null}

                <View style={[styles.toggle, { borderColor: tokens.border }]}>
                  <NativeRow
                    title={t.install.autoMerge}
                    subtitle={t.install.autoMergeBody}
                    disabled={installing}
                    trailing={<CheckMark checked={autoMerge} tokens={tokens} />}
                    last
                    onPress={() => setAutoMerge((current) => !current)}
                  />
                </View>
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </NativeBottomSheet>
  );
}

type Tokens = ReturnType<typeof useTokens>;
type Messages = ReturnType<typeof useI18n>["t"];

/** The package's own identity, so the user can tell what they actually fetched. */
const packageMeta = (plan: InstallPlanVO, t: Messages): string[] =>
  [
    plan.package.version ? fmt(t.install.packageVersion, { version: plan.package.version }) : null,
    plan.package.author ? fmt(t.install.packageAuthor, { author: plan.package.author }) : null,
    plan.package.license ? fmt(t.install.packageLicense, { license: plan.package.license }) : null,
  ].filter((entry): entry is string => entry !== null);

const sourceLine = (plan: InstallPlanVO, t: Messages): string =>
  [
    `${plan.source.owner}/${plan.source.repo}`,
    plan.source.ref ? fmt(t.install.sourceRef, { ref: plan.source.ref }) : null,
    plan.source.subdir ? fmt(t.install.sourceSubdir, { subdir: plan.source.subdir }) : null,
  ]
    .filter((entry): entry is string => entry !== null)
    .join(" ");

function CheckMark({ checked, tokens }: { checked: boolean; tokens: Tokens }) {
  return checked ? (
    <SquareCheck size={20} color={tokens.primary} />
  ) : (
    <Square size={20} color={tokens.mutedForeground} />
  );
}

/** The native stand-in for web's `<Alert>` — a bordered block, tinted by tone. */
function Notice({
  body,
  danger,
  lines,
  title,
  tokens,
}: {
  body?: string;
  danger?: boolean;
  lines?: string[];
  title: string;
  tokens: Tokens;
}) {
  const accent = danger ? tokens.destructive : tokens.warning;
  return (
    <View style={[styles.panel, { borderColor: danger ? tokens.destructive : tokens.border }]}>
      <View style={styles.noticeTitleRow}>
        <TriangleAlert size={16} color={accent} />
        <Text style={[typography.bodyEm, styles.noticeTitle, { color: accent }]}>{title}</Text>
      </View>
      {body ? (
        <Text style={[typography.small, { color: tokens.mutedForeground }]}>{body}</Text>
      ) : null}
      {lines?.map((line) => (
        <Text key={line} style={[typography.small, { color: tokens.foreground }]}>
          {line}
        </Text>
      ))}
    </View>
  );
}

/**
 * What actually happened. The pending-change-request pointer is the important
 * half: structure is materialized immediately (a pending Base has no id to hang
 * a view or a record on), so the tree already changed — but the package's
 * *content* is only proposed, and saying so plainly is what keeps the
 * approval-first promise legible.
 */
function ResultStep({
  result,
  t,
  tokens,
}: {
  result: InstallResultVO;
  t: Messages;
  tokens: Tokens;
}) {
  return (
    <>
      <View style={styles.resultTitleRow}>
        <CircleCheck size={18} color={tokens.merged.text} />
        <Text style={[typography.bodyEm, styles.resultTitle, { color: tokens.foreground }]}>
          {fmt(t.install.resultTitle, { folder: result.targetFolderSlug })}
        </Text>
      </View>
      <Text style={[typography.small, { color: tokens.mutedForeground }]}>
        {fmt(t.install.resultCounts, {
          folders: result.created.folders,
          bases: result.created.bases,
          views: result.created.views,
          docs: result.created.docs,
          records: result.created.records,
          files: result.created.files,
        })}
      </Text>

      {result.pendingChangeRequests > 0 ? (
        <Notice
          body={t.install.pendingBody}
          title={fmt(t.install.pendingTitle, { count: result.pendingChangeRequests })}
          tokens={tokens}
        />
      ) : (
        <Text style={[typography.small, { color: tokens.mutedForeground }]}>
          {t.install.noPending}
        </Text>
      )}

      {result.warnings.length > 0 ? (
        <Notice lines={result.warnings} title={t.install.warningsTitle} tokens={tokens} />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { maxHeight: 460 },
  body: { gap: 10, paddingBottom: spacing[2] },
  panel: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing[3],
    gap: spacing[1] + 2,
  },
  treeRow: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  treeName: { flexShrink: 1, minWidth: 0 },
  treeMeta: { flexShrink: 0 },
  noticeTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  noticeTitle: { flex: 1, minWidth: 0 },
  toggle: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md },
  resultTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  resultTitle: { flex: 1, minWidth: 0 },
});
