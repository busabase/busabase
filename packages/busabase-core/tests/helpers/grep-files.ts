import type {
  UnifiedGrepInputDTO,
  UnifiedGrepResultVO,
} from "busabase-contract/contract/grep-schemas";
import type { GrepInputDTO, GrepResultVO } from "busabase-contract/domains/assets/types";

interface UnifiedGrepClient {
  grep(input: UnifiedGrepInputDTO): Promise<UnifiedGrepResultVO>;
}

/** Exercise the public unified route while keeping older files-scanner assertions readable. */
export const grepFiles = async (
  client: UnifiedGrepClient,
  input: GrepInputDTO,
): Promise<GrepResultVO> => {
  const result = await client.grep({
    pattern: input.pattern,
    flags: input.flags,
    sources: ["files"],
    scope: input.scope ? { files: input.scope } : undefined,
    maxMatches: input.maxMatches,
    contextLines: input.contextLines,
  });

  return {
    matches: result.matches.flatMap((match) => {
      if (match.source !== "files") return [];
      const { source: _source, ...fileMatch } = match;
      return [fileMatch];
    }),
    filesScanned: result.coverage.files.scanned,
    missing: result.coverage.files.missing,
    stale: result.coverage.files.stale,
    unsearchable: result.coverage.files.unsearchable,
    errored: result.coverage.files.errored,
    notReached: result.coverage.files.notReached,
    truncated: result.truncated,
  };
};
