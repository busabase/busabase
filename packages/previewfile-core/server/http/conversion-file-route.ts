/**
 * GET /api/convert/pdf-file/<key> — serves converted PDF/HTML files from local
 * conversion storage, as a route handler factory:
 *
 *   export const { GET } = createConversionFileRoute();
 *
 * This is the base_url target when conversion storage resolves to a local://
 * backend (see ../converter/conversion-storage), so LocalStorage's presigned
 * URLs come back as same-origin paths here.
 *
 * Same-origin means:
 *  - No CORS headers needed
 *  - No expiry (unlike S3/R2 presigned URLs)
 *  - Content-addressed keys (SHA-256 hash) → safe to cache forever
 *
 * When conversion storage is S3/R2 this route is never called — the converter
 * returns a presigned URL directly.
 *
 * Security:
 *  - Only serves files inside the `conversions/` subdirectory, traversal included
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { mimeTypeForFileName } from "../../utils/file-types";
import {
  getLocalConversionRootDir,
  STAGED_CONVERSION_SOURCE_PREFIX,
} from "../converter/conversion-storage";

export function createConversionFileRoute(): {
  GET: (request: Request, context: { params: Promise<{ key: string[] }> }) => Promise<Response>;
} {
  const GET = async (
    _request: Request,
    { params }: { params: Promise<{ key: string[] }> },
  ): Promise<Response> => {
    const { key: keySegments } = await params;

    if (!keySegments?.length) {
      return Response.json({ error: "Missing key" }, { status: 400 });
    }

    const rootDir = getLocalConversionRootDir();
    if (!rootDir) {
      return Response.json(
        { error: "Not available: conversion storage is remote" },
        { status: 404 },
      );
    }

    const key = keySegments.join("/");

    // Only serve files under the conversions/ subdir
    if (!key.startsWith("conversions/")) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const filePath = path.resolve(rootDir, key);

    // Reject path traversal. The bound is conversions/, not the storage root:
    // the root can be shared with other files (BUDA_DRIVE_URL falls back to the
    // Drive's own local storage), and `conversions/../<path>` would reach them.
    if (!filePath.startsWith(path.resolve(rootDir, "conversions") + path.sep)) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    const relativeKey = path.relative(path.resolve(rootDir), filePath).split(path.sep).join("/");
    const isStagedSource = relativeKey.startsWith(STAGED_CONVERSION_SOURCE_PREFIX);
    if (isStagedSource) {
      const name = relativeKey.slice(STAGED_CONVERSION_SOURCE_PREFIX.length);
      const match = /^(\d{13})-[a-f0-9-]{36}(?:\.[a-z0-9]{1,10})?$/.exec(name);
      if (!match || Number(match[1]) <= Date.now()) {
        return Response.json({ error: "Not found" }, { status: 404 });
      }
    }

    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) {
        return Response.json({ error: "Not found" }, { status: 404 });
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = isStagedSource
        ? (mimeTypeForFileName(filePath) ?? "application/octet-stream")
        : ext === ".html"
          ? "text/html"
          : "application/pdf";
      const fileBuffer = await fs.readFile(filePath);

      return new Response(fileBuffer, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(fileBuffer.length),
          // Keys are SHA-256 content-addressed → immutable, safe to cache long-term
          "Cache-Control": isStagedSource
            ? "private, no-store"
            : "public, max-age=86400, immutable",
          "Content-Disposition": "inline",
        },
      });
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return Response.json({ error: "Not found" }, { status: 404 });
      }
      console.error("[api/convert/pdf-file] error:", err);
      return Response.json({ error: "Internal server error" }, { status: 500 });
    }
  };

  return { GET };
}
