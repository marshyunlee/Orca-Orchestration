import { createHash } from "node:crypto";
import type { BoardNode, BoardEdge, BoardSnapshot } from "../../shared/board.js";
import { validateAssignment, validateContent } from "../../shared/board.js";

export function validateGraph(nodes: BoardNode[], edges: BoardEdge[]): void {
  if (!Array.isArray(nodes) || !Array.isArray(edges)) throw new Error("Invalid graph");
  const ids = new Set<string>();
  for (const node of nodes) {
    if (!node || typeof node.id !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(node.id) || ids.has(node.id)) throw new Error("Invalid or duplicate node ID");
    ids.add(node.id);
    if (!["run", "task", "preview"].includes(node.kind) || typeof node.title !== "string" || typeof node.removed !== "boolean" || !Number.isInteger(node.revision) || node.revision < 1) throw new Error("Invalid node");
    if (!Number.isFinite(node.position?.x) || !Number.isFinite(node.position?.y)) throw new Error("Invalid position");
    validateContent(node.content); validateAssignment(node.assignment);
  }
  const active = new Map(nodes.filter(node => !node.removed).map(node => [node.id, node]));
  if ([...active.values()].filter(node => node.kind === "run").length !== 1) throw new Error("Exactly one Run root required");
  if ([...active.values()].filter(node => node.kind === "preview").length > 1) throw new Error("Only one Preview allowed");
  const edgeIds = new Set<string>();
  for (const edge of edges) {
    if (!edge || typeof edge.id !== "string" || edgeIds.has(edge.id)) throw new Error("Invalid or duplicate edge ID");
    edgeIds.add(edge.id);
    if (!active.has(edge.source) || !active.has(edge.target)) throw new Error(`Edge ${edge.id} has a missing endpoint`);
    if (active.get(edge.target)?.kind === "run" || active.get(edge.source)?.kind === "preview") throw new Error("Run must be a root and Preview an endpoint");
  }
  const visiting = new Set<string>(), visited = new Set<string>();
  function visit(id: string): void {
    if (visiting.has(id)) throw new Error(`Dependency cycle at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const edge of edges.filter(edge => edge.source === id)) visit(edge.target);
    visiting.delete(id); visited.add(id);
  }
  for (const id of active.keys()) visit(id);
}
export function findDownstream(nodeId: string, edges: BoardEdge[]): string[] {
  const found = new Set<string>(), pending = [nodeId];
  while (pending.length) {
    const current = pending.shift();
    for (const edge of edges.filter(edge => edge.source === current)) {
      if (edge.target !== nodeId && !found.has(edge.target)) { found.add(edge.target); pending.push(edge.target); }
    }
  }
  return [...found];
}
export function digestValue(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function digestSpec(board: BoardSnapshot): string { return digestValue(board.nodes.find(node => node.kind === "run")!.content); }
export function digestExecutableBoard(board: BoardSnapshot): string {
  const nodes = board.nodes.filter(node => !node.removed && node.kind !== "preview").map(({ id, kind, title, content, assignment }) => ({ id, kind, title, content, assignment })).sort((a,b)=>a.id.localeCompare(b.id));
  const ids = new Set(nodes.map(node => node.id));
  const edges = board.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target)).map(({source,target})=>({source,target})).sort((a,b)=>`${a.source}/${a.target}`.localeCompare(`${b.source}/${b.target}`));
  return digestValue({nodes, edges});
}

export function digestNodeInput(board: BoardSnapshot, nodeId: string): string {
  const node=board.nodes.find(node=>node.id===nodeId)!;
  return digestValue({id:node.id,title:node.title,content:node.content,assignment:node.assignment,dependencies:board.edges.filter(edge=>edge.target===nodeId).map(edge=>edge.source).sort()});
}
