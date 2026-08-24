import { z } from "zod";

export const VolumeStatusSchema = z.enum([
  "pending_create",
  "ready",
  "error",
  "deleting",
  "deleted",
]);
export const VolumeStorageTypeSchema = z.enum(["ebs", "s3"]);

// ── Volume VO ──
export const VolumeVOSchema = z.object({
  id: z.string(),
  spaceId: z.string().nullable(),
  name: z.string(),
  status: VolumeStatusSchema,
  storageType: VolumeStorageTypeSchema,
  sizeBytes: z.number(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type VolumeVO = z.infer<typeof VolumeVOSchema>;

// ── DTOs ──
export const CreateVolumeInputSchema = z.object({
  name: z.string().min(1).max(255),
  storageType: VolumeStorageTypeSchema.optional(),
  spaceId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CreateVolumeInput = z.infer<typeof CreateVolumeInputSchema>;

// ── Result VOs ──
export const VolumeListResultSchema = z.object({ volumes: z.array(VolumeVOSchema) });
export type VolumeListResult = z.infer<typeof VolumeListResultSchema>;

export const VolumeDeleteResultSchema = z.object({ id: z.string(), deleted: z.boolean() });
export type VolumeDeleteResult = z.infer<typeof VolumeDeleteResultSchema>;

export const VolumeStatsSchema = z.object({
  total: z.number(),
  ready: z.number(),
  error: z.number(),
  totalSizeBytes: z.number(),
});
export type VolumeStats = z.infer<typeof VolumeStatsSchema>;

export const VolumeObjectSchema = z.object({
  id: z.string(),
  key: z.string(),
  type: z.enum(["file", "folder"]),
  size: z.number(),
  lastModified: z.string(),
});
export type VolumeObject = z.infer<typeof VolumeObjectSchema>;

export const VolumeFsListResultSchema = z.object({ objects: z.array(VolumeObjectSchema) });
export type VolumeFsListResult = z.infer<typeof VolumeFsListResultSchema>;

export const VolumeFsDeleteResultSchema = z.object({ path: z.string(), deleted: z.boolean() });
export type VolumeFsDeleteResult = z.infer<typeof VolumeFsDeleteResultSchema>;
