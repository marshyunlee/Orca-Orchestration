import assert from "node:assert/strict";
import {test} from "node:test";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createBoardStore} from "../src/boardStore.js";
import {refreshNativeBoard} from "../src/nativeObservation.js";
import {createBoardNode} from "../../shared/board.js";
import type {OrcaTask} from "../src/orca.js";

test("late results update the current native attempt without rewriting an older stopped attempt",async()=>{
 const root=await mkdtemp(join(tmpdir(),"observe-")),store=await createBoardStore(root);
 try{
  let board=await store.create({title:"Fixture",members:[],coordinatorIdentity:""},"create");
  board=await store.update(board.id,board.revision,"setup",current=>{
   current.implementationRunId="run";current.nodes.push(createBoardNode("node","task","Task"));
   const attempt={nodeId:"node",nodeRevision:1,runId:"run",taskId:"task",assigneeHandle:"member",ownsProcess:false,workspacePath:"/fixture",promptPath:"prompt",resultPath:null,guidancePaths:[],dependencyAttemptIds:[]};
   current.attempts.push({...attempt,id:"old",dispatchId:"old-dispatch",nativeStatus:"failed",stopped:true},{...attempt,id:"new",dispatchId:"new-dispatch",nativeStatus:"completed",stopped:false});return current;
  });
  const native={listTasks:async()=>[{id:"task",status:"completed",result:"Verified output"} as OrcaTask],runOrca:async<T>()=>({messages:[]} as T)};
  await refreshNativeBoard(store,board.id,native);
  const after=await store.read(board.id);
  assert.equal(after.attempts[0].nativeStatus,"failed");assert.equal(after.attempts[0].resultPath,null);
  assert.equal(await store.readArtifact(board.id,after.attempts[1].resultPath!),"Verified output");
  await refreshNativeBoard(store,board.id,native);assert.equal((await store.read(board.id)).revision,after.revision);
 }finally{await store.close();await rm(root,{recursive:true,force:true});}
});
