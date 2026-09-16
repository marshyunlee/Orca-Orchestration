import assert from "node:assert/strict";
import {test} from "node:test";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createBoardStore} from "../src/boardStore.js";
import {applyBoardEdit} from "../src/boardRoutes.js";
import {createBoardNode} from "../../shared/board.js";
import {createActionExecutor} from "../src/interventions.js";

test("running edits preserve attempt input and pause transitive dependents; unknown stop cannot authorize replacement",async()=>{
 const root=await mkdtemp(join(tmpdir(),"intervention-")),store=await createBoardStore(root),executor=createActionExecutor(store);
 try{
  let board=await store.create({title:"Fixture",members:[],coordinatorIdentity:""},"create");
  board=await store.update(board.id,1,"setup",current=>{
   current.nodes.push(...["one","two","three","other"].map(id=>createBoardNode(id,"task",id)));
   current.edges=[{id:"a",source:"one",target:"two"},{id:"b",source:"two",target:"three"}];
   current.attempts.push({id:"attempt",nodeId:"one",nodeRevision:1,runId:"run",taskId:"task",dispatchId:"dispatch",assigneeHandle:"term",ownsProcess:true,nativeStatus:"dispatched",workspacePath:"/fixture",promptPath:"original",resultPath:null,guidancePaths:[],dependencyAttemptIds:[],stopped:false});
   return current;
  });
  board=await store.update(board.id,board.revision,"edit",current=>applyBoardEdit(current,{kind:"edit-node",nodeId:"one",title:"one",content:{prompt:"New input",plan:"",design:"",implementationNotes:""},assignment:{kind:"new-worker",agent:"codex",workspacePath:"/fixture"}}));
  assert.deepEqual(board.pausedNodeIds,["two","three"]);
  assert.equal(board.attempts[0].nodeRevision,1);assert.equal(board.attempts[0].promptPath,"original");
  board=await store.update(board.id,board.revision,"request",current=>{current.actions.push({id:"stop",kind:"stop-rerun",baseRevision:current.revision,phase:"claimed",actor:"",nodeId:"one",requestId:null,receiptPath:null,error:null,payload:{body:"",data:{nodeId:"one"}}});return current;});
  const prepared=await executor.begin(board.id,"stop","");
  assert.equal(prepared.operation?.kind,"stop-worker");
  const after=await executor.finish(board.id,"stop",prepared.token!,{phase:"unknown",requestId:"unknown",stage:null,runId:null,taskId:null,dispatchId:null,liveness:"unverifiable",raw:{},error:"Timeout"});
  assert.equal(after.attempts[0].stopped,false);
  assert.equal(after.actions.find(action=>action.id==="stop")!.phase,"unknown");
  assert.equal(after.acceptedNodeDigests.one,undefined);
 }finally{await store.close();await rm(root,{recursive:true,force:true});}
});
