/**
 * Shared HTTP client + step runner for the busabase OpenAPI demo scripts.
 * Each script imports these helpers and uses makeRunner() for isolated state.
 */

export const BASE = process.env.BUSABASE_URL ?? "http://localhost:15419";

export interface StepResult {
  label: string;
  passed: boolean;
  error?: string;
}

/**
 * A non-2xx response, carrying the parts a caller needs to tell failure modes apart.
 *
 * Scripts used to catch a bare `Error` and could only re-test by string-matching, so
 * they tended to `catch {}` and assume "already exists" — which turned a precise 422
 * into a phantom "missing after create failed". Keep `message` identical to the old
 * format so console output is unchanged; add `status` / `code` for the branches.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly body: string;

  constructor(method: string, path: string, status: number, body: string) {
    super(`${method} /api/v1${path} → HTTP ${status}\n  ${body}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
    try {
      this.code = (JSON.parse(body) as { code?: string }).code;
    } catch {
      this.code = undefined;
    }
  }
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new ApiError(method, path, res.status, text);
  }
  return res.json() as T;
}

export function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export interface NodeTreeVO {
  id: string;
  type: string;
  name: string;
  slug: string;
  children?: NodeTreeVO[];
}

/**
 * `GET /nodes` returns a nested tree (one root element with `children`), not
 * a flat list — a plain top-level `.find()` only ever sees the root and
 * silently returns `undefined` for every other folder. Search recursively.
 */
export function findFolderByName(nodes: NodeTreeVO[], name: string): NodeTreeVO | undefined {
  for (const node of nodes) {
    if (node.type === "folder" && node.name === name) {
      return node;
    }
    const found = findFolderByName(node.children ?? [], name);
    if (found) {
      return found;
    }
  }
  return undefined;
}

/** Approve + merge a change request. Returns the merge result. */
export async function approveMerge(crId: string) {
  await api("POST", "/change-requests/reviews", {
    changeRequestIds: [crId],
    verdict: "approved",
  });
  const merged = await api<{
    results: Array<
      | { ok: true; changeRequest: { id: string; status: string }; record: unknown; view: unknown }
      | { ok: false; error: string }
    >;
  }>("POST", "/change-requests/merge", { changeRequestIds: [crId] });
  const result = merged.results[0];
  if (!result?.ok) throw new Error(result?.error ?? "Change request merge returned no result");
  return result;
}

export function makeRunner(suiteName: string) {
  const results: StepResult[] = [];
  let stepNum = 0;

  async function step(label: string, fn: () => Promise<void>) {
    stepNum++;
    try {
      await fn();
      results.push({ label, passed: true });
      process.stdout.write(`  ✓ [${stepNum}] ${label}\n`);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      results.push({ label, passed: false, error });
      process.stderr.write(`  ✗ [${stepNum}] ${label}: ${error}\n`);
    }
  }

  function summary(): { pass: number; fail: number } {
    const pass = results.filter((r) => r.passed).length;
    const fail = results.filter((r) => !r.passed).length;
    const icon = fail === 0 ? "✅" : "❌";
    console.log(`\n${icon}  ${suiteName}: ${pass} passed, ${fail} failed\n`);
    if (fail > 0) {
      for (const r of results.filter((r) => !r.passed)) {
        process.stderr.write(`     ✗ ${r.label}: ${r.error}\n`);
      }
    }
    return { pass, fail };
  }

  return { step, summary, results };
}
