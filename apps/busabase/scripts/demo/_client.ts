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

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new Error(`${method} /api/v1${path} → HTTP ${res.status}\n  ${text}`);
  }
  return res.json() as T;
}

export function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Approve + merge a change request. Returns the merge result. */
export async function approveMerge(crId: string) {
  await api("POST", `/change-requests/${crId}/reviews`, { verdict: "approved" });
  return api<{ changeRequest: { id: string; status: string }; record: unknown; view: unknown }>(
    "POST",
    `/change-requests/${crId}/merge`,
    {},
  );
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
