import assert from "node:assert/strict";
import { test } from "node:test";
import { createBoardViewState, reduceBoardView } from "../src/boardState.js";
import { createBoardSnapshot } from "../../shared/board.js";

test("late tab responses and save acknowledgements preserve newer drafts and selection",()=>{
  let state=createBoardViewState();
  state=reduceBoardView(state,{type:"select",boardId:"second"});
  state=reduceBoardView(state,{type:"edit-draft",boardId:"second",nodeId:"run",section:"prompt",value:"new draft"});
  state=reduceBoardView(state,{type:"load-started",boardId:"first",requestSequence:2});
  state=reduceBoardView(state,{type:"load-succeeded",boardId:"first",requestSequence:1,snapshot:createBoardSnapshot("first","Stale",[],"")});
  assert.equal(state.snapshotsById.first,undefined);
  state=reduceBoardView(state,{type:"load-succeeded",boardId:"first",requestSequence:2,snapshot:createBoardSnapshot("first","First",[],"")});
  assert.equal(state.selectedBoardId,"second");
  assert.equal(state.drafts["second/run/prompt"],"new draft");
  state=reduceBoardView(state,{type:"save-succeeded",boardId:"second",snapshot:createBoardSnapshot("second","Second",[],""),savedDrafts:{"second/run/prompt":"older draft"}});
  assert.equal(state.drafts["second/run/prompt"],"new draft");
  state=reduceBoardView(state,{type:"save-conflicted",boardId:"second",error:"Revision conflict"});
  assert.equal(state.drafts["second/run/prompt"],"new draft");
  assert.equal(state.errors.second,"Revision conflict");
});
