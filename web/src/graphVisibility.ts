import type { DagResponse, Gate } from "./types";

export function isGateUnresolved(gate: Gate): boolean {
  return gate.status === "pending" || gate.status === "open" || !gate.resolution;
}

/** Retain the original dependency context of active work and pending decisions. */
export function selectVisibleGraph(dag: DagResponse, showCompleted: boolean): DagResponse {
  if (showCompleted) return dag;
  const known = new Set(dag.nodes.map(node => node.id));
  const visible = new Set(dag.nodes.filter(node => node.status !== "completed").map(node => node.id));
  for (const gate of dag.gates) {
    if (gate.taskId && known.has(gate.taskId) && isGateUnresolved(gate)) visible.add(gate.taskId);
  }
  const parents = new Map<string, string[]>();
  for (const edge of dag.edges) {
    if (!known.has(edge.source) || !known.has(edge.target)) continue;
    const ancestors = parents.get(edge.target) ?? [];
    ancestors.push(edge.source);
    parents.set(edge.target, ancestors);
  }
  const queue = [...visible];
  for (let index = 0; index < queue.length; index += 1) {
    for (const parent of parents.get(queue[index]) ?? []) {
      if (visible.has(parent)) continue;
      visible.add(parent);
      queue.push(parent);
    }
  }
  return { ...dag, nodes: dag.nodes.filter(node => visible.has(node.id)),
    edges: dag.edges.filter(edge => visible.has(edge.source) && visible.has(edge.target)) };
}
