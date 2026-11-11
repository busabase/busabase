import type { createBusabaseORPCClient } from "busabase-contract/api-client/react-query";
import { completeAttachmentUpload } from "busabase-core/dashboard/attachment-upload";
import { File, UploadTask, UploadType } from "expo-file-system";
import { Platform } from "react-native";
import { resolveAttachmentUrl } from "./attachment";

type BusabaseClient = ReturnType<typeof createBusabaseORPCClient>;

export interface PickedFile {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
}

/**
 * React Native byte-transfer adapter for the shared attachment upload flow.
 * `serverUrl` absolutizes the dev-route upload URL returned by self-hosted servers.
 */
export async function uploadAttachment(
  client: BusabaseClient,
  serverUrl: string,
  file: PickedFile,
  headers: Record<string, string> = {},
) {
  const mimeType = file.mimeType || "application/octet-stream";
  return completeAttachmentUpload(
    {
      fileName: file.name,
      mimeType,
      sizeBytes: file.size,
      context: "record-field",
    },
    {
      createUploadUrl: (input) => client.assets.createUploadUrl(input),
      uploadBytes: async (requested) => {
        const localUpload = requested.uploadUrl.startsWith("/");
        const uploadUrl = localUpload
          ? resolveAttachmentUrl(serverUrl, requested.uploadUrl)
          : requested.uploadUrl;

        if (Platform.OS !== "web") {
          // SDK 56's fetch rejects RN's legacy { uri, name, type } FormData
          // parts. A native upload task streams the file without copying its
          // bytes into a JS Blob or an in-memory multipart buffer.
          const task = new UploadTask(
            new File(file.uri),
            uploadUrl,
            localUpload
              ? {
                  httpMethod: "POST",
                  uploadType: UploadType.MULTIPART,
                  fieldName: "file",
                  mimeType,
                  parameters: { storageKey: requested.storageKey },
                  headers,
                }
              : {
                  httpMethod: "PUT",
                  uploadType: UploadType.BINARY_CONTENT,
                  headers: { "content-type": mimeType },
                },
          );
          try {
            const response = await task.uploadAsync();
            if (response.status < 200 || response.status >= 300) {
              throw new Error(`Upload failed (${response.status})`);
            }
          } finally {
            task.release();
          }
          return;
        }

        const source = await fetch(file.uri);
        if (!source.ok) throw new Error(`Could not read selected file (${source.status})`);
        const blob = await source.blob();
        if (localUpload) {
          const form = new FormData();
          form.append("file", blob, file.name);
          form.append("storageKey", requested.storageKey);
          const response = await fetch(uploadUrl, {
            method: "POST",
            headers,
            body: form,
          });
          if (!response.ok) throw new Error(`Upload failed (${response.status})`);
          return;
        }

        const response = await fetch(uploadUrl, {
          method: "PUT",
          body: blob,
          headers: { "content-type": mimeType },
        });
        if (!response.ok) throw new Error(`Upload failed (${response.status})`);
      },
      confirmUpload: (input) => client.assets.confirm(input),
    },
  );
}
