import { oc } from "@orpc/contract";
import { z } from "zod";
import { responseVO } from "../types/response";
import {
  CreateSandboxInputSchema,
  CreateSandboxResultSchema,
  DeleteResultSchema,
  ExecutionResultSchema,
  ListFilesResultSchema,
  PauseResultSchema,
  ReadFileResultSchema,
  ResumeResultSchema,
  RunCodeInputSchema,
  SandboxListResultSchema,
  ShellInputSchema,
  StartResultSchema,
  StopResultSchema,
  WriteFileInputSchema,
} from "../types/sandbox";

const idParam = z.object({ id: z.string().min(1) });

/**
 * Base sandbox contract — lifecycle + exec + filesystem. Transport-neutral, tenant-agnostic.
 * Served as-is by `apps/sandock` (single-tenant) and reused (wrapped with auth) by
 * `apps/sandock-cloud`'s cloud contract. Paths + methods mirror sandock's existing REST routes 1:1;
 * `oc.prefix("/api/v1")` supplies the base path. Every response uses the shared `{success,code,
 * message,data}` envelope (`responseVO`).
 */
export const sandboxBaseContractRoutes = {
  create: oc
    .route({ method: "POST", path: "/sandbox", tags: ["sandbox"], summary: "Create a sandbox" })
    .input(CreateSandboxInputSchema)
    .output(responseVO(CreateSandboxResultSchema)),

  list: oc
    .route({ method: "GET", path: "/sandbox", tags: ["sandbox"], summary: "List sandboxes" })
    .output(responseVO(SandboxListResultSchema)),

  start: oc
    .route({
      method: "POST",
      path: "/sandbox/{id}/start",
      tags: ["sandbox"],
      summary: "Start a sandbox",
    })
    .input(idParam)
    .output(responseVO(StartResultSchema)),

  stop: oc
    .route({
      method: "POST",
      path: "/sandbox/{id}/stop",
      tags: ["sandbox"],
      summary: "Stop a sandbox",
    })
    .input(idParam)
    .output(responseVO(StopResultSchema)),

  pause: oc
    .route({
      method: "POST",
      path: "/sandbox/{id}/pause",
      tags: ["sandbox"],
      summary: "Pause a sandbox",
    })
    .input(idParam)
    .output(responseVO(PauseResultSchema)),

  resume: oc
    .route({
      method: "POST",
      path: "/sandbox/{id}/resume",
      tags: ["sandbox"],
      summary: "Resume a sandbox",
    })
    .input(idParam)
    .output(responseVO(ResumeResultSchema)),

  delete: oc
    .route({
      method: "DELETE",
      path: "/sandbox/{id}",
      tags: ["sandbox"],
      summary: "Delete a sandbox",
    })
    .input(idParam)
    .output(responseVO(DeleteResultSchema)),

  runCode: oc
    .route({
      method: "POST",
      path: "/sandbox/{id}/code",
      tags: ["sandbox"],
      summary: "Run code in a sandbox",
    })
    .input(idParam.extend(RunCodeInputSchema.shape))
    .output(responseVO(ExecutionResultSchema)),

  shell: oc
    .route({
      method: "POST",
      path: "/sandbox/{id}/shell",
      tags: ["sandbox"],
      summary: "Run a shell command",
    })
    .input(idParam.extend(ShellInputSchema.shape))
    .output(responseVO(ExecutionResultSchema)),

  writeFile: oc
    .route({
      method: "POST",
      path: "/sandbox/{id}/fs/write",
      tags: ["sandbox"],
      summary: "Write a file",
    })
    .input(idParam.extend(WriteFileInputSchema.shape))
    .output(responseVO(z.boolean())),

  readFile: oc
    .route({
      method: "GET",
      path: "/sandbox/{id}/fs/read",
      tags: ["sandbox"],
      summary: "Read a file",
    })
    .input(idParam.extend({ path: z.string().min(1) }))
    .output(responseVO(ReadFileResultSchema)),

  listFiles: oc
    .route({
      method: "GET",
      path: "/sandbox/{id}/fs/list",
      tags: ["sandbox"],
      summary: "List directory entries",
    })
    .input(idParam.extend({ path: z.string().optional() }))
    .output(responseVO(ListFilesResultSchema)),

  // `inputStructure: "detailed"` so `path` stays a QUERY param on this DELETE. oRPC's default
  // (compact) mode puts a DELETE's non-path fields in the request BODY, which would silently move
  // `path` from `?path=` (the pre-oRPC Hono behavior) into a JSON body and break existing clients.
  removeFile: oc
    .route({
      method: "DELETE",
      path: "/sandbox/{id}/fs",
      tags: ["sandbox"],
      summary: "Remove a file or directory",
      inputStructure: "detailed",
    })
    .input(
      z.object({
        params: z.object({ id: z.string().min(1) }),
        query: z.object({ path: z.string().min(1) }),
      }),
    )
    .output(responseVO(z.boolean())),
};

export const sandboxBaseContract = oc.prefix("/api/v1").router(sandboxBaseContractRoutes);
export type SandboxBaseContract = typeof sandboxBaseContract;
