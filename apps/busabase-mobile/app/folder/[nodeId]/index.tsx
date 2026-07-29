import { skipToken, useQuery } from "@tanstack/react-query";
import { getNodeType } from "busabase-contract/domains";
import type { NodeVO } from "busabase-contract/types";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Bot, FileText, Folder, HardDrive, Sparkles, Table2 } from "lucide-react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { DrawerScaffold } from "~/components/busabase/DrawerScaffold";
import {
  NativeEmptyState,
  NativeErrorState,
  NativeLoadingState,
  NativeRow,
  NativeSection,
} from "~/components/native-screen";
import { getMobileNodeDestination } from "~/search/node-navigation";
import { useTokens } from "~/theme/use-tokens";

type FolderChild = NodeVO;

const NODE_ICONS: Record<string, typeof Folder> = {
  bot: Bot,
  folder: Folder,
  "file-text": FileText,
  "hard-drive": HardDrive,
  sparkles: Sparkles,
  table: Table2,
};

function FolderDetailContent() {
  const params = useLocalSearchParams<{ nodeId?: string }>();
  const nodeId = typeof params.nodeId === "string" ? params.nodeId : "";
  const tokens = useTokens();
  const router = useRouter();
  const buda = useBusabaseOrpc();

  const folderQuery = useQuery(
    buda && nodeId
      ? buda.orpc.folders.get.queryOptions({ input: { nodeId } })
      : { queryKey: ["no-connection", "folder", nodeId], queryFn: skipToken },
  );
  const folder = folderQuery.data ?? null;

  const openChild = (child: FolderChild) => {
    const destination = getMobileNodeDestination(child);
    if (destination.status === "unsupported") return;
    router.push({ pathname: destination.pathname, params: destination.params } as never);
  };

  const getChildMeta = (child: FolderChild) => {
    const definition = getNodeType(child.type);
    return {
      Icon: NODE_ICONS[definition?.icon ?? ""] ?? FileText,
      label: definition?.label ?? child.type,
    };
  };

  return (
    <DrawerScaffold title={folder?.node.name ?? "Folder"}>
      {folderQuery.isLoading ? <NativeLoadingState label="Loading folder" /> : null}
      {folderQuery.error ? (
        <NativeErrorState
          message={folderQuery.error.message}
          onRetry={() => void folderQuery.refetch()}
        />
      ) : null}
      {!folderQuery.isLoading && !folderQuery.error && !folder ? (
        <NativeEmptyState description="This folder is not available." title="Folder not found" />
      ) : null}

      {folder ? (
        folder.children.length === 0 ? (
          <NativeEmptyState description="This folder has no items yet." title="Empty folder" />
        ) : (
          <NativeSection
            title={`${folder.children.length} ${folder.children.length === 1 ? "item" : "items"}`}
          >
            {folder.children.map((child, index) => {
              const { Icon, label } = getChildMeta(child);
              return (
                <NativeRow
                  key={child.id}
                  title={child.name}
                  meta={label}
                  leading={<Icon size={18} color={tokens.mutedForeground} />}
                  last={index === folder.children.length - 1}
                  onPress={() => openChild(child)}
                />
              );
            })}
          </NativeSection>
        )
      ) : null}
    </DrawerScaffold>
  );
}

export default function FolderDetailScreen() {
  return (
    <ConnectionGuard>
      <FolderDetailContent />
    </ConnectionGuard>
  );
}
