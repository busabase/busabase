import { getRecordTitle } from "busabase-core/dashboard/change-request";
import { NativeRow, NativeSection } from "~/components/native-screen";
import { getPreview } from "~/domains/review/utils/busabase-display";
import { formatListTime } from "~/lib/format";
import type { BaseDetailController } from "../hooks/use-base-detail-controller";
import { recordCountCaption } from "../utils/record-pagination";

interface Props {
  records: BaseDetailController["records"];
  /** What the Base or View really holds; `null` when the server cannot say. */
  total?: number | null;
  onOpenRecord: (recordId: string) => void;
}

export function BaseRecordList({ records, total, onOpenRecord }: Props) {
  return (
    <NativeSection title="Records" caption={recordCountCaption(records.length, total)}>
      {records.map((record, index) => {
        const title = getRecordTitle(record);
        const preview = getPreview(record.headCommit.payload, {
          definitions: record.base?.fields,
        });
        const subtitle =
          preview.trim().toLowerCase() === title.trim().toLowerCase() ? undefined : preview;
        return (
          <NativeRow
            key={record.id}
            title={title}
            subtitle={subtitle}
            meta={formatListTime(record.updatedAt)}
            last={index === records.length - 1}
            onPress={() => onOpenRecord(record.id)}
          />
        );
      })}
    </NativeSection>
  );
}
