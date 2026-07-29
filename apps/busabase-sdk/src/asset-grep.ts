import type {
  UnifiedGrepInputDTO,
  UnifiedGrepResultVO,
} from "busabase-contract/contract/grep-schemas";
import type { GrepInputDTO, GrepResultVO } from "busabase-contract/domains/assets/types";
import type { BusabaseClient } from "./client.js";

/** The SDK keeps the familiar files-only helper without keeping a second HTTP operation. */
export type BusabaseAssetsClient = BusabaseClient["assets"] & {
  grep(input: GrepInputDTO): Promise<GrepResultVO>;
};

export const toUnifiedFilesGrepInput = (input: GrepInputDTO): UnifiedGrepInputDTO => ({
  pattern: input.pattern,
  flags: input.flags,
  sources: ["files"],
  scope: input.scope ? { files: input.scope } : undefined,
  maxMatches: input.maxMatches,
  contextLines: input.contextLines,
});

export const toFilesOnlyGrepResult = (result: UnifiedGrepResultVO): GrepResultVO => ({
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
});

/** Call unified grep as files-only while preserving the former asset helper result shape. */
export const grepAssets = async (
  client: Pick<BusabaseClient, "grep">,
  input: GrepInputDTO,
): Promise<GrepResultVO> =>
  toFilesOnlyGrepResult(await client.grep(toUnifiedFilesGrepInput(input)));
