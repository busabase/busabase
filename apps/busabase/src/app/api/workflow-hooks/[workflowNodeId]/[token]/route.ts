/**
 * A workflow's incoming webhook. Anyone with the URL can start a run, which is
 * why the URL carries a long random token; no session or API key is involved.
 * This app has one local user, so runs act as them.
 */
import { runWithLocalContext } from "busabase-core/context";
import { getDb } from "busabase-core/db";
import {
  receiveWorkflowHook,
  respondToWorkflowHook,
} from "busabase-core/domains/workflow/run-service";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ workflowNodeId: string; token: string }> };

const handle = async (request: Request, { params }: Context): Promise<Response> =>
  respondToWorkflowHook(request, await params, async (args) =>
    receiveWorkflowHook({
      ...args,
      db: await getDb(),
      runAs: (_actor, fn) => runWithLocalContext({}, fn),
    }),
  );

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
