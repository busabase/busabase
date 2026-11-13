const titleSeparator = "|";

export interface DashboardDocumentTitleInput {
  baseName?: string | null;
  fallbackTitle: string;
  isBaseRoute: boolean;
  nodeActivityName?: string | null;
  nodeName?: string | null;
}

export const resolveDashboardDocumentTitle = ({
  baseName,
  fallbackTitle,
  isBaseRoute,
  nodeActivityName,
  nodeName,
}: DashboardDocumentTitleInput): string => {
  if (isBaseRoute && baseName) return baseName;
  return nodeName ?? nodeActivityName ?? fallbackTitle;
};

export const formatDashboardDocumentTitle = (pageTitle: string, currentTitle: string): string => {
  const separatorIndex = currentTitle.lastIndexOf(titleSeparator);
  if (separatorIndex < 0) return pageTitle;

  let suffixStart = separatorIndex;
  while (suffixStart > 0 && /\s/.test(currentTitle[suffixStart - 1] ?? "")) {
    suffixStart -= 1;
  }
  return `${pageTitle}${currentTitle.slice(suffixStart)}`;
};
