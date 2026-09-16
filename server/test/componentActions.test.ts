import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBoardStore } from '../src/boardStore.js';
import { createBoardNode, type MemberRef } from '../../shared/board.js';
import { createCoordinatorActions } from '../src/coordinatorActions.js';
import { digestNodeInput, digestSpec } from '../src/boardGraph.js';
import { applyBoardEdit } from '../src/boardRoutes.js';
const member=(id:string):MemberRef=>({identity:`codex:${id}`,source:'codex',sessionId:id,tabId:id,tabName:id,terminalHandle:`term_${id}`,incarnationId:id,hostId:'host',workspacePath:'/feature'});

test('component requests reach their master without a parent Dispatch or Run takeover',async()=>{
 const root=await mkdtemp(join(tmpdir(),'component-actions-')),store=await createBoardStore(root);
 const coordinator=member('coordinator'),master=member('master');
 const recipients:string[]=[];
 const actions=createCoordinatorActions(store,{verify:async member=>member,send:async(member,prompt)=>{recipients.push(member.identity);assert.match(prompt,/component/);return {accepted:true};}});
 try{
  let board=await store.create({title:'Delivery',members:[coordinator,master],coordinatorIdentity:coordinator.identity},'create');
  board=await store.update(board.id,board.revision,'setup',current=>{const node=createBoardNode('component','task','Component');node.collaborate={masterIdentity:master.identity,manifestPath:'/manifest.json'};current.nodes.push(node);current.implementationRunId='run_parent';current.specApproval={nodeRevision:1,digest:digestSpec(current)};current.acceptedNodeDigests.component=digestNodeInput(current,'component');current.pauseNewStarts=false;return current;});
  board=await actions.queue(board.id,board.revision,'start-component','component-start','Implement component',{nodeId:'component'});
  await actions.deliver(board.id,'start-component');
  assert.deepEqual(recipients,[master.identity]);
  await assert.rejects(actions.claim(board.id,'start-component',coordinator.identity),/master/);
  board=await actions.claim(board.id,'start-component',master.identity);
  assert.equal(board.actions[0].actor,master.identity);
  assert.equal(board.implementationRunId,'run_parent');assert.equal(board.attempts.length,0);
  assert.throws(()=>applyBoardEdit(structuredClone(board),{kind:'remove-node',nodeId:'component'}),/Stop/);
 }finally{await store.close();await rm(root,{recursive:true,force:true});}
});
