import {
  orderedWorkflowRunSteps,
  workflowRunStatusLabelKey,
  workflowRunStepLabel,
} from "busabase-core/dashboard/workflow-run-view";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, Check, X } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  NativeActionBar,
  NativeActionItem,
  NativeActionRow,
  NativeEmptyState,
  NativeErrorState,
  NativeInlineError,
  NativeLoadingState,
  NativeRow,
  NativeSection,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { ConnectionGuard } from "~/domains/workspace/components/ConnectionGuard";
import { DrawerScaffold } from "~/domains/workspace/components/DrawerScaffold";
import { fmt, useI18n } from "~/i18n";
import { formatDate, shortId } from "~/lib/format";
import { mobile, radius, spacing, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import { useDecideWorkflowRun, useWorkflowRun } from "../hooks/use-workflow-run";
import { canDecideRun, clipStepJson, workflowRunStarterName } from "../utils/run-display";
import { RunStatusDot } from "./RunStatusDot";

function WorkflowRunContent() {
  const params = useLocalSearchParams<{ nodeId?: string; runId?: string }>();
  const nodeId = typeof params.nodeId === "string" ? params.nodeId : "";
  const runId = typeof params.runId === "string" ? params.runId : "";
  const router = useRouter();
  const tokens = useTokens();
  const { t } = useI18n();
  const detail = useWorkflowRun(nodeId, runId);
  const decide = useDecideWorkflowRun();
  const [openStepId, setOpenStepId] = useState<string | null>(null);

  const headerLeading = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Go back"
      hitSlop={mobile.hitSlop}
      style={[styles.backButton, { backgroundColor: tokens.primaryMuted }]}
      onPress={() => (router.canGoBack() ? router.back() : router.replace("/drawer/inbox"))}
    >
      <ArrowLeft size={22} color={tokens.foreground} />
    </Pressable>
  );
  const title = detail.workflowName || t.workflow.runTitle;

  if (detail.loading) {
    return (
      <DrawerScaffold title={title} headerLeading={headerLeading}>
        <NativeLoadingState label={t.workflow.loadingRun} />
      </DrawerScaffold>
    );
  }
  if (detail.error && !detail.run) {
    return (
      <DrawerScaffold title={title} subtitle={shortId(runId)} headerLeading={headerLeading}>
        <NativeErrorState message={detail.error.message} onRetry={detail.refetch} />
      </DrawerScaffold>
    );
  }
  const run = detail.run;
  if (!run) {
    return (
      <DrawerScaffold title={title} subtitle={shortId(runId)} headerLeading={headerLeading}>
        <NativeEmptyState title={t.workflow.runNotFound} description={t.workflow.runNotFoundBody} />
      </DrawerScaffold>
    );
  }

  const { actorNames, steps } = detail;
  const statusLabel = t.workflow[workflowRunStatusLabelKey(run.status)];
  const starter = workflowRunStarterName(run, actorNames);
  const orderedSteps = orderedWorkflowRunSteps(run.outputs);
  const pause = run.pause;
  const canDecide = canDecideRun(run, detail.decidableRunIds);
  const waitingForApproval = run.status === "waiting_approval" && pause?.kind === "approval";
  // The server says why (someone else decided first, the run was cancelled); that is the useful part.
  const decisionError = decide.error ? decide.error.message || t.workflow.decisionFailed : null;

  const footer =
    canDecide || decisionError ? (
      <NativeActionBar>
        {decisionError ? (
          <NativeInlineError message={decisionError} onReset={() => decide.reset()} />
        ) : null}
        {canDecide ? (
          <NativeActionRow>
            <NativeActionItem>
              <Button
                label={t.workflow.approve}
                leadingIcon={<Check size={18} color={tokens.primaryForeground} />}
                loading={decide.isPending && decide.variables?.decision === "approved"}
                disabled={decide.isPending}
                fullWidth
                onPress={() => decide.mutate({ runId: run.id, decision: "approved" })}
              />
            </NativeActionItem>
            <NativeActionItem>
              <Button
                label={t.workflow.reject}
                variant="destructive"
                leadingIcon={<X size={18} color={tokens.destructiveForeground} />}
                loading={decide.isPending && decide.variables?.decision === "rejected"}
                disabled={decide.isPending}
                fullWidth
                onPress={() => decide.mutate({ runId: run.id, decision: "rejected" })}
              />
            </NativeActionItem>
          </NativeActionRow>
        ) : null}
      </NativeActionBar>
    ) : undefined;

  return (
    <DrawerScaffold
      title={title}
      subtitle={`${statusLabel} · ${formatDate(run.startedAt)}`}
      headerLeading={headerLeading}
      refreshing={detail.refreshing}
      onRefresh={detail.refetch}
      footer={footer}
    >
      <NativeSection title={t.workflow.runTitle}>
        <NativeRow
          title={statusLabel}
          subtitle={
            run.startedVia
              ? fmt(t.workflow.startedByVia, {
                  name: starter,
                  via: run.startedVia.apiKeyName ?? run.startedVia.channel ?? t.workflow.viaAgent,
                })
              : fmt(t.workflow.startedBy, { name: starter })
          }
          subtitleLines={0}
          leading={<RunStatusDot status={run.status} />}
          last
        />
      </NativeSection>

      {waitingForApproval ? (
        <Note testID="workflow-run-approval">
          {[
            fmt(t.workflow.approvalPending, { step: workflowRunStepLabel(pause.nodeId, steps) }),
            canDecide ? "" : t.workflow.cannotDecide,
          ]
            .filter(Boolean)
            .join("\n")}
        </Note>
      ) : null}
      {run.status === "waiting" && pause?.kind === "wait" ? (
        <Note>
          {pause.resumeAt
            ? fmt(t.workflow.waitingUntil, { time: formatDate(pause.resumeAt) })
            : t.workflow.statusWaiting}
        </Note>
      ) : null}
      {run.status === "queued" ? <Note>{t.workflow.queuedNote}</Note> : null}
      {run.status === "cancelled" ? (
        <Note>
          {fmt(t.workflow.cancelledBy, {
            name: run.cancelledBy ? (actorNames[run.cancelledBy] ?? run.cancelledBy) : "",
          })}
        </Note>
      ) : null}
      {run.status === "failed" && run.error ? (
        <Note tone="error" testID="workflow-run-error">
          {`${t.workflow.errorLabel}: ${run.error}`}
        </Note>
      ) : null}

      <NativeSection title={t.workflow.steps} caption={`${orderedSteps.length}`}>
        {orderedSteps.length === 0 ? (
          <Text style={[typography.small, styles.noSteps, { color: tokens.mutedForeground }]}>
            {t.workflow.noSteps}
          </Text>
        ) : (
          orderedSteps.map((step, index) => {
            const open = openStepId === step.id;
            return (
              <NativeRow
                key={step.id}
                title={workflowRunStepLabel(step.id, steps)}
                subtitle={formatDate(step.output.capturedAt)}
                meta={`${index + 1}`}
                last={index === orderedSteps.length - 1 && !open}
                onPress={() => setOpenStepId(open ? null : step.id)}
              >
                {open ? (
                  <View style={[styles.stepData, { backgroundColor: tokens.muted }]}>
                    <Text style={[typography.caption, { color: tokens.mutedForeground }]}>
                      {t.workflow.stepData}
                    </Text>
                    <Text selectable style={[styles.code, { color: tokens.foreground }]}>
                      {clipStepJson(step.output.data)}
                    </Text>
                  </View>
                ) : null}
              </NativeRow>
            );
          })
        )}
      </NativeSection>
    </DrawerScaffold>
  );
}

function Note({ children, tone, testID }: { children: string; tone?: "error"; testID?: string }) {
  const tokens = useTokens();
  const color = tone === "error" ? tokens.destructive : tokens.foreground;
  return (
    <View
      testID={testID}
      style={[
        styles.note,
        { borderColor: tone === "error" ? tokens.destructive : tokens.border },
        { backgroundColor: tokens.muted },
      ]}
    >
      <Text style={[typography.small, { color }]}>{children}</Text>
    </View>
  );
}

export default function WorkflowRunScreen() {
  return (
    <ConnectionGuard>
      <WorkflowRunContent />
    </ConnectionGuard>
  );
}

const styles = StyleSheet.create({
  backButton: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  note: {
    marginHorizontal: spacing[5],
    marginTop: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
  },
  noSteps: { paddingHorizontal: spacing[5], paddingVertical: spacing[4] },
  stepData: {
    marginTop: spacing[2],
    padding: spacing[3],
    gap: spacing[1],
    borderRadius: radius.md,
  },
  code: { fontFamily: "monospace", fontSize: 12, lineHeight: 18 },
});
