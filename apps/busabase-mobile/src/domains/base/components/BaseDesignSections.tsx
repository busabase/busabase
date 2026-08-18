import { Plus } from "lucide-react-native";
import { iStringParse } from "openlib/i18n/i-string";
import { NativeRow, NativeSection } from "~/components/native-screen";
import { useTokens } from "~/theme/use-tokens";
import type { BaseDesignController } from "../hooks/use-base-design-controller";
import { getFieldTypeLabel } from "../utils/field-type-label";

export function BaseDesignSections({ controller }: { controller: BaseDesignController }) {
  const tokens = useTokens();
  const { base } = controller;
  if (!base) return null;

  return (
    <>
      <NativeSection title="Fields" caption={`${base.fields.length}`}>
        {base.fields.map((field) => (
          <NativeRow
            key={field.id}
            title={iStringParse(field.name)}
            subtitle={getFieldTypeLabel(field.type)}
            meta={field.required ? "Required" : undefined}
          />
        ))}
        <NativeRow
          title="Add field"
          leading={<Plus size={18} color={tokens.mutedForeground} />}
          onPress={controller.openFieldSheet}
          last
        />
      </NativeSection>

      <NativeSection title="Views" caption={`${controller.viewsQuery.data?.length ?? 0}`}>
        {(controller.viewsQuery.data ?? []).map((view) => (
          <NativeRow
            key={view.id}
            title={view.name}
            onPress={() => controller.requestViewDelete(view)}
          />
        ))}
        <NativeRow
          title="New view"
          leading={<Plus size={18} color={tokens.mutedForeground} />}
          onPress={controller.openViewSheet}
          last
        />
      </NativeSection>
    </>
  );
}
