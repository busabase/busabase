import { useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { Pressable, StyleSheet } from "react-native";
import {
  NativeEmptyState,
  NativeErrorState,
  NativeLoadingState,
  NativeSection,
} from "~/components/native-screen";
import { ConnectionGuard } from "~/domains/workspace/components/ConnectionGuard";
import { DrawerScaffold } from "~/domains/workspace/components/DrawerScaffold";
import { useI18n } from "~/i18n";
import { mobile, radius } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import { useWaitingWorkflowRuns } from "../hooks/use-waiting-workflow-runs";
import { WaitingApprovalRow } from "./WaitingApprovalRow";

function ApprovalsContent() {
  const { t } = useI18n();
  const router = useRouter();
  const tokens = useTokens();
  const approvals = useWaitingWorkflowRuns({ enabled: true });

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

  return (
    <DrawerScaffold
      title={t.workflow.approvalsTitle}
      headerLeading={headerLeading}
      refreshing={approvals.refreshing}
      onRefresh={approvals.refetch}
    >
      {approvals.loading ? <NativeLoadingState label={t.workflow.approvalsLoading} /> : null}
      {approvals.error ? (
        <NativeErrorState message={approvals.error.message} onRetry={approvals.refetch} />
      ) : null}
      {!approvals.loading && !approvals.error && approvals.items.length === 0 ? (
        <NativeEmptyState title={t.workflow.approvalsEmpty} />
      ) : null}
      {approvals.items.length > 0 ? (
        <NativeSection title={t.workflow.approvalsTitle} caption={`${approvals.items.length}`}>
          {approvals.items.map((item, index) => (
            <WaitingApprovalRow
              key={item.run.id}
              item={item}
              actorNames={approvals.actorNames}
              last={index === approvals.items.length - 1}
              onPress={() =>
                router.push({
                  pathname: "/workflow/[nodeId]/runs/[runId]",
                  params: { nodeId: item.run.workflowNodeId, runId: item.run.id },
                })
              }
            />
          ))}
        </NativeSection>
      ) : null}
    </DrawerScaffold>
  );
}

export default function ApprovalsScreen() {
  return (
    <ConnectionGuard>
      <ApprovalsContent />
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
});
