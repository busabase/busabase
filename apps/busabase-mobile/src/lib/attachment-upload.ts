import type { createBusabaseORPCClient } from "busabase-contract/api-client/react-query";
import { completeAttachmentUpload } from "busabase-core/dashboard/attachment-upload";
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
        if (requested.uploadUrl.startsWith("/")) {
          // React Native FormData streams a URI part without loading it into JS.
          const form = new FormData();
          form.append("file", {
            uri: file.uri,
            name: file.name,
            type: mimeType,
          } as unknown as Blob);
          form.append("storageKey", requested.storageKey);
          const response = await fetch(resolveAttachmentUrl(serverUrl, requested.uploadUrl), {
            method: "POST",
            headers,
            body: form,
          });
          if (!response.ok) throw new Error(`Upload failed (${response.status})`);
          return;
        }

        const blob = await (await fetch(file.uri)).blob();
        const response = await fetch(requested.uploadUrl, {
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
