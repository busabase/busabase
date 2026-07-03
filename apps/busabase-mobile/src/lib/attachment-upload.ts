import type { createBusabaseORPCClient } from "busabase-contract/api-client/react-query";
import type { AttachmentRef } from "busabase-contract/types";
import { resolveAttachmentUrl } from "./attachment";

type BusabaseClient = ReturnType<typeof createBusabaseORPCClient>;

export interface PickedFile {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
}

/**
 * Upload a picked file for an `attachment` field, mirroring the web hook:
 * request URL → push bytes (dev route POST or presigned PUT) → confirm → return
 * the inline ref stored in the record's field value. `serverUrl` is needed to
 * absolutize the dev-route upload URL the self-hosted server returns.
 */
export async function uploadAttachment(
  client: BusabaseClient,
  serverUrl: string,
  file: PickedFile,
  headers: Record<string, string> = {},
): Promise<AttachmentRef> {
  const mimeType = file.mimeType || "application/octet-stream";
  const requested = await client.attachments.createUploadUrl({
    fileName: file.name,
    mimeType,
    sizeBytes: file.size,
    context: "record-field",
  });

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

  const confirmed = await client.attachments.confirm({
    storageKey: requested.storageKey,
    fileName: file.name,
    mimeType,
    sizeBytes: file.size,
    context: "record-field",
  });
  return {
    id: confirmed.attachmentId,
    url: confirmed.publicUrl,
    fileName: file.name,
    mimeType,
    size: file.size,
  };
}
