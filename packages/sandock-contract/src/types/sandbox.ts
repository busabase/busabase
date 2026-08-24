import { z } from "zod";

// ── Volume mount input (pure zod; kept here so the contract has zero server deps) ──
export const VolumeMountInputSchema = z.object({
  volumeId: z.string(),
  mountPath: z.string(),
  subpath: z.string().optional(),
});
export type VolumeMountInput = z.infer<typeof VolumeMountInputSchema>;

// ── Create sandbox (DTO) ──
export const CreateSandboxInputSchema = z
  .object({
    spaceId: z.string().min(1).optional(),
    clusterId: z.string().min(1).optional(),
    title: z.string().min(1).max(255).optional(),
    image: z.string().min(1).optional(),
    pythonImage: z.string().min(1).optional(),
    pull: z.boolean().optional(),
    memoryLimitMb: z.number().int().positive().optional(),
    cpuShares: z.number().int().positive().optional(),
    persistenceEnabled: z.boolean().optional(),
    workdir: z.string().optional(),
    keep: z.boolean().optional(),
    activeDeadlineSeconds: z.number().int().positive().max(86400).default(1800).optional(),
    command: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    volumes: z.array(VolumeMountInputSchema).optional(),
    autoDeleteInterval: z.number().int().min(-1).optional(),
  })
  .partial();
export type CreateSandboxInput = z.infer<typeof CreateSandboxInputSchema>;

// ── Lifecycle result VOs ──
export const CreateSandboxResultSchema = z.object({ id: z.string() });
export type CreateSandboxResult = z.infer<typeof CreateSandboxResultSchema>;

export const StartResultSchema = z.object({ id: z.string(), started: z.boolean() });
export type StartResult = z.infer<typeof StartResultSchema>;

export const StopResultSchema = z.object({ id: z.string(), stopped: z.boolean() });
export type StopResult = z.infer<typeof StopResultSchema>;

export const DeleteResultSchema = z.object({ id: z.string(), deleted: z.boolean() });
export type DeleteResult = z.infer<typeof DeleteResultSchema>;

export const PauseResultSchema = z.object({
  id: z.string(),
  status: z.string(),
  paused: z.boolean(),
});
export type PauseResult = z.infer<typeof PauseResultSchema>;

export const ResumeResultSchema = z.object({
  id: z.string(),
  status: z.string(),
  resumed: z.boolean(),
});
export type ResumeResult = z.infer<typeof ResumeResultSchema>;

// ── List sandboxes VO (runtime returns { id, status } per item) ──
export const SandboxListItemSchema = z.object({ id: z.string(), status: z.string() });
export type SandboxListItem = z.infer<typeof SandboxListItemSchema>;

export const SandboxListResultSchema = z.object({ items: z.array(SandboxListItemSchema) });
export type SandboxListResult = z.infer<typeof SandboxListResultSchema>;

// ── Execution (code + shell) ──
export const ExecutionResultSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().nullable(),
  timedOut: z.boolean(),
  durationMs: z.number(),
});
export type ExecutionResult = z.infer<typeof ExecutionResultSchema>;

export const RunCodeInputSchema = z.object({
  language: z.enum(["javascript", "typescript", "python"]),
  code: z.string(),
  timeoutMs: z.number().int().positive().optional(),
  input: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
});
export type RunCodeInput = z.infer<typeof RunCodeInputSchema>;

export const ShellInputSchema = z.object({
  cmd: z.union([z.string(), z.array(z.string())]),
  timeoutMs: z.number().int().positive().optional(),
  workdir: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  input: z.string().optional(),
});
export type ShellInput = z.infer<typeof ShellInputSchema>;

// ── Filesystem ──
export const WriteFileInputSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  executable: z.boolean().optional(),
});
export type WriteFileInput = z.infer<typeof WriteFileInputSchema>;

export const ReadFileResultSchema = z.object({ path: z.string(), content: z.string() });
export type ReadFileResult = z.infer<typeof ReadFileResultSchema>;

export const ListFilesResultSchema = z.object({
  path: z.string().default("."),
  entries: z.array(z.string()),
});
export type ListFilesResult = z.infer<typeof ListFilesResultSchema>;
