interface HastNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

/** rehype transform: replace `[n]` text with `<cite data-cite="n">` elements so a custom
 *  react-markdown component can render an inline citation marker. No dependencies. */
export function rehypeCitations() {
  return (tree: HastNode) => walk(tree);
}

function walk(node: HastNode): void {
  if (!node.children) return;
  const out: HastNode[] = [];
  for (const child of node.children) {
    if (child.type === "text" && child.value && /\[\d+\]/.test(child.value)) {
      for (const part of child.value.split(/(\[\d+\])/)) {
        if (!part) continue;
        const m = part.match(/^\[(\d+)\]$/);
        if (m) out.push({ type: "element", tagName: "cite", properties: { "data-cite": m[1] }, children: [] });
        else out.push({ type: "text", value: part });
      }
    } else {
      // Don't rewrite [n] inside code/pre — a citation marker there would be wrong.
      if (child.tagName !== "code" && child.tagName !== "pre") walk(child);
      out.push(child);
    }
  }
  node.children = out;
}
