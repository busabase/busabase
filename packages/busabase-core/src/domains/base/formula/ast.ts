export type AstNode =
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "field_ref"; slug: string }
  | { kind: "unary"; op: "-" | "!"; operand: AstNode }
  | { kind: "binary"; op: string; left: AstNode; right: AstNode }
  | { kind: "call"; name: string; args: AstNode[] };

/** Every `{slug}` reference in the tree, deduped, in first-seen order. */
export function collectFieldRefs(node: AstNode, out: string[] = []): string[] {
  switch (node.kind) {
    case "field_ref":
      if (!out.includes(node.slug)) out.push(node.slug);
      return out;
    case "unary":
      return collectFieldRefs(node.operand, out);
    case "binary":
      collectFieldRefs(node.left, out);
      return collectFieldRefs(node.right, out);
    case "call":
      for (const arg of node.args) collectFieldRefs(arg, out);
      return out;
    default:
      return out;
  }
}
