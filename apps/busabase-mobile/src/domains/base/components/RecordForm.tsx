import type { BaseFieldVO } from "busabase-contract/types";
import { ChevronDown, ChevronUp } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { NativeRow } from "~/components/native-screen";
import { getAppNavigationLayout } from "~/domains/workspace/utils/responsive-layout";
import { useTokens } from "~/theme/use-tokens";
import {
  isCompactRecordFormField,
  isEditableField,
  type RecordFormValue,
} from "../utils/record-form";
import { RecordFieldRow } from "./RecordFieldRow";

interface RecordFormProps {
  fields: BaseFieldVO[];
  values: Record<string, RecordFormValue>;
  onChange: (slug: string, value: RecordFormValue) => void;
}

const INITIAL_FIELD_COUNT = 8;

export function RecordForm({ fields, values, onChange }: RecordFormProps) {
  const tokens = useTokens();
  const { width, height } = useWindowDimensions();
  const [expanded, setExpanded] = useState(false);
  const editableFields = fields.filter(isEditableField);
  const initialFields = editableFields.filter(
    (field, index) => index < INITIAL_FIELD_COUNT || field.required,
  );
  const hiddenCount = editableFields.length - initialFields.length;
  const visibleFields = expanded ? editableFields : initialFields;
  const navigationLayout = getAppNavigationLayout(width, height);
  const contentWidth = width - navigationLayout.sidebarWidth;
  const useRegularGrid = navigationLayout.persistentSidebar && contentWidth >= 640;
  let compactColumn = 0;
  const layoutFields = visibleFields.map((field) => {
    if (!useRegularGrid || !isCompactRecordFormField(field)) {
      compactColumn = 0;
      return { field, layout: useRegularGrid ? ("full" as const) : undefined };
    }

    const layout = compactColumn % 2 === 0 ? ("left" as const) : ("right" as const);
    compactColumn += 1;
    return { field, layout };
  });

  return (
    <View>
      <View style={useRegularGrid ? styles.fieldGrid : undefined}>
        {layoutFields.map(({ field, layout }, index) => (
          <RecordFieldRow
            key={field.id}
            field={field}
            value={values[field.slug] ?? ""}
            onChange={(next) => onChange(field.slug, next)}
            last={index === visibleFields.length - 1 && hiddenCount === 0}
            layout={layout}
          />
        ))}
      </View>
      {hiddenCount > 0 ? (
        <NativeRow
          title={expanded ? "Show fewer fields" : `Show ${hiddenCount} more fields`}
          leading={
            expanded ? (
              <ChevronUp size={18} color={tokens.mutedForeground} />
            ) : (
              <ChevronDown size={18} color={tokens.mutedForeground} />
            )
          }
          last
          onPress={() => setExpanded((current) => !current)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fieldGrid: { flexDirection: "row", flexWrap: "wrap" },
});
