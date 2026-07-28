import { skipToken, useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { FileTreeScreen } from "~/components/busabase/FileTreeScreen";

function DriveDetailContent() {
  const params = useLocalSearchParams<{ nodeId?: string }>();
  const nodeId = typeof params.nodeId === "string" ? params.nodeId : "";
  const router = useRouter();
  const buda = useBusabaseOrpc();

  const driveQuery = useQuery(
    buda && nodeId
      ? buda.orpc.fileTrees.get.queryOptions({ input: { nodeId, type: "drive" } })
      : { queryKey: ["no-connection", "drive", nodeId], queryFn: skipToken },
  );

  return (
    <FileTreeScreen
      title="Drive"
      entityLabel="Drive"
      fileTree={driveQuery.data ?? null}
      loading={driveQuery.isLoading}
      error={driveQuery.error ?? null}
      refreshing={driveQuery.isRefetching}
      onRefresh={() => void driveQuery.refetch()}
      onReadFile={(filePath) => {
        if (!buda) throw new Error("Not connected");
        return buda.client.fileTrees.readFile({ type: "drive", nodeId, filePath });
      }}
      onCreateChangeRequest={(input) => {
        if (!buda) throw new Error("Not connected");
        return buda.client.fileTrees.createChangeRequest({ type: "drive", nodeId, ...input });
      }}
      onChangeRequestCreated={(changeRequestId) =>
        router.push({ pathname: "/change-requests/[id]", params: { id: changeRequestId } })
      }
    />
  );
}

export default function DriveDetailScreen() {
  return (
    <ConnectionGuard>
      <DriveDetailContent />
    </ConnectionGuard>
  );
}
