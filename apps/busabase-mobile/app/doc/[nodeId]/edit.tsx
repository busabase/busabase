import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, GitPullRequest, Save } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import {
  NativeActionBar,
  NativeBottomSheet,
  NativeEmptyState,
  NativeErrorState,
  NativeInlineError,
  NativeLoadingState,
  NativeSection,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { TextInput } from "~/components/ui/TextInput";
import { asNodeDetail } from "~/domains/knowledge/utils/node-detail";
import { ConnectionGuard } from "~/domains/workspace/components/ConnectionGuard";
import { DrawerScaffold } from "~/domains/workspace/components/DrawerScaffold";
import { useI18n } from "~/i18n";
import { mobile, radius, spacing } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

const SUBMITTED_BY = "mobile-editor";

function countLines(value: string) {
  return value.length === 0 ? 0 : value.split(/\r\n|\r|\n/).length;
}

function countCharacters(value: string) {
  return Array.from(value).length;
}

function formatSignedCount(value: number, singular: string, plural = `${singular}s`) {
  const label = Math.abs(value) === 1 ? singular : plural;
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toLocaleString()} ${label}`;
}

function getBodyChangeSummary(before: string, after: string) {
  const lineDelta = countLines(after) - countLines(before);
  const characterDelta = countCharacters(after) - countCharacters(before);

  return `${formatSignedCount(lineDelta, "line")} · ${formatSignedCount(
    characterDelta,
    "character",
  )}`;
}

function DocEditContent() {
  const params = useLocalSearchParams<{ nodeId?: string }>();
  const nodeId = typeof params.nodeId === "string" ? params.nodeId : "";
  const router = useRouter();
  const tokens = useTokens();
  const { t } = useI18n();
  const buda = useBusabaseOrpc();
  const [body, setBody] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [saveSheetOpen, setSaveSheetOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [changeMessage, setChangeMessage] = useState("");

  const docQuery = useQuery(
    buda && nodeId
      ? buda.orpc.nodes.get.queryOptions({ input: { nodeId, type: "doc" } })
      : { queryKey: ["no-connection", "doc", nodeId], queryFn: skipToken },
  );
  // `nodes.get` answers for every node type, so narrow before reading `.body`.
  // A non-Doc result (a slug shared with another type) must NOT open an editor
  // seeded with an empty body that a Save would then write over the Doc.
  const doc = asNodeDetail(docQuery.data, "doc");

  useEffect(() => {
    if (doc && !hydrated) {
      setBody(doc.body);
      setChangeMessage(`Update ${doc.node.name}`);
      setHydrated(true);
    }
  }, [doc, hydrated]);

  const title = doc?.node.name ?? "Doc";
  const originalBody = doc?.body ?? "";
  const unchanged = originalBody === body;
  const changeSummary = getBodyChangeSummary(originalBody, body);
  const defaultChangeMessage = title === "Doc" ? "Update doc" : `Update ${title}`;
  const customChangeMessage = changeMessage.trim();
  const hasUnsavedChanges =
    !unchanged || (customChangeMessage.length > 0 && customChangeMessage !== defaultChangeMessage);

  const createChangeRequestMutation = useMutation({
    mutationFn: async () => {
      if (!buda) throw new Error("Not connected");
      return buda.client.nodes.updateContent({
        nodeId,
        content: { kind: "doc", body },
        message: changeMessage.trim() || defaultChangeMessage,
        submittedBy: SUBMITTED_BY,
        // This is the "Save as change request" button, sitting next to a separate
        // "Direct save". `autoMerge` is permission-aware when omitted, so without
        // this the two buttons do the same thing for any write-capable user and
        // the screen then navigates to an already-merged ChangeRequest.
        autoMerge: false,
      });
    },
    onSuccess: (changeRequest) =>
      router.replace({ pathname: "/change-requests/[id]", params: { id: changeRequest.id } }),
  });

  const directSaveMutation = useMutation({
    mutationFn: async () => {
      if (!buda) throw new Error("Not connected");
      return buda.client.nodes.updateContent({ nodeId, content: { kind: "doc", body } });
    },
    onSuccess: () =>
      router.replace({
        pathname: "/doc/[nodeId]",
        params: { nodeId },
      }),
  });

  const saving = directSaveMutation.isPending || createChangeRequestMutation.isPending;
  const goBack = () => {
    if (saving) {
      return;
    }
    if (hasUnsavedChanges) {
      setDiscardOpen(true);
      return;
    }
    router.canGoBack() ? router.back() : router.replace("/drawer/home");
  };
  const discardChanges = () => {
    if (saving) {
      return;
    }
    setDiscardOpen(false);
    router.canGoBack() ? router.back() : router.replace("/drawer/home");
  };

  const headerLeading = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Go back"
      hitSlop={mobile.hitSlop}
      style={[styles.backButton, { backgroundColor: tokens.primaryMuted }]}
      onPress={goBack}
    >
      <ArrowLeft size={22} color={tokens.foreground} />
    </Pressable>
  );

  const actionError = directSaveMutation.error ?? createChangeRequestMutation.error;
  const resetActionErrors = () => {
    directSaveMutation.reset();
    createChangeRequestMutation.reset();
  };

  if (docQuery.isLoading) {
    return (
      <DrawerScaffold
        title={title}
        titleNumberOfLines={2}
        subtitle={t.common.edit}
        headerLeading={headerLeading}
      >
        <NativeLoadingState label={t.common.loading} />
      </DrawerScaffold>
    );
  }
  if (docQuery.error) {
    return (
      <DrawerScaffold
        title={title}
        titleNumberOfLines={2}
        subtitle={t.common.edit}
        headerLeading={headerLeading}
      >
        <NativeErrorState
          message={docQuery.error.message}
          onRetry={() => void docQuery.refetch()}
        />
      </DrawerScaffold>
    );
  }
  if (!doc) {
    // Settled, no error, but not a Doc (or nothing at all) — show the same empty
    // state the read screen shows instead of an editor over a body we never read.
    return (
      <DrawerScaffold
        title={title}
        titleNumberOfLines={2}
        subtitle={t.common.edit}
        headerLeading={headerLeading}
      >
        <NativeEmptyState description="This doc is not available." title="Doc not found" />
      </DrawerScaffold>
    );
  }

  return (
    <DrawerScaffold
      title={title}
      titleNumberOfLines={2}
      subtitle={t.common.edit}
      headerLeading={headerLeading}
      contentContainerStyle={styles.screenContent}
      footer={
        <NativeActionBar>
          {actionError ? (
            <NativeInlineError message={actionError.message} onReset={resetActionErrors} />
          ) : null}
          <Button
            label="Save"
            loading={saving}
            disabled={saving || unchanged}
            fullWidth
            leadingIcon={<Save size={18} color={tokens.primaryForeground} />}
            onPress={() => {
              resetActionErrors();
              if (!changeMessage.trim()) {
                setChangeMessage(defaultChangeMessage);
              }
              setSaveSheetOpen(true);
            }}
          />
        </NativeActionBar>
      }
    >
      <NativeSection
        title="Body"
        caption={unchanged ? "Saved" : changeSummary}
        style={styles.editorSection}
      >
        <View style={styles.editorWrap}>
          <TextInput
            accessibilityLabel="Document body"
            value={body}
            multiline
            textAlignVertical="top"
            containerStyle={styles.editorField}
            style={styles.editor}
            onChangeText={setBody}
          />
        </View>
      </NativeSection>
      <NativeBottomSheet
        visible={saveSheetOpen}
        title="Save doc"
        description={unchanged ? "No changes" : changeSummary}
        showCloseButton
        onClose={() => setSaveSheetOpen(false)}
        footer={
          <NativeActionBar>
            {actionError ? (
              <NativeInlineError message={actionError.message} onReset={resetActionErrors} />
            ) : null}
            <Button
              label="Direct save"
              variant="secondary"
              loading={directSaveMutation.isPending}
              disabled={saving || unchanged}
              fullWidth
              leadingIcon={<Save size={18} color={tokens.foreground} />}
              onPress={() => directSaveMutation.mutate()}
            />
            <Button
              label="Save as change request"
              loading={createChangeRequestMutation.isPending}
              disabled={saving || unchanged}
              fullWidth
              leadingIcon={<GitPullRequest size={18} color={tokens.primaryForeground} />}
              onPress={() => createChangeRequestMutation.mutate()}
            />
            <Button
              label="Cancel"
              variant="ghost"
              disabled={saving}
              fullWidth
              onPress={() => setSaveSheetOpen(false)}
            />
          </NativeActionBar>
        }
      >
        <View style={styles.sheetBody}>
          <TextInput
            label="Change request message"
            value={changeMessage}
            placeholder={defaultChangeMessage}
            onChangeText={setChangeMessage}
          />
        </View>
      </NativeBottomSheet>
      <NativeBottomSheet
        visible={discardOpen}
        title="Discard changes?"
        description="This closes the doc editor and removes unsaved body or change request message edits."
        showCloseButton
        onClose={() => setDiscardOpen(false)}
        footer={
          <NativeActionBar>
            <Button
              label="Discard changes"
              variant="destructive"
              disabled={saving}
              fullWidth
              onPress={discardChanges}
            />
            <Button
              label="Keep editing"
              variant="ghost"
              disabled={saving}
              fullWidth
              onPress={() => setDiscardOpen(false)}
            />
          </NativeActionBar>
        }
      />
    </DrawerScaffold>
  );
}

export default function DocEditScreen() {
  return (
    <ConnectionGuard>
      <DocEditContent />
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
  screenContent: { flexGrow: 1, paddingBottom: spacing[3] },
  editorSection: { flex: 1 },
  editorWrap: { flex: 1, paddingHorizontal: 14, paddingVertical: 12 },
  editorField: { flex: 1 },
  sheetBody: { paddingTop: 4 },
  editor: {
    flex: 1,
    minHeight: 280,
    paddingTop: 12,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    fontSize: 13,
    lineHeight: 19,
  },
});
