// Generic directed graph — dependency-free (no external package), used by
// formula/dependency.ts to order/validate `formula` field dependencies (see
// formula/SPEC.md). Not formula-specific in its own right, mirroring how
// bika's `algorithm/directed-graph.ts` is a generic utility that
// `field-directed-graph.ts` wraps for the field use case.
export class DirectedGraph<T> {
  private readonly adjacency = new Map<T, Set<T>>();

  addNode(node: T): void {
    if (!this.adjacency.has(node)) {
      this.adjacency.set(node, new Set());
    }
  }

  /** `from` must be processed before `to` (an edge from a dependency to its dependent). */
  addEdge(from: T, to: T): void {
    this.addNode(from);
    this.addNode(to);
    this.adjacency.get(from)?.add(to);
  }

  nodes(): T[] {
    return [...this.adjacency.keys()];
  }

  neighbors(node: T): T[] {
    return [...(this.adjacency.get(node) ?? [])];
  }

  /** Kahn's algorithm. Returns the nodes in dependency-first order, or `null` if a cycle exists. */
  topologicalSort(): T[] | null {
    const inDegree = new Map<T, number>();
    for (const node of this.nodes()) inDegree.set(node, 0);
    for (const node of this.nodes()) {
      for (const target of this.neighbors(node)) {
        inDegree.set(target, (inDegree.get(target) ?? 0) + 1);
      }
    }

    const queue: T[] = this.nodes().filter((node) => (inDegree.get(node) ?? 0) === 0);
    const order: T[] = [];
    while (queue.length > 0) {
      const node = queue.shift();
      if (node === undefined) break;
      order.push(node);
      for (const neighbor of this.neighbors(node)) {
        const degree = (inDegree.get(neighbor) ?? 0) - 1;
        inDegree.set(neighbor, degree);
        if (degree === 0) queue.push(neighbor);
      }
    }

    return order.length === this.nodes().length ? order : null;
  }

  /**
   * DFS-based cycle detection that also returns the cycle's own node path
   * (for error messages naming exactly which fields form the cycle), not
   * just a boolean. Returns `null` when the graph is acyclic.
   */
  findCycle(): T[] | null {
    const UNVISITED = 0;
    const IN_PROGRESS = 1;
    const DONE = 2;
    const state = new Map<T, number>();
    for (const node of this.nodes()) state.set(node, UNVISITED);

    let cycle: T[] | null = null;

    const visit = (start: T): void => {
      const path: T[] = [];

      const dfs = (node: T): boolean => {
        state.set(node, IN_PROGRESS);
        path.push(node);
        for (const neighbor of this.neighbors(node)) {
          if (state.get(neighbor) === IN_PROGRESS) {
            const cycleStart = path.indexOf(neighbor);
            cycle = [...path.slice(cycleStart), neighbor];
            return true;
          }
          if (state.get(neighbor) === UNVISITED && dfs(neighbor)) {
            return true;
          }
        }
        path.pop();
        state.set(node, DONE);
        return false;
      };

      dfs(start);
    };

    for (const node of this.nodes()) {
      if (cycle) break;
      if (state.get(node) === UNVISITED) {
        visit(node);
      }
    }

    return cycle;
  }
}
