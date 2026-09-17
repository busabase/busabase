import { busabaseContract } from "busabase-contract/contract/busabase";

type Row = {
  path: string;
  method?: string;
  route?: string;
  tags?: string[];
  summary?: string;
};
const rows: Row[] = [];

function walk(node: unknown, prefix: string[]) {
  if (!node || typeof node !== "object") return;
  const def = (node as Record<string, any>)["~orpc"];
  if (def) {
    const r = def.route ?? {};
    rows.push({
      path: prefix.join("."),
      method: r.method,
      route: r.path,
      tags: r.tags,
      summary: r.summary,
    });
    return;
  }
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    walk(v, [...prefix, k]);
  }
}

walk(busabaseContract, []);
rows.sort((a, b) => a.path.localeCompare(b.path));
console.log(JSON.stringify(rows, null, 2));
console.error(`TOTAL ${rows.length}`);
