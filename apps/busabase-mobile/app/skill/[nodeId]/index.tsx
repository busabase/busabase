import { skipToken, useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { FileTreeScreen } from "~/components/busabase/FileTreeScreen";

function SkillDetailContent() {
  const params = useLocalSearchParams<{ nodeId?: string }>();
  const nodeId = typeof params.nodeId === "string" ? params.nodeId : "";
  const router = useRouter();
  const buda = useBusabaseOrpc();

  const skillQuery = useQuery(
    buda && nodeId
      ? buda.orpc.skills.get.queryOptions({ input: { nodeId } })
      : { queryKey: ["no-connection", "skill", nodeId], queryFn: skipToken },
  );

  return (
    <FileTreeScreen
      title="Skill"
      entityLabel="Skill"
      fileTree={skillQuery.data ?? null}
      loading={skillQuery.isLoading}
      error={skillQuery.error ?? null}
      refreshing={skillQuery.isRefetching}
      onRefresh={() => void skillQuery.refetch()}
      onReadFile={(filePath) => {
        if (!buda) throw new Error("Not connected");
        return buda.client.skills.readFile({ nodeId, filePath });
      }}
      onCreateChangeRequest={(input) => {
        if (!buda) throw new Error("Not connected");
        return buda.client.skills.createChangeRequest({ nodeId, ...input });
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
