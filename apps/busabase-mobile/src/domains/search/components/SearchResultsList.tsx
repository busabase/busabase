import type { SearchResultVO } from "busabase-contract/types";
import { AppWindow, File, FileText, GitPullRequest, Search, Table2 } from "lucide-react-native";
import { NativeRow, NativeSection } from "~/components/native-screen";
import { nodeIconForType } from "~/domains/workspace/components/node-icons";
import type { KnownNode } from "~/domains/workspace/utils/known-node-cache";
import { useTokens } from "~/theme/use-tokens";
import type { SearchTab } from "../types/search";

const kindMeta: Record<SearchResultVO["kind"], { label: string; icon: typeof FileText }> = {
  record: { label: "Record", icon: FileText },
  change_request: { label: "Change request", icon: GitPullRequest },
  base: { label: "Base", icon: Table2 },
  file: { label: "File", icon: File },
};

const filePrefixMeta: Record<string, { label: string; icon: typeof FileText }> = {
  doc: { label: "Doc", icon: FileText },
  airapp: { label: "AirApp", icon: AppWindow },
};

const getResultMeta = (result: SearchResultVO) => {
  if (result.kind === "file") {
    const prefix = result.href.split("/").filter(Boolean)[0];
    const override = prefix ? filePrefixMeta[prefix] : undefined;
    if (override) return override;
  }
  return kindMeta[result.kind];
};

interface SearchResultsListProps {
  contentResults: SearchResultVO[];
  displayedError: string | null;
  hasQuery: boolean;
  recentResults: KnownNode[];
  searching: boolean;
  tab: SearchTab;
  onOpenKnownNode: (node: KnownNode) => void;
  onOpenResult: (result: SearchResultVO) => void;
}

export function SearchResultsList({
  contentResults,
  displayedError,
  hasQuery,
  recentResults,
  searching,
  tab,
  onOpenKnownNode,
  onOpenResult,
}: SearchResultsListProps) {
  const tokens = useTokens();
  const resultCount = tab === "recent" ? recentResults.length : contentResults.length;

  return (
    <NativeSection title={tab === "recent" ? undefined : hasQuery ? "Results" : undefined}>
      {searching && resultCount === 0 ? (
        <NativeRow
          title="Searching"
          leading={<Search size={18} color={tokens.mutedForeground} />}
          last
        />
      ) : null}
      {!searching && resultCount === 0 && !displayedError ? (
        <NativeRow
          title={tab === "recent" && !hasQuery ? "No recent nodes" : "No matches"}
          leading={<Search size={18} color={tokens.mutedForeground} />}
          last
        />
      ) : null}
      {tab === "recent"
        ? recentResults.map((node, index) => {
            const Icon = nodeIconForType(node.type);
            return (
              <NativeRow
                key={node.id}
                title={node.name}
                meta={node.slug}
                leading={<Icon size={18} color={tokens.mutedForeground} />}
                onPress={() => onOpenKnownNode(node)}
                last={index === recentResults.length - 1}
              />
            );
          })
        : contentResults.map((result, index) => {
            const meta = getResultMeta(result);
            const Icon = meta.icon;
            return (
              <NativeRow
                key={`${result.kind}-${result.id}`}
                title={result.title}
                meta={result.eyebrow || undefined}
                leading={<Icon size={18} color={tokens.mutedForeground} />}
                onPress={() => onOpenResult(result)}
                last={index === contentResults.length - 1}
              />
            );
          })}
    </NativeSection>
  );
}
