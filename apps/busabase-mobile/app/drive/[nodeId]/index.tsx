import { skipToken, useQuery } from "@tanstack/react-query";
import { asNodeDetail } from "busabase-core/dashboard/node-detail";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { FileTreeScreen } from "~/domains/knowledge/components/FileTreeScreen";
import { ConnectionGuard } from "~/domains/workspace/components/ConnectionGuard";

function DriveDetailContent() {
  const params = useLocalSearchParams<{ nodeId?: string }>();
  const nodeId = typeof params.nodeId === "string" ? params.nodeId : "";
  const router = useRouter();
  const buda = useBusabaseOrpc();

  const driveQuery = useQuery(
    buda && nodeId
      ? buda.orpc.nodes.get.queryOptions({ input: { nodeId, type: "drive" } })
      : { queryKey: ["no-connection", "drive", nodeId], queryFn: skipToken },
  );
  // `nodes.get` answers for every node type; narrowing to `drive` means a slug
  // that resolved to some other type renders FileTreeScreen's not-found state
  // instead of an empty file list wearing this Drive's chrome.
  const drive = asNodeDetail(driveQuery.data, "drive");

  return (
    <FileTreeScreen
      title="Drive"
      entityLabel="Drive"
      fileTree={drive}
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
        // The screen promises "the file changes only after review and merge" and then
        // navigates to the ChangeRequest, so review is not optional here.
        return buda.client.fileTrees.createChangeRequest({
          type: "drive",
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

export default function DriveDetailScreen() {
  return (
    <ConnectionGuard>
      <DriveDetailContent />
    </ConnectionGuard>
  );
}
