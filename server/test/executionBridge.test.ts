import assert from "node:assert/strict";
import {test} from "node:test";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createBoardStore} from "../src/boardStore.js";
import {createExecutionBridge} from "../src/executionBridge.js";
import {createBoardNode} from "../../shared/board.js";
import {digestSpec,digestExecutableBoard,digestNodeInput} from "../src/boardGraph.js";

test("pause fences new admissions while admitted inputs and exact dependency attempts remain immutable",async()=>{
 const root=await mkdtemp(join(tmpdir(),"bridge-")),store=await createBoardStore(root),bridge=createExecutionBridge(store);
 try{
  let board=await store.create({title:"Fixture",members:[],coordinatorIdentity:""},"create");
  board=await store.update(board.id,1,"setup",current=>{
   const first=createBoardNode("one","task","One"),second=createBoardNode("two","task","Two");
   first.assignment=second.assignment={kind:"new-worker",agent:"codex",workspacePath:"/fixture"};
   first.content.prompt="Original input";current.nodes.push(first,second);
   current.edges=[{id:"root",source:current.nodes[0].id,target:"one"},{id:"dependency",source:"one",target:"two"}];
   current.specApproval={nodeRevision:1,digest:digestSpec(current)};current.acceptedGraphDigest=digestExecutableBoard(current);
   current.acceptedNodeDigests=Object.fromEntries([first,second].map(node=>[node.id,digestNodeInput(current,node.id)]));
   current.implementationRunId="run";current.pauseNewStarts=false;return current;
  });
  await assert.rejects(bridge.admitLaunch(board.id,"two",1,"early"),/predecessor/);
  const permit=await bridge.admitLaunch(board.id,"one",1,"launch");
  await bridge.pauseStarts(board.id,[],"pause");
  assert.equal((await store.read(board.id)).attempts.length,1);
  assert.match(await store.readArtifact(board.id,permit.promptPath),/Original input/);
  await assert.rejects(bridge.admitLaunch(board.id,"two",1,"after-pause"),/paused/);
  const operation=await bridge.beginOperation(board.id,"launch");
  assert.equal(operation.operation.kind,"create-task");
  await assert.rejects(bridge.beginOperation(board.id,"launch"),/already admitted/);
  await bridge.recordNativeReceipt(board.id,"launch",operation.token,{phase:"unknown",requestId:null,stage:null,runId:null,taskId:null,dispatchId:null,liveness:null,raw:"lost output",error:"timeout"});
  await assert.rejects(bridge.beginOperation(board.id,"launch"),/reconcil/i);
  assert.equal((await store.read(board.id)).attempts[0].nativeStatus,"unknown");
 }finally{await store.close();await rm(root,{recursive:true,force:true});}
});
