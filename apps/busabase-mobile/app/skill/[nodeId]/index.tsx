import { skipToken, useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { FileTreeScreen } from "~/components/busabase/FileTreeScreen";
import { asNodeDetail } from "~/lib/node-detail";

function SkillDetailContent() {
  const params = useLocalSearchParams<{ nodeId?: string }>();
  const nodeId = typeof params.nodeId === "string" ? params.nodeId : "";
  const router = useRouter();
  const buda = useBusabaseOrpc();

  const skillQuery = useQuery(
    buda && nodeId
      ? buda.orpc.nodes.get.queryOptions({ input: { nodeId, type: "skill" } })
      : { queryKey: ["no-connection", "skill", nodeId], queryFn: skipToken },
  );
  // `nodes.get` answers for every node type; narrowing to `skill` means a slug
  // that resolved to some other type renders FileTreeScreen's not-found state
  // instead of an empty file list wearing this Skill's chrome.
  const skill = asNodeDetail(skillQuery.data, "skill");

  return (
    <FileTreeScreen
      title="Skill"
      entityLabel="Skill"
      fileTree={skill}
      loading={skillQuery.isLoading}
      error={skillQuery.error ?? null}
      refreshing={skillQuery.isRefetching}
      onRefresh={() => void skillQuery.refetch()}
      onReadFile={(filePath) => {
        if (!buda) throw new Error("Not connected");
        return buda.client.fileTrees.readFile({ type: "skill", nodeId, filePath });
      }}
      onCreateChangeRequest={(input) => {
        if (!buda) throw new Error("Not connected");
        // The screen promises "the file changes only after review and merge" and then
        // navigates to the ChangeRequest, so review is not optional here.
        return buda.client.fileTrees.createChangeRequest({
          type: "skill",
          nodeId,
          autoMerge: false,
          ...input,
        });
      }}
      onChangeRequestCreated={(changeRequestId) =>
        router.push({ pathname: "/change-requests/[id]", params: { id: changeRequestId } })
      }
    />
  );
}

export default function SkillDetailScreen() {
  return (
    <ConnectionGuard>
      <SkillDetailContent />
    </ConnectionGuard>
  );
}
