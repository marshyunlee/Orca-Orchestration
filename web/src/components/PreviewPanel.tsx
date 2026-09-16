import type { BoardNode } from "../../../shared/board.js";
export function PreviewPanel({node,onUpdate}:{node:BoardNode;onUpdate:()=>void}) {
  return <section><h3>Expected deliverable</h3><p>Examples, behavior, and acceptance criteria before execution.</p><div className="preserve-lines">{node.content.design || "The coordinator has not generated a Preview yet."}</div><button onClick={onUpdate}>Update preview</button></section>;
}
