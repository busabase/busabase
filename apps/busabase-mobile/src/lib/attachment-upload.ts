import type { createBusabaseORPCClient } from "busabase-contract/api-client/react-query";
import type { AssetAttachmentRef } from "busabase-contract/types";
import { resolveAttachmentUrl } from "./attachment";

type BusabaseClient = ReturnType<typeof createBusabaseORPCClient>;

export interface PickedFile {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
}

/**
 * Upload a picked file for a Base file field, mirroring the web hook:
 * request asset URL → push bytes (dev route POST or presigned PUT) → confirm
 * → return the asset-backed inline ref stored in the record. `serverUrl` is needed to
 * absolutize the dev-route upload URL the self-hosted server returns.
 */
export async function uploadAttachment(
  client: BusabaseClient,
  serverUrl: string,
  file: PickedFile,
  headers: Record<string, string> = {},
): Promise<AssetAttachmentRef> {
  const mimeType = file.mimeType || "application/octet-stream";
  const requested = await client.assets.createUploadUrl({
    fileName: file.name,
    mimeType,
    sizeBytes: file.size,
    context: "record-field",
  });
  if (requested.duplicate && requested.attachmentId) {
    return {
      id: requested.assetId ?? requested.attachmentId,
      assetId: requested.assetId,
      attachmentId: requested.attachmentId,
      url: requested.publicUrl,
      fileName: file.name,
      mimeType,
      size: file.size,
    };
  }

  if (requested.uploadUrl.startsWith("/")) {
    // Dev storage route: multipart POST. React Native's FormData accepts a
    // { uri, name, type } part and streams the file without loading it into JS.
    const form = new FormData();
    form.append("file", { uri: file.uri, name: file.name, type: mimeType } as unknown as Blob);
    form.append("storageKey", requested.storageKey);
    const response = await fetch(resolveAttachmentUrl(serverUrl, requested.uploadUrl), {
      method: "POST",
      headers,
      body: form,
    });
    if (!response.ok) {
      throw new Error(`Upload failed (${response.status})`);
    }
  } else {
    // Presigned PUT: stream the raw bytes.
    const blob = await (await fetch(file.uri)).blob();
    const response = await fetch(requested.uploadUrl, {
      method: "PUT",
      body: blob,
      headers: { "content-type": mimeType },
    });
    if (!response.ok) {
      throw new Error(`Upload failed (${response.status})`);
    }
  }

  const confirmed = await client.assets.confirm({
    storageKey: requested.storageKey,
    fileName: file.name,
    mimeType,
    sizeBytes: file.size,
    context: "record-field",
  });
  return {
    id: confirmed.assetId ?? confirmed.attachmentId,
    assetId: confirmed.assetId,
    attachmentId: confirmed.attachmentId,
    url: confirmed.publicUrl,
    fileName: file.name,
    mimeType,
    size: file.size,
  };
}
