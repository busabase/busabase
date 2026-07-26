// Field-scoped wrapper around ../dependency-graph.ts's generic DirectedGraph,
// for `formula` fields specifically. See SPEC.md's "Dependency graph +
// chaining checklist". A minimal duck-typed `FormulaFieldLike` (not
// field-types.ts's real `FieldDef`) avoids a circular import — field-types.ts
// is what imports FROM this module, not the other way around.
import { DirectedGraph } from "../dependency-graph";
import { collectFieldRefs } from "./ast";
import { parseFormula } from "./parser";

export interface FormulaFieldLike {
  slug: string;
  type: string;
  options?: { formula?: { expression?: string } } | null;
}

/**
 * One node per field slug; one edge per `{slug}` reference a `formula`
 * field's expression makes, FROM the referenced field TO the formula field
 * (the referenced field must be computed first). Non-formula fields are
 * still added as nodes (with no incoming edges) so they sort first in
 * topological order, same as any value that's already known up front.
 */
export function buildFieldGraph(defs: ReadonlyArray<FormulaFieldLike>): DirectedGraph<string> {
  const graph = new DirectedGraph<string>();
  for (const def of defs) graph.addNode(def.slug);
  for (const def of defs) {
    if (def.type !== "formula") continue;
    const expression = def.options?.formula?.expression;
    if (!expression) continue;
    let refs: string[];
    try {
      refs = collectFieldRefs(parseFormula(expression));
    } catch {
      // Unparsable expression — field-ops.ts's own validation already
      // rejects this at field create/edit time; nothing to add here.
      continue;
    }
    for (const ref of refs) {
      graph.addEdge(ref, def.slug);
    }
  }
  return graph;
}

/** Every field slug involved in a cycle (self-reference is a 1-node cycle), or `null` if acyclic. */
export function detectFieldCycle(defs: ReadonlyArray<FormulaFieldLike>): string[] | null {
  return buildFieldGraph(defs).findCycle();
}

/** All field slugs in dependency-first order, or `null` if the graph has a cycle. */
export function topologicalFieldOrder(defs: ReadonlyArray<FormulaFieldLike>): string[] | null {
  return buildFieldGraph(defs).topologicalSort();
}
