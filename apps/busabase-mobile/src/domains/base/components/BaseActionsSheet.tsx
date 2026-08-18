import { Settings2 } from "lucide-react-native";
import { NativeActionBar, NativeBottomSheet } from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { useTokens } from "~/theme/use-tokens";

interface Props {
  open: boolean;
  onClose: () => void;
  onEditDesign: () => void;
}

export function BaseActionsSheet({ open, onClose, onEditDesign }: Props) {
  const tokens = useTokens();
  return (
    <NativeBottomSheet
      visible={open}
      title="Base actions"
      showCloseButton
      onClose={onClose}
      footer={
        <NativeActionBar>
          <Button
            label="Edit base design"
            variant="secondary"
            fullWidth
            leadingIcon={<Settings2 size={18} color={tokens.foreground} />}
            onPress={onEditDesign}
          />
        </NativeActionBar>
      }
    />
  );
}
