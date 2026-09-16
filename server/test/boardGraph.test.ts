import assert from "node:assert/strict";
import { test } from "node:test";
import { validateGraph, findDownstream, digestExecutableBoard } from "../src/boardGraph.js";
import { createBoardSnapshot, createBoardNode } from "../../shared/board.js";

test("graph rejects cycles and missing endpoints while positions leave executable digest unchanged", () => {
  const board = createBoardSnapshot("board", "Fixture", [], "");
  board.nodes.push(createBoardNode("task-one", "task", "One"), createBoardNode("task-two", "task", "Two"));
  board.edges = [{id:"a", source:board.nodes[0].id, target:"task-one"}, {id:"b", source:"task-one", target:"task-two"}];
  validateGraph(board.nodes, board.edges);
  assert.deepEqual(findDownstream("task-one",board.edges), ["task-two"]);
  assert.throws(() => validateGraph(board.nodes,[...board.edges,{id:"cycle",source:"task-two",target:"task-one"}]), /cycle/);
  assert.throws(() => validateGraph(board.nodes,[{id:"missing",source:"absent",target:"task-one"}]), /missing/);
  assert.throws(() => validateGraph([...board.nodes,board.nodes[1]],board.edges), /duplicate/);
  const digest=digestExecutableBoard(board);
  board.nodes[1].position.x=900;
  assert.equal(digestExecutableBoard(board),digest);
  board.edges.pop();
  assert.notEqual(digestExecutableBoard(board),digest);
});
