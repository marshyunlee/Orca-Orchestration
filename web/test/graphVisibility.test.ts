import assert from "node:assert/strict";
import test from "node:test";
import { selectVisibleGraph } from "../src/graphVisibility";
import type { DagResponse, DagNode, TaskStatus } from "../src/types";

function makeNode(id: string, status: TaskStatus): DagNode {
  return { id, label: id, status, spec: "contract", result: null,
    createdAt: "", completedAt: null, dispatchId: null, assigneeHandle: null };
}
function makeGraph(): DagResponse {
  return { runId: "run_example", generatedAt: 1, gates: [],
    nodes: [makeNode("a", "completed"), makeNode("b", "completed"),
      makeNode("c", "ready"), makeNode("d", "completed")],
    edges: [{ id: "ab", source: "a", target: "b" }, { id: "bc", source: "b", target: "c" }] };
}
test("active work retains its completed ancestors and original edges", () => {
  const graph = makeGraph();
  const visible = selectVisibleGraph(graph, false);
  assert.deepEqual(visible.nodes.map(node => node.id), ["a", "b", "c"]);
  assert.deepEqual(visible.edges.map(edge => edge.id), ["ab", "bc"]);
  assert.equal(graph.nodes.length, 4);
  assert.deepEqual(selectVisibleGraph(graph, true), graph);
});
test("failed and blocked work remain visible", () => {
  const graph = makeGraph();
  graph.nodes[2].status = "failed";
  graph.nodes[3].status = "blocked";
  assert.equal(selectVisibleGraph(graph, false).nodes.length, 4);
});
test("completed and empty graphs have no active work", () => {
  const graph = makeGraph();
  graph.nodes[2].status = "completed";
  assert.deepEqual(selectVisibleGraph(graph, false).nodes, []);
  assert.deepEqual(selectVisibleGraph(graph, false).edges, []);
  assert.deepEqual(selectVisibleGraph({ ...graph, nodes: [], edges: [] }, false).nodes, []);
});
test("an unresolved decision retains its completed task and dependency context", () => {
  const graph = makeGraph();
  graph.nodes[2].status = "completed";
  graph.gates = [{ id: "gate", taskId: "b", question: "Ship?", options: ["yes", "no"], status: "pending", resolution: null }];
  assert.deepEqual(selectVisibleGraph(graph, false).nodes.map(node => node.id), ["a", "b"]);
  graph.gates[0].status = "resolved";
  graph.gates[0].resolution = "yes";
  assert.deepEqual(selectVisibleGraph(graph, false).nodes, []);
});
test("malformed cycles terminate and missing endpoints are excluded", () => {
  const graph = makeGraph();
  graph.edges.push({ id: "ca", source: "c", target: "a" }, { id: "missing", source: "absent", target: "c" });
  const visible = selectVisibleGraph(graph, false);
  assert.deepEqual(visible.nodes.map(node => node.id), ["a", "b", "c"]);
  assert.deepEqual(visible.edges.map(edge => edge.id), ["ab", "bc", "ca"]);
});
