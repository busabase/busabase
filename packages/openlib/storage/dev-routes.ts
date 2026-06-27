import { storage } from "./factory";
import type { IStorage } from "./types";

/**
 * Shared factories for the per-app dev-only storage route handlers
 * (`/api/dev/upload` and `/api/dev/attachment/[...key]`).
 *
 * These are framework-agnostic: they use the standard web `Request`/`Response`
 * types and native `fetch`, so `openlib` does NOT depend on `next` or `axios`.
 * Next.js App-Router route handlers accept exactly this shape:
 *
 *   (req: Request, ctx: { params: Promise<...> }) => Response
 */

const isProduction = () => process.env.NODE_ENV === "production";

const notAvailableInProduction = () => new Response("Not available in production", { status: 404 });

/**
 * Extension → MIME map used by the storage-adapter download branch.
 * This is the UNION of the maps that previously lived inline in
 * busabase / busabase-cloud / buda / inpomo / productready.
 */
const MIME_TYPES: Record<string, string> = {
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  md: "text/markdown",
  pdf: "application/pdf",
  png: "image/png",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  svg: "image/svg+xml",
  txt: "text/plain",
  webp: "image/webp",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  zip: "application/zip",
};

const CACHE_CONTROL = "public, max-age=31536000, immutable";

export interface CreateDevUploadRouteOptions {
  /**
   * Gate the route behind a production check (returns 404 in production).
   * @default true
   */
  gateProduction?: boolean;
  /**
   * Choose which storage adapter to write to based on the submitted form.
   * @default () => storage  (the openlib singleton)
   */
  resolveStorage?: (form: FormData) => IStorage;
}

/**
 * Build the POST handler for `/api/dev/upload`.
 *
 * Development-only server-side upload relay: the client sends the file, the
 * server writes it to the configured storage adapter. Avoids presigned-URL
 * signature / CORS issues.
 */
export function createDevUploadRoute(opts?: CreateDevUploadRouteOptions): {
  POST: (req: Request) => Promise<Response>;
} {
  const gateProduction = opts?.gateProduction ?? true;

  const POST = async (req: Request): Promise<Response> => {
    if (gateProduction && isProduction()) {
      return notAvailableInProduction();
    }

    try {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      const storageKey = formData.get("storageKey") as string | null;

      if (!file || !storageKey) {
        return new Response("Missing file or storageKey", { status: 400 });
      }

      const buffer = Buffer.from(await file.arrayBuffer());

      const targetStorage = opts?.resolveStorage?.(formData) ?? storage;
      await targetStorage.uploadFileToKey(buffer, storageKey, file.type);

      console.log("[Dev Upload] Uploaded:", storageKey);

      return Response.json({ success: true });
    } catch (error) {
      console.error("[Dev Upload] Error:", error);
      return new Response(error instanceof Error ? error.message : "Upload failed", {
        status: 500,
      });
    }
  };

  return { POST };
}

export interface CreateDevAttachmentRouteOptions {
  /**
   * Gate the route behind a production check (returns 404 in production).
   * @default true
   */
  gateProduction?: boolean;
}

/**
 * Build the GET handler for `/api/dev/attachment/[...key]`.
 *
 * Two download strategies, selected at request time by the presence of
 * `STORAGE_PUBLIC_BASE_URL`:
 *
 * - **Public-base-URL proxy** (when set): fetch `${base}/${key}` over the
 *   network and stream the upstream body + `content-type` back. Mirrors the
 *   former axios-based apps (mcpsdk / previewfile / sandock / tabcy-web /
 *   toolsdk.ai), using native `fetch` instead of axios.
 * - **Storage adapter** (when unset): `storage.getObject(key)` and infer the
 *   `Content-Type` from the file extension. Mirrors the former
 *   `storage.getObject` apps (busabase / busabase-cloud / buda / inpomo /
 *   productready).
 */
export function createDevAttachmentRoute(opts?: CreateDevAttachmentRouteOptions): {
  GET: (req: Request, ctx: { params: Promise<{ key: string[] }> }) => Promise<Response>;
} {
  const gateProduction = opts?.gateProduction ?? true;

  const GET = async (
    _req: Request,
    { params }: { params: Promise<{ key: string[] }> },
  ): Promise<Response> => {
    if (gateProduction && isProduction()) {
      return notAvailableInProduction();
    }

    try {
      const { key: keyParts } = await params;

      if (!keyParts || keyParts.length === 0) {
        return new Response("Key is required", { status: 400 });
      }

      const key = keyParts.join("/");
      const publicBaseUrl = process.env.STORAGE_PUBLIC_BASE_URL;

      if (publicBaseUrl) {
        // Public-base-URL proxy branch (formerly axios).
        const url = `${publicBaseUrl.replace(/\/$/, "")}/${key}`;
        console.log("[Dev Attachment] Fetching:", url);

        const response = await fetch(url);

        if (!response.ok) {
          console.error("[Dev Attachment] Not found:", url);
          return new Response("File not found", { status: 404 });
        }

        return new Response(response.body, {
          headers: {
            "Content-Type": response.headers.get("content-type") || "application/octet-stream",
            "Cache-Control": CACHE_CONTROL,
          },
        });
      }

      // Storage-adapter branch (formerly storage.getObject).
      console.log("[Dev Attachment] Fetching:", key);

      let fileBuffer: Buffer;
      try {
        fileBuffer = await storage.getObject(key);
      } catch {
        console.error("[Dev Attachment] Not found:", key);
        return new Response("File not found", { status: 404 });
      }

      const ext = key.split(".").pop()?.toLowerCase();
      const contentType = (ext && MIME_TYPES[ext]) || "application/octet-stream";

      return new Response(new Uint8Array(fileBuffer), {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": CACHE_CONTROL,
        },
      });
    } catch (error) {
      console.error("[Dev Attachment] Error:", error);
      return new Response(error instanceof Error ? error.message : "Error fetching file", {
        status: 500,
      });
    }
  };

  return { GET };
}
