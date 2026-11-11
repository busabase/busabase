import type { AssetAttachmentRef } from "busabase-contract/types";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { useConnection } from "~/connection/connection-store";
import { type PickedFile, uploadAttachment } from "~/lib/attachment-upload";

interface UseAttachmentFieldOptions {
  maxFiles?: number;
  refs: AssetAttachmentRef[];
  onChange: (refs: AssetAttachmentRef[]) => void;
  /**
   * Where a freshly uploaded ref lands among the refs that stay. An `attachment`
   * cell appends it; a `drive` cell files it into the folder being viewed. Both
   * editors share this one hook so picking, uploading and the `maxFiles` rule
   * cannot drift apart between the two field types.
   */
  placeUploaded?: (
    kept: AssetAttachmentRef[],
    uploaded: AssetAttachmentRef,
  ) => AssetAttachmentRef[];
}

const appendUploaded = (kept: AssetAttachmentRef[], uploaded: AssetAttachmentRef) => [
  ...kept,
  uploaded,
];

export function useAttachmentField({
  maxFiles,
  refs,
  onChange,
  placeUploaded = appendUploaded,
}: UseAttachmentFieldOptions) {
  const buda = useBusabaseOrpc();
  const { getCloudAuthorizationHeaders, state } = useConnection();
  const serverUrl = state.status === "connected" ? state.connection.serverUrl : null;
  const connectionMode = state.status === "connected" ? state.connection.mode : null;
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedRef, setSelectedRef] = useState<AssetAttachmentRef | null>(null);

  const upload = async (file: PickedFile) => {
    if (!buda || !serverUrl) {
      setError("Not connected");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const headers = connectionMode === "cloud" ? await getCloudAuthorizationHeaders() : {};
      const ref = await uploadAttachment(buda.client, serverUrl, file, headers);
      // A single-file field swaps its file instead of growing past the limit.
      onChange(placeUploaded(maxFiles === 1 ? [] : refs, ref));
      setPickerOpen(false);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.9,
    });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    await upload({
      uri: asset.uri,
      name: asset.fileName ?? `image-${asset.assetId ?? "upload"}.jpg`,
      mimeType: asset.mimeType ?? "image/jpeg",
      size: asset.fileSize ?? 0,
    });
  };

  const pickDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    await upload({
      uri: asset.uri,
      name: asset.name,
      mimeType: asset.mimeType ?? "application/octet-stream",
      size: asset.size ?? 0,
    });
  };

  const removeSelected = () => {
    if (selectedRef) {
      onChange(refs.filter((item) => item.id !== selectedRef.id));
    }
    setSelectedRef(null);
  };

  return {
    atLimit: typeof maxFiles === "number" && maxFiles > 0 && refs.length >= maxFiles,
    error,
    pickerOpen,
    selectedRef,
    serverUrl,
    uploading,
    pickDocument,
    pickImage,
    removeSelected,
    setError,
    setPickerOpen,
    setSelectedRef,
  };
}
