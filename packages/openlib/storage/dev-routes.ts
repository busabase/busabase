import { storage } from "./factory";
import { invalidStorageKeyResponse, isSafeStorageKey } from "./storage-key";
import type { IStorage } from "./types";

/**
 * Shared factories for the per-app storage route handlers, named for their
 * usual mount points (`/api/dev/upload` and `/api/dev/attachment/[...key]`)
 * where they are gated to development by default. The handlers themselves are
 * transport-generic and can also back a real production route on a non-dev
 * path — see `gateProduction` below.
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
 * This is the UNION of the maps that previously lived inline in each
 * consuming app.
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
   *
   * Anything mounted under `/api/dev/` MUST keep the default: that path prefix
   * means "development only, 404 in production", with no exceptions. This
   * option exists solely for mounting the factory on a NON-dev path — the
   * handler itself is transport-generic, so an app that genuinely serves
   * local-disk storage in production can reuse it at a real route (e.g.
   * `apps/busabase/src/app/api/storage/upload`) instead of reimplementing it.
   *
   * Note the gate is not what keeps a traversal key (`../../etc/passwd`) from
   * reaching `path.join(rootDir, key)` — `./storage-key` is, and these handlers
   * apply it on every request, gated or not. That used to be the caller's job,
   * documented right here; of the two apps that dropped the gate, one did it and
   * one did not, which is how one of them ended up serving an unauthenticated
   * arbitrary-path write in production.
   *
   * @default true
   */
  gateProduction?: boolean;
  /**
   * Choose which storage adapter to write to. Routing hints arrive from the
   * multipart form (POST) or the query string (PUT) — the raw-PUT client only
   * has the URL to carry them in.
   * @default () => storage  (the openlib singleton)
   */
  resolveStorage?: (source: { form?: FormData; params?: URLSearchParams }) => IStorage;
}

/**
 * Build the `/api/dev/upload` handlers.
 *
 * Development-only server-side upload relay: the server writes the received
 * bytes to the configured storage adapter, avoiding presigned-URL signature /
 * CORS issues. Two request shapes, both writing to the same place:
 *
 * - **PUT** (canonical): the raw bytes as the body, `?key=` in the URL — the
 *   exact shape a client uses for an S3 presigned URL, so the client never
 *   knows it's talking to a dev relay.
 * - **POST** (legacy): a `multipart/form-data` body with `file` + `storageKey`.
 */
export function createDevUploadRoute(opts?: CreateDevUploadRouteOptions): {
  POST: (req: Request) => Promise<Response>;
  PUT: (req: Request) => Promise<Response>;
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
      if (!isSafeStorageKey(storageKey)) {
        return invalidStorageKeyResponse();
      }

      const buffer = Buffer.from(await file.arrayBuffer());

      const targetStorage = opts?.resolveStorage?.({ form: formData }) ?? storage;
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

  // Mirror of an S3 presigned PUT: raw bytes in the body, everything the server
  // needs (storage key + storage routing) carried in the query string — because
  // the URL is all the client has. Lets one client path serve S3 and local.
  const PUT = async (req: Request): Promise<Response> => {
    if (gateProduction && isProduction()) {
      return notAvailableInProduction();
    }

    try {
      const params = new URL(req.url).searchParams;
      const key = params.get("key");

      if (!key) {
        return new Response("Missing key", { status: 400 });
      }
      if (!isSafeStorageKey(key)) {
        return invalidStorageKeyResponse();
      }

      const mimeType = req.headers.get("content-type") || "application/octet-stream";
      const buffer = Buffer.from(await req.arrayBuffer());

      const targetStorage = opts?.resolveStorage?.({ params }) ?? storage;
      await targetStorage.uploadFileToKey(buffer, key, mimeType);

      console.log("[Dev Upload] Uploaded:", key);

      return Response.json({ success: true });
    } catch (error) {
      console.error("[Dev Upload] Error:", error);
      return new Response(error instanceof Error ? error.message : "Upload failed", {
        status: 500,
      });
    }
  };

  return { POST, PUT };
}

export interface CreateDevAttachmentRouteOptions {
  /**
   * Gate the route behind a production check (returns 404 in production).
   *
   * Anything mounted under `/api/dev/` MUST keep the default: that path prefix
   * means "development only, 404 in production", with no exceptions. This
   * option exists solely for mounting the factory on a NON-dev path — the
   * handler itself is transport-generic, so an app that genuinely serves
   * local-disk storage in production can reuse it at a real route (e.g.
   * `apps/busabase/src/app/api/storage/[...key]`) instead of reimplementing it.
   *
   * Note the gate is not what keeps a traversal key (`../../etc/passwd`) from
   * reaching `path.join(rootDir, key)` — `./storage-key` is, and these handlers
   * apply it on every request, gated or not. That used to be the caller's job,
   * documented right here; of the two apps that dropped the gate, one did it and
   * one did not, which is how one of them ended up serving an unauthenticated
   * arbitrary-path write in production.
   *
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
 *   `storage.getObject` apps.
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
      if (!isSafeStorageKey(key)) {
        return invalidStorageKeyResponse();
      }
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
