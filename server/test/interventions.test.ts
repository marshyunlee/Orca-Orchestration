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
  const recovered=await executor.finish(board.id,"stop",prepared.token!,{phase:"applied",requestId:"unknown",stage:null,runId:"run",taskId:"task",dispatchId:"dispatch",liveness:"exited",raw:{result:{state:"stopped"}},error:null});
  assert.equal(recovered.attempts[0].stopped,true);
  assert.equal(recovered.actions.find(action=>action.id==="stop")!.phase,"applied");
  let settled=await store.read(board.id);
  settled=await store.update(board.id,settled.revision,"settled-race",current=>{
    current.attempts[0].nativeStatus="completed";current.attempts[0].resultPath="report";current.attempts[0].stopped=false;
    current.actions.push({id:"settled-stop",kind:"stop-rerun",baseRevision:current.revision,phase:"claimed",actor:"",nodeId:"one",requestId:null,receiptPath:null,error:null,payload:{}});return current;
  });
  const noStop=await executor.begin(board.id,"settled-stop","");
  assert.equal(noStop.operation,null);
  const reconciled=await store.read(board.id);
  assert.equal(reconciled.actions.find(action=>action.id==="settled-stop")!.phase,"applied");
  assert.equal(reconciled.attempts[0].nativeStatus,"completed");
  assert.equal(reconciled.attempts[0].stopped,false);
  const ready=await store.read(board.id);
  await store.update(board.id,ready.revision,"blocked-member",current=>{
    current.attempts[0].nativeStatus="dispatched";current.attempts[0].ownsProcess=false;current.attempts[0].resultPath=null;
    current.messages.push({id:"question",nativeMessageId:"native-question",author:"dispatch:dispatch",body:"May I proceed?",createdAt:"now",answered:false});
    current.actions.push({id:"blocked-stop",kind:"stop-rerun",baseRevision:current.revision,phase:"claimed",actor:"",nodeId:"one",requestId:null,receiptPath:null,error:null,payload:{}});return current;
  });
  const wake=await executor.begin(board.id,"blocked-stop","");
  assert.equal(wake.operation?.kind,"reply-question");
  if(wake.operation?.kind==="reply-question")assert.equal(wake.operation.messageId,"native-question");
  const waiting=await executor.finish(board.id,"blocked-stop",wake.token!,{phase:"applied",requestId:"reply",stage:null,runId:"run",taskId:null,dispatchId:null,liveness:null,raw:{ok:true},error:null});
  assert.equal(waiting.actions.find(action=>action.id==="blocked-stop")!.phase,"claimed");
  assert.equal(waiting.messages.find(message=>message.id==="question")!.answered,true);
  assert.equal(waiting.attempts[0].stopped,false);
 }finally{await store.close();await rm(root,{recursive:true,force:true});}
});

test("Start preserves the component Run when its master also coordinates direct tasks",async()=>{
 const root=await mkdtemp(join(tmpdir(),"shared-master-")),store=await createBoardStore(root);
 try{
  let board=await store.create({title:"Fixture",members:[{identity:"codex:master",source:"codex",sessionId:"master",tabId:"tab",tabName:"Master",terminalHandle:"term_master",incarnationId:"inc",hostId:"host",workspacePath:"/fixture"}],coordinatorIdentity:"codex:master"},"create");
  board=await store.update(board.id,board.revision,"setup",current=>{
   const component=createBoardNode("component","task","Component");component.collaborate={masterIdentity:"codex:master",manifestPath:"/manifest.json"};
   current.nodes.push(component,createBoardNode("direct","task","Direct"));
   current.components.component={masterIdentity:"codex:master",manifestPath:"/manifest.json",manifestDigest:"manifest",runId:"run_master",featureWorkspace:"/fixture",phase:"planning",gate:{baselineSha:"base",overlayDigest:"gate",commands:[],setup:[],humanChecks:[],selectionPolicy:[],deliveryScope:"repair",featureCloseRequested:false,repairPolicy:{}},gateDigest:"gate",approvals:[],launches:[],result:null,tasks:[],observedAt:"now"};
   current.actions.push({id:"start",kind:"start",baseRevision:current.revision,phase:"claimed",actor:"codex:master",nodeId:null,requestId:null,receiptPath:null,error:null,payload:{}});return current;
  });
  assert.equal((await createActionExecutor(store).begin(board.id,"start","codex:master")).operation,null);
  assert.equal((await store.read(board.id)).implementationRunId,"run_master");
 }finally{await store.close();await rm(root,{recursive:true,force:true});}
});
