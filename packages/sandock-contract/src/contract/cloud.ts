import { oc } from "@orpc/contract";
import { z } from "zod";
import {
  BrowserInfoSchema,
  PreviewUrlResultSchema,
  RevokePreviewTokenResultSchema,
  SignedPreviewUrlResultSchema,
} from "../types/cloud";
import { responseVO } from "../types/response";
import {
  CreateVolumeInputSchema,
  VolumeDeleteResultSchema,
  VolumeFsDeleteResultSchema,
  VolumeFsListResultSchema,
  VolumeListResultSchema,
  VolumeStatsSchema,
  VolumeStorageTypeSchema,
  VolumeVOSchema,
} from "../types/volume";
import { sandboxBaseContractRoutes } from "./sandbox";

const idParam = z.object({ id: z.string().min(1) });

/**
 * Cloud sandbox contract = the base contract PLUS sandock-only procedures (browser CDP/VNC,
 * preview URLs, volumes). Same shapes/paths/methods as sandock's current REST routes so the
 * OpenAPI doc + VO stay identical. Binary volume-fs get/put and the streaming/proxy endpoints are
 * NOT here — they remain raw handlers in sandock (documented via spec augmentation).
 */
export const sandboxCloudContractRoutes = {
  ...sandboxBaseContractRoutes,

  // ── Sandbox: browser + preview ──
  browser: oc
    .route({
      method: "GET",
      path: "/sandbox/{id}/browser",
      tags: ["sandbox"],
      summary: "Get browser info",
    })
    .input(idParam)
    .output(responseVO(BrowserInfoSchema)),

  previewUrl: oc
    .route({
      method: "GET",
      path: "/sandbox/{id}/preview-url",
      tags: ["sandbox"],
      summary: "Get a preview URL",
    })
    .input(idParam.extend({ port: z.coerce.number().int().min(1).max(65535) }))
    .output(responseVO(PreviewUrlResultSchema)),

  signedPreviewUrl: oc
    .route({
      method: "GET",
      path: "/sandbox/{id}/signed-preview-url",
      tags: ["sandbox"],
      summary: "Get a signed preview URL",
    })
    .input(
      idParam.extend({
        port: z.coerce.number().int().min(1).max(65535),
        expiresIn: z.coerce.number().int().min(60).max(86400).default(3600),
      }),
    )
    .output(responseVO(SignedPreviewUrlResultSchema)),

  revokePreviewToken: oc
    .route({
      method: "DELETE",
      path: "/sandbox/{id}/preview-token/{token}",
      tags: ["sandbox"],
      summary: "Revoke a preview token",
    })
    .input(z.object({ id: z.string().min(1), token: z.string().min(1) }))
    .output(responseVO(RevokePreviewTokenResultSchema)),

  // ── Volumes ──
  volumes: {
    list: oc
      .route({ method: "GET", path: "/volume", tags: ["volumes"], summary: "List volumes" })
      .output(responseVO(VolumeListResultSchema)),

    create: oc
      .route({ method: "POST", path: "/volume", tags: ["volumes"], summary: "Create a volume" })
      .input(CreateVolumeInputSchema)
      .output(responseVO(VolumeVOSchema)),

    stats: oc
      .route({
        method: "GET",
        path: "/volume/stats",
        tags: ["volumes"],
        summary: "Volume statistics",
      })
      .output(responseVO(VolumeStatsSchema)),

    getByName: oc
      .route({
        method: "GET",
        path: "/volume/name/{name}",
        tags: ["volumes"],
        summary: "Get volume by name",
      })
      .input(
        z.object({
          name: z.string().min(1),
          create: z.string().optional(),
          spaceId: z.string().optional(),
          storageType: VolumeStorageTypeSchema.optional(),
        }),
      )
      .output(responseVO(VolumeVOSchema)),

    get: oc
      .route({ method: "GET", path: "/volume/{id}", tags: ["volumes"], summary: "Get a volume" })
      .input(idParam)
      .output(responseVO(VolumeVOSchema)),

    delete: oc
      .route({
        method: "DELETE",
        path: "/volume/{id}",
        tags: ["volumes"],
        summary: "Delete a volume",
      })
      .input(idParam)
      .output(responseVO(VolumeDeleteResultSchema)),

    updateSize: oc
      .route({
        method: "PATCH",
        path: "/volume/{id}/size",
        tags: ["volumes"],
        summary: "Recompute volume size",
      })
      .input(idParam)
      .output(responseVO(VolumeVOSchema)),

    fsList: oc
      .route({
        method: "GET",
        path: "/volume/{id}/fs/list",
        tags: ["volume-fs"],
        summary: "List volume files",
      })
      .input(idParam.extend({ path: z.string().optional() }))
      .output(responseVO(VolumeFsListResultSchema)),

    // `inputStructure: "detailed"` so `path` stays a QUERY param on this DELETE (see the same note
    // on sandbox `removeFile` — compact mode would move it into the request body).
    fsDelete: oc
      .route({
        method: "DELETE",
        path: "/volume/{id}/fs/delete",
        tags: ["volume-fs"],
        summary: "Delete a volume file/directory",
        inputStructure: "detailed",
      })
      .input(
        z.object({
          params: z.object({ id: z.string().min(1) }),
          query: z.object({ path: z.string().min(1) }),
        }),
      )
      .output(responseVO(VolumeFsDeleteResultSchema)),
  },
};

export const sandboxCloudContract = oc.prefix("/api/v1").router(sandboxCloudContractRoutes);
export type SandboxCloudContract = typeof sandboxCloudContract;
