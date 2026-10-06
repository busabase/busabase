import { useRouter } from "expo-router";
import {
  CircleDot,
  FileText,
  GitCommitHorizontal,
  GitPullRequest,
  ListChecks,
  ShieldCheck,
} from "lucide-react-native";
import { NativeRow } from "~/components/native-screen";
import { formatListDateTime } from "~/lib/format";
import { useTokens } from "~/theme/use-tokens";
import type { ActivityEvent, ActivityTone } from "../types/activity-events";

const toneIcons: Record<ActivityTone, typeof GitPullRequest> = {
  audit: ShieldCheck,
  change_request: GitPullRequest,
  operation: ListChecks,
  commit: GitCommitHorizontal,
  record: FileText,
};

/** One activity event, opening whatever it points at. */
export function ActivityEventRow({ event, last }: { event: ActivityEvent; last: boolean }) {
  const router = useRouter();
  const tokens = useTokens();
  const Icon = toneIcons[event.tone] ?? CircleDot;

  const open = () => {
    if (event.target.kind === "change-request") {
      router.push({ pathname: "/change-requests/[id]", params: { id: event.target.id } });
    } else if (event.target.kind === "operation") {
      router.push({
        pathname: "/change-requests/[id]/operations/[operationId]",
        params: { id: event.target.changeRequestId, operationId: event.target.operationId },
      });
    } else if (event.target.kind === "record") {
      router.push({ pathname: "/records/[id]", params: { id: event.target.id } });
    }
  };

  return (
    <NativeRow
      title={event.title}
      subtitle={formatListDateTime(event.timestamp)}
      leading={<Icon size={18} color={tokens.mutedForeground} />}
      onPress={event.target.kind === "none" ? undefined : open}
      last={last}
    />
  );
}
