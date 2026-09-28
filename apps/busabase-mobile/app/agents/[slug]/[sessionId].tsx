import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAgentSession } from "busabase-core/domains/agents/hooks/use-agent-session";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, MoreHorizontal } from "lucide-react-native";
import { useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import {
  NativeBottomSheet,
  NativeInlineError,
  NativeLoadingState,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { AcpComposer } from "~/domains/agents/components/AcpComposer";
import { AcpTranscript } from "~/domains/agents/components/AcpTranscript";
import {
  agentSessionStatusLabel,
  deriveAgentSessionStatus,
} from "~/domains/agents/utils/session-status";
import { ConnectionGuard } from "~/domains/workspace/components/ConnectionGuard";
import { fmt, useI18n } from "~/i18n";
import { mobile, spacing, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

type Buda = NonNullable<ReturnType<typeof useBusabaseOrpc>>;

/**
 * `useAgentSession` (unlike `useQuery`) takes `orpc` directly rather than
 * accepting a `skipToken` fallback, so it cannot itself be called
 * conditionally on `buda`. Rather than an early `if (!buda) return null`
 * inside the hook-calling component — which puts every hook after it in
 * violation of the rules of hooks — the "might not be connected yet" branch
 * lives here, one component up, exactly like `ConnectionGuard` itself does.
 * By the time `AgentChatContent` mounts, `buda` is a prop, not a nullable
 * value it has to keep re-checking.
 */
function AgentChatGate() {
  const buda = useBusabaseOrpc();
  if (!buda) return <NativeLoadingState label="Connecting" />;
  return <AgentChatContent buda={buda} />;
}

function AgentChatContent({ buda }: { buda: Buda }) {
  const params = useLocalSearchParams<{ slug?: string; sessionId?: string }>();
  const slug = typeof params.slug === "string" ? params.slug : "";
  const sessionId = typeof params.sessionId === "string" ? params.sessionId : "";
  const router = useRouter();
  const tokens = useTokens();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [actionsOpen, setActionsOpen] = useState(false);
  const [endConfirmOpen, setEndConfirmOpen] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const connectionsQueryKey = buda.orpc.agents.connections.list.queryKey({
    input: { scope: "mine" },
  });
  const agentName =
    queryClient
      .getQueryData<Array<{ slug: string; agentName: string }>>(connectionsQueryKey)
      ?.find((entry) => entry.slug === slug)?.agentName ?? slug;

  const pagedSessionQueryKey = buda.orpc.agents.sessions.listPaged.infiniteKey({
    input: (cursor: string | undefined) => ({ slug, limit: 20, cursor }),
    initialPageParam: undefined as string | undefined,
  });
  const chat = useAgentSession(buda.orpc, sessionId || null, pagedSessionQueryKey);
  const status = deriveAgentSessionStatus(chat);

  const refreshSessionLists = () => {
    void queryClient.invalidateQueries({ queryKey: connectionsQueryKey });
    void queryClient.invalidateQueries({ queryKey: buda.orpc.agents.sessions.key() });
  };

  // Same reasoning as web's `agent-detail-view.tsx`: NOT wired into
  // `AcpSessionPort.end` (that slot fires from `useAcpSession`'s unmount
  // cleanup — implementing it would end this session every time the user
  // navigates back). Ending is only ever this explicit button.
  const endSession = useMutation({
    ...buda.orpc.agents.sessions.close.mutationOptions(),
    onSuccess: () => {
      setEndConfirmOpen(false);
      setActionsOpen(false);
      refreshSessionLists();
    },
  });

  const tail = chat.blocks.length > 0 ? chat.blocks[chat.blocks.length - 1] : undefined;
  const waitingOnPermission = tail?.kind === "permission" && tail.resolution === "pending";
  const composerDisabled = !chat.sessionId || chat.sending || chat.ended;

  return (
    <SafeAreaView edges={["top"]} style={[styles.safe, { backgroundColor: tokens.background }]}>
      <KeyboardAvoidingView
        style={styles.safe}
        behavior={Platform.select({ ios: "padding", default: undefined })}
        keyboardVerticalOffset={Platform.select({ ios: mobile.headerHeight, default: 0 })}
      >
        <View style={[styles.header, { borderColor: tokens.border }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={mobile.hitSlop}
            style={[styles.iconButton, { backgroundColor: tokens.primaryMuted }]}
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/drawer/agents"))}
          >
            <ArrowLeft size={22} color={tokens.foreground} />
          </Pressable>
          <View style={styles.titleBlock}>
            <Text numberOfLines={1} style={[typography.h1, { color: tokens.foreground }]}>
              {agentName}
            </Text>
            <Text numberOfLines={1} style={[typography.small, { color: tokens.mutedForeground }]}>
              {agentSessionStatusLabel(status, t.agents)}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.agents.sessionActions}
            hitSlop={mobile.hitSlop}
            style={[styles.iconButton, { backgroundColor: tokens.primaryMuted }]}
            onPress={() => setActionsOpen(true)}
          >
            <MoreHorizontal size={21} color={tokens.foreground} />
          </Pressable>
        </View>

        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          {chat.error ? <NativeInlineError message={chat.error} /> : null}
          {chat.blocks.length === 0 && !chat.error ? (
            <View style={styles.emptyState}>
              <Text style={[typography.h2, { color: tokens.foreground }]}>
                {t.agents.conversationConnectedTitle}
              </Text>
              <Text style={[typography.body, { color: tokens.mutedForeground }]}>
                {t.agents.conversationConnectedBody}
              </Text>
            </View>
          ) : null}
          <AcpTranscript
            blocks={chat.blocks}
            streaming={chat.sending}
            onAnswerPermission={(block, optionId) => void chat.answerPermission(block, optionId)}
          />
        </ScrollView>

        <View
          style={[styles.footer, { backgroundColor: tokens.surface, borderColor: tokens.border }]}
        >
          <AcpComposer
            disabled={composerDisabled}
            sending={chat.sending}
            placeholder={
              waitingOnPermission
                ? t.agents.composerWaitingPlaceholder
                : fmt(t.agents.composerDefaultPlaceholder, { name: agentName })
            }
            onSend={(text) => void chat.sendPrompt(text)}
            onStop={() => void chat.cancel()}
          />
        </View>
      </KeyboardAvoidingView>

      <NativeBottomSheet
        visible={actionsOpen}
        onClose={() => setActionsOpen(false)}
        title={t.agents.sessionActions}
      >
        <View style={styles.sheetBody}>
          <Button
            label={t.agents.endSession}
            variant="destructive"
            fullWidth
            disabled={chat.ended}
            onPress={() => setEndConfirmOpen(true)}
          />
        </View>
      </NativeBottomSheet>

      <NativeBottomSheet
        visible={endConfirmOpen}
        onClose={() => setEndConfirmOpen(false)}
        title={t.agents.endSessionTitle}
        description={fmt(chat.sending ? t.agents.endSessionBusyBody : t.agents.endSessionBody, {
          name: agentName,
        })}
        footer={
          <View style={styles.sheetFooterRow}>
            <View style={styles.sheetFooterButton}>
              <Button
                label="Cancel"
                variant="secondary"
                fullWidth
                onPress={() => setEndConfirmOpen(false)}
              />
            </View>
            <View style={styles.sheetFooterButton}>
              <Button
                label={t.agents.endSession}
                variant="destructive"
                fullWidth
                loading={endSession.isPending}
                onPress={() => sessionId && endSession.mutate({ sessionId })}
              />
            </View>
          </View>
        }
      >
        {endSession.isError ? <NativeInlineError message={t.agents.endSessionFailed} /> : null}
      </NativeBottomSheet>
    </SafeAreaView>
  );
}

export default function AgentChatScreen() {
  return (
    <ConnectionGuard>
      <AgentChatGate />
    </ConnectionGuard>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    paddingHorizontal: spacing[5],
    paddingTop: Platform.select({ ios: 8, android: 12, default: 10 }),
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  titleBlock: { flex: 1, gap: 2, minWidth: 0 },
  scroll: { flex: 1 },
  scrollContent: { paddingVertical: spacing[3], gap: spacing[3] },
  emptyState: { paddingHorizontal: spacing[5], paddingVertical: spacing[6], gap: spacing[2] },
  footer: { borderTopWidth: StyleSheet.hairlineWidth },
  sheetBody: { paddingBottom: spacing[4] },
  sheetFooterRow: { flexDirection: "row", gap: spacing[3] },
  sheetFooterButton: { flex: 1 },
});
