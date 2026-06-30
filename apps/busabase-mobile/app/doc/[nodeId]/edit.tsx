import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { NativeErrorState, NativeLoadingState, NativeScreen } from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { TextInput } from "~/components/ui/TextInput";
import { useI18n } from "~/i18n";
import { mobile, radius } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

const SUBMITTED_BY = "mobile-editor";

function DocEditContent() {
  const params = useLocalSearchParams<{ nodeId?: string }>();
  const nodeId = typeof params.nodeId === "string" ? params.nodeId : "";
  const router = useRouter();
  const tokens = useTokens();
  const { t } = useI18n();
  const buda = useBusabaseOrpc();
  const [body, setBody] = useState("");
  const [hydrated, setHydrated] = useState(false);

  const docQuery = useQuery(
    buda && nodeId
      ? buda.orpc.docs.get.queryOptions({ input: { nodeId } })
      : { queryKey: ["no-connection", "doc", nodeId], queryFn: skipToken },
  );

  useEffect(() => {
    if (docQuery.data && !hydrated) {
      setBody(docQuery.data.body);
      setHydrated(true);
    }
  }, [docQuery.data, hydrated]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!buda) throw new Error("Not connected");
      // Doc edits go through review: a change request that updates the body on merge.
      return buda.client.docs.createChangeRequest({ nodeId, body, submittedBy: SUBMITTED_BY });
    },
    onSuccess: (changeRequest) =>
      router.replace({ pathname: "/change-requests/[id]", params: { id: changeRequest.id } }),
  });

  const goBack = () => (router.canGoBack() ? router.back() : router.replace("/drawer/inbox"));

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

  const title = docQuery.data?.node.name ?? "Doc";

  if (docQuery.isLoading) {
    return (
      <NativeScreen title={title} subtitle={t.common.edit} headerLeading={headerLeading}>
        <NativeLoadingState label={t.common.loading} />
      </NativeScreen>
    );
  }
  if (docQuery.error) {
    return (
      <NativeScreen title={title} subtitle={t.common.edit} headerLeading={headerLeading}>
        <NativeErrorState
          message={docQuery.error.message}
          onRetry={() => void docQuery.refetch()}
        />
      </NativeScreen>
    );
  }

  return (
    <NativeScreen title={title} subtitle={t.common.edit} headerLeading={headerLeading}>
      <View style={styles.content}>
        <TextInput
          value={body}
          multiline
          textAlignVertical="top"
          style={styles.editor}
          onChangeText={setBody}
        />
        {saveMutation.error ? <NativeErrorState message={saveMutation.error.message} /> : null}
        <Button
          label={t.common.save}
          loading={saveMutation.isPending}
          fullWidth
          onPress={() => saveMutation.mutate()}
        />
      </View>
    </NativeScreen>
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
  content: { marginHorizontal: 20, gap: 14 },
  editor: {
    minHeight: 280,
    paddingTop: 12,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    fontSize: 13,
    lineHeight: 19,
  },
});
