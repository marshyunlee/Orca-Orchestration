import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createBoardStore} from '../src/boardStore.js';
import {createBoardNode,type MemberRef} from '../../shared/board.js';
import {createCollaborateComponents} from '../src/collaborateComponents.js';
import {createCoordinatorActions} from '../src/coordinatorActions.js';
import {refreshComponentQuestions} from '../src/nativeObservation.js';
import type {ComponentState} from '../../shared/collaborate.js';

test('restart preserves unknown component launch and routes a child question through its own master',async()=>{
 const root=await mkdtemp(join(tmpdir(),'component-recovery-'));let store=await createBoardStore(root);
 const master:MemberRef={identity:'codex:master',source:'codex',sessionId:'master',tabId:'tab',tabName:'Master',terminalHandle:'master',incarnationId:'inc',hostId:'host',workspacePath:'/feature'};
 const request={identity:master.identity,launchId:'launch',taskId:'task',role:'reviewer',candidateId:'candidate',journalPath:'/journal'};
 const {digestComponentValue}=await import('../src/collaborateComponents.js');
 try{
  let board=await store.create({title:'Recovery',members:[master],coordinatorIdentity:master.identity},'create');
  board=await store.update(board.id,board.revision,'setup',current=>{
   const node=createBoardNode('component','task','Component');node.collaborate={masterIdentity:master.identity,manifestPath:'/manifest'};current.nodes.push(node);
   current.components.component={masterIdentity:master.identity,runId:'component-run',tasks:[{taskId:'task',dispatchId:'dispatch',state:'ready'}],launches:[{request,requestDigest:digestComponentValue(request),phase:'claimed',dispatchId:null,requestId:'original-request',dependencies:[]}]} as unknown as ComponentState;
   return current;
  });
  await store.close();store=await createBoardStore(root);
  board=await store.read(board.id);assert.equal(board.components.component.launches[0].phase,'unknown');
  const ports={verifyMaster:async(member:MemberRef)=>member,readManifest:async()=>{throw new Error('Receipt reconciliation must not need unchanged gate inputs');},verifyFeature:async()=>{},verifyRun:async()=>{}};
  board=await createCollaborateComponents(store,ports).recordLaunch(board.id,'component',request,{ok:true,result:{runId:'component-run',taskId:'task',dispatchId:'dispatch',state:'ready'}});
  assert.equal(board.components.component.launches[0].requestId,'original-request');
  const calls:string[][]=[];
  await refreshComponentQuestions(store,board.id,{runOrca:async <T,>(argv:string[])=>{calls.push(argv);return {messages:[{id:'question',type:'question',from_handle:'dispatch:dispatch',body:'Which output?',created_at:'now'}]} as T;}});
  assert.ok(calls[0].includes('--peek'));assert.equal(calls[0].at(-1),'component-run');
  board=await store.read(board.id);assert.equal(board.messages[0].componentNodeId,'component');
  const actions=createCoordinatorActions(store,{verify:async member=>member,send:async()=>({accepted:true})});
  board=await actions.queue(board.id,board.revision,'answer','component-question','Use JSON',{nodeId:'component',messageId:'question'});
  await actions.claim(board.id,'answer',master.identity);
  board=await actions.finishComponent(board.id,'component','answer',master.identity,'Native reply receipt retained at /evidence');
  assert.equal(board.messages[0].answered,true);assert.equal(board.implementationRunId,null);
 }finally{await store.close();await rm(root,{recursive:true,force:true});}
});
