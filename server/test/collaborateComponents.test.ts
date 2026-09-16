import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBoardStore } from '../src/boardStore.js';
import { createBoardNode, type MemberRef } from '../../shared/board.js';
import { createCollaborateComponents } from '../src/collaborateComponents.js';
const master:MemberRef={identity:'codex:master',source:'codex',sessionId:'master',tabId:'tab',tabName:'Master',terminalHandle:'term_master',incarnationId:'inc',hostId:'host',workspacePath:'/feature'};

test('component evidence keeps its Run owner and reuses only exact gate approval',async()=>{
 const root=await mkdtemp(join(tmpdir(),'collaborate-board-'));let store=await createBoardStore(root);
 const manifest:Record<string,unknown>={orca_run_id:'run_component',feature_worktree:'/feature',baseline_sha:'baseline',gate_revision:'overlay',gate_commands:['npm test'],setup:{},human_checks:['Review output'],selection_policy:['diff_lines'],delivery_scope:'feature',feature_close_requested:false,repair_policy:{max_rounds:2},tasks:{task_one:{kind:'implementation',candidate_id:'impl-astra',dispatch_id:'dispatch_one',report:'reports/one.json'}},phase:'planning'};
 const inspected:string[]=[];
 const ports={readManifest:async(path:string)=>({path,value:structuredClone(manifest)}),verifyMaster:async(member:MemberRef)=>member,verifyFeature:async(path:string)=>{assert.equal(path,'/feature');},verifyRun:async(runId:string,handle:string)=>{inspected.push(runId);assert.equal(handle,master.terminalHandle);}};
 try{
  let board=await store.create({title:'Delivery',members:[master],coordinatorIdentity:master.identity},'create');
  board=await store.update(board.id,board.revision,'setup',current=>{const node=createBoardNode('component','task','Component');node.collaborate={masterIdentity:master.identity,manifestPath:'/manifest.json'};current.nodes.push(node);current.implementationRunId='run_parent';return current;});
  let service=createCollaborateComponents(store,ports);
  await assert.rejects(service.refresh(board.id,'component','codex:wrong','bad'),/master/);
  board=await service.refresh(board.id,'component',master.identity,'bind');
  assert.equal(board.implementationRunId,'run_parent');
  const state=board.components.component;
  assert.equal(state.runId,'run_component');assert.deepEqual(inspected,['run_component']);
  assert.equal(state.tasks[0].dispatchId,'dispatch_one');
  const approved=await service.approve(board.id,'component',state.gateDigest,{kind:'ui',reference:'fixture-click',response:'Approve gate'},'approve');
  assert.equal(approved.components.component.approvals.length,1);
  const replay=await service.approve(board.id,'component',state.gateDigest,{kind:'ui',reference:'fixture-click',response:'Approve gate'},'approve');
  assert.equal(replay.revision,approved.revision);
  const crossInterface=await service.approve(board.id,'component',state.gateDigest,{kind:'chat',reference:'/fixture/user-answer',response:'Approve gate'},'approve-chat');
  assert.equal(crossInterface.components.component.approvals.length,1);
  manifest.phase='reviewing';
  board=await service.refresh(board.id,'component',master.identity,'progress');
  assert.equal(board.components.component.gateDigest,state.gateDigest);
  assert.equal(service.currentApproval(board,'component')?.digest,state.gateDigest);
  manifest.gate_commands=['npm test','npm run integration'];
  board=await service.refresh(board.id,'component',master.identity,'revised-gate');
  assert.notEqual(board.components.component.gateDigest,state.gateDigest);
  assert.equal(service.currentApproval(board,'component'),null);
  await assert.rejects(service.approve(board.id,'component',state.gateDigest,{kind:'chat',reference:'/user-response',response:'Approve'},'stale'),/changed/);
  await store.close();store=await createBoardStore(root);service=createCollaborateComponents(store,ports);
  const restored=await store.read(board.id);assert.equal(restored.components.component.approvals.length,1);
  assert.equal(service.currentApproval(restored,'component'),null);
 }finally{await store.close();await rm(root,{recursive:true,force:true});}
});

test('each child launch is ordered against board pause and stale approvals',async()=>{
 const root=await mkdtemp(join(tmpdir(),'component-admission-')),store=await createBoardStore(root);
 const manifest={orca_run_id:'run_component',feature_worktree:'/feature',baseline_sha:'baseline',gate_revision:'overlay',gate_commands:['test'],human_checks:[],selection_policy:['diff_lines'],delivery_scope:'feature',feature_close_requested:false,repair_policy:{max_rounds:2},tasks:{task_review:{kind:'review',candidate_id:'impl-opus'}}};
 const ports={readManifest:async(path:string)=>({path,value:structuredClone(manifest)}),verifyMaster:async(member:MemberRef)=>member,verifyFeature:async()=>{},verifyRun:async()=>{}};
 try{
  let board=await store.create({title:'Delivery',members:[master],coordinatorIdentity:master.identity},'create');
  const {digestNodeInput,digestSpec}=await import('../src/boardGraph.js');
  board=await store.update(board.id,board.revision,'setup',current=>{const node=createBoardNode('component','task','Component');node.collaborate={masterIdentity:master.identity,manifestPath:'/manifest.json'};current.nodes.push(node);current.specApproval={nodeRevision:1,digest:digestSpec(current)};current.acceptedNodeDigests.component=digestNodeInput(current,'component');current.pauseNewStarts=false;return current;});
  const service=createCollaborateComponents(store,ports);
  board=await service.refresh(board.id,'component',master.identity,'bind');
  await service.approve(board.id,'component',board.components.component.gateDigest,{kind:'ui',reference:'click',response:'Approve'},'approve');
  const request={identity:master.identity,launchId:'launch-review',taskId:'task_review',role:'reviewer',candidateId:'impl-opus',journalPath:'/private/task_review/launch.json'};
  const prepared=await service.preflight(board.id,'component',request);
  assert.equal(prepared.phase,'prepared');
  board=await store.read(board.id);
  await store.update(board.id,board.revision,'pause',current=>{current.pauseNewStarts=true;return current;});
  await assert.rejects(service.beginLaunch(board.id,'component',request),/paused/);
  board=await store.read(board.id);assert.equal(board.components.component.launches[0].phase,'prepared');
  await store.update(board.id,board.revision,'resume',current=>{current.pauseNewStarts=false;return current;});
  assert.equal((await service.beginLaunch(board.id,'component',request)).phase,'claimed');
  await assert.rejects(service.beginLaunch(board.id,'component',request),/already|reconcile/i);
  await assert.rejects(service.preflight(board.id,'component',{...request,launchId:'wrong-role',role:'implementer'}),/role/);
  await service.recordLaunch(board.id,'component',request,{ok:true,result:{runId:'run_component',taskId:'task_review',dispatchId:'dispatch_review',state:'ready',mutation:{requestId:'native-request'}}});
  board=await store.read(board.id);
  assert.equal(board.components.component.launches[0].dispatchId,'dispatch_review');
  assert.equal(board.components.component.launches[0].requestId,'native-request');
  await assert.rejects(service.preflight(board.id,'component',{...request,launchId:'duplicate'}),/already/);
  await assert.rejects(service.recordLaunch(board.id,'component',request,{ok:true,result:{runId:'run_component',taskId:'task_review',dispatchId:'another-dispatch',state:'ready'}}),/Conflicting/);
  assert.equal(board.implementationRunId,null);
 }finally{await store.close();await rm(root,{recursive:true,force:true});}
});
