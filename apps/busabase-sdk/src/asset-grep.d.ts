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
export declare const toUnifiedFilesGrepInput: (input: GrepInputDTO) => UnifiedGrepInputDTO;
export declare const toFilesOnlyGrepResult: (result: UnifiedGrepResultVO) => GrepResultVO;
/** Call unified grep as files-only while preserving the former asset helper result shape. */
export declare const grepAssets: (
  client: Pick<BusabaseClient, "grep">,
  input: GrepInputDTO,
) => Promise<GrepResultVO>;
