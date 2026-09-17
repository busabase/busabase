import { busabaseContract } from "busabase-contract/contract/busabase";
import { z } from "zod";

/**
 * For every procedure whose input carries an `operation` (or `kind`)
 * discriminator, list the values the endpoint accepts. Endpoint-level coverage
 * ("is this procedure called from the UI?") hides operation-level gaps — e.g.
 * `bases.fieldChangeRequest` IS called from the dashboard, but only with
 * `create` / `update(name)` / `reorder` / `restore`, never `delete` or `convert`.
 */
const out: Array<{ path: string; discriminators: Record<string, string[]> }> = [];

const collectEnums = (json: unknown, acc: Record<string, Set<string>>, key?: string) => {
  if (!json || typeof json !== "object") return;
  const node = json as Record<string, any>;
  if (key && Array.isArray(node.enum)) {
    acc[key] ??= new Set();
    for (const v of node.enum) acc[key].add(String(v));
  }
  if (key && node.const !== undefined) {
    acc[key] ??= new Set();
    acc[key].add(String(node.const));
  }
  if (node.properties) {
    for (const [k, v] of Object.entries(node.properties)) collectEnums(v, acc, k);
  }
  for (const branchKey of ["anyOf", "oneOf", "allOf"]) {
    if (Array.isArray(node[branchKey])) for (const b of node[branchKey]) collectEnums(b, acc, key);
  }
  if (node.items) collectEnums(node.items, acc, key);
  if (node.$defs) for (const v of Object.values(node.$defs)) collectEnums(v, acc, undefined);
};

const walk = (node: unknown, prefix: string[]) => {
  if (!node || typeof node !== "object") return;
  const def = (node as Record<string, any>)["~orpc"];
  if (def) {
    const schema = def.inputSchema;
    if (schema) {
      try {
        const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
        const acc: Record<string, Set<string>> = {};
        collectEnums(json, acc);
        const interesting: Record<string, string[]> = {};
        for (const k of ["operation", "kind", "verdict", "status", "deleteMode"]) {
          if (acc[k]) interesting[k] = [...acc[k]].sort();
        }
        if (Object.keys(interesting).length > 0) {
          out.push({ path: prefix.join("."), discriminators: interesting });
        }
      } catch {
        // schema not representable as JSON Schema — skip
      }
    }
    return;
  }
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) walk(v, [...prefix, k]);
};

walk(busabaseContract, []);
out.sort((a, b) => a.path.localeCompare(b.path));
console.log(JSON.stringify(out, null, 2));
console.error(`TOTAL ${out.length}`);
