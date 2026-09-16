import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createBoardStore} from '../src/boardStore.js';
import {createSessionCollection} from '../src/sessionCollection.js';
import type {MemberRef} from '../../shared/board.js';
const owner:MemberRef={identity:'codex:owner',source:'codex',sessionId:'owner',tabId:'tab',tabName:'Owner',terminalHandle:'term_owner',incarnationId:'inc',hostId:'local',workspacePath:'/tmp'};
const member={...owner,identity:'codex:member',sessionId:'member',terminalHandle:'term_member'};
const summary={goals:'Goal',acceptedScope:'Existing scope',blockers:'',documents:[],items:[]};
test('collection persists outstanding requests, partial replies and stale member history',async()=>{
 const root=await mkdtemp(join(tmpdir(),'collection-')),store=await createBoardStore(root);
 try{
  const board=await store.create({title:'Group',members:[owner,member],coordinatorIdentity:owner.identity},'create');
  const port={verify:async(value:MemberRef)=>value,context:async()=>({available:false,capturedAt:null,references:[],text:'',error:'No saved context'}),discover:async()=>({items:[],tasks:[]})};
  const collection=createSessionCollection(store,port);
  await collection.begin(board.id);await collection.begin(board.id);
  let current=await store.read(board.id);assert.equal(current.collection.requests.length,2);
  const own=current.collection.requests.find(r=>r.member.identity===owner.identity)!;
  await collection.publish(board.id,own.id,owner.identity,summary);
  await collection.publish(board.id,own.id,owner.identity,summary);
  current=await store.read(board.id);assert.equal(current.messages.length,1);
  const pending=current.collection.requests.find(r=>r.member.identity===member.identity)!;
  await store.update(board.id,current.revision,'remove',b=>({...b,members:[owner]}));
  await collection.publish(board.id,pending.id,member.identity,summary);
  current=await store.read(board.id);assert.ok(current.collection.requests[1].responsePath);assert.equal(current.messages.length,1);
  await store.close();const reopened=await createBoardStore(root);assert.equal((await reopened.read(board.id)).collection.requests.length,2);await reopened.close();
 }finally{await store.close();await rm(root,{recursive:true,force:true});}
});
test('collection delivery admits once and retains uncertain original identity',async()=>{
 const root=await mkdtemp(join(tmpdir(),'collection-')),store=await createBoardStore(root);
 try{
  const board=await store.create({title:'Group',members:[owner,member],coordinatorIdentity:owner.identity},'create');
  const collection=createSessionCollection(store,{verify:async value=>value,context:async()=>({available:false,capturedAt:null,references:[],text:'',error:null}),discover:async()=>({items:[],tasks:[]})});
  await collection.begin(board.id);const request=(await store.read(board.id)).collection.requests[1];
  const operation=await collection.prepareDelivery(board.id,request.id,owner.identity);assert.equal(operation.kind,'send-summary');
  await assert.rejects(collection.prepareDelivery(board.id,request.id,owner.identity),/already|reconcile/);
  await collection.recordDelivery(board.id,request.id,owner.identity,{phase:'unknown',requestId:'original',raw:{},error:'timeout'});
  assert.equal((await store.read(board.id)).collection.requests[1].requestId,'original');
 }finally{await store.close();await rm(root,{recursive:true,force:true});}
});

test('late delivery cannot change a new increment and narrative completion retains attributed evidence',async()=>{
 const root=await mkdtemp(join(tmpdir(),'collection-history-')),store=await createBoardStore(root);
 try{
  let board=await store.create({title:'Group',members:[owner],coordinatorIdentity:owner.identity},'create');
  const collection=createSessionCollection(store,{verify:async value=>value,context:async()=>({available:false,capturedAt:null,references:[],text:'',error:null}),discover:async()=>({items:[],tasks:[]})});
  await collection.begin(board.id);board=await store.read(board.id);const old=board.collection.requests[0];
  await store.update(board.id,board.revision,'increment',value=>({...value,deliveryId:'new-delivery'}));
  await collection.publish(board.id,old.id,owner.identity,summary);assert.equal((await store.read(board.id)).messages.length,0);
  await collection.begin(board.id);board=await store.read(board.id);const latest=board.collection.requests.at(-1)!;
  await collection.publish(board.id,latest.id,owner.identity,{...summary,items:[{itemId:'done',sourceIdentity:owner.identity,ownerIdentity:owner.identity,ownerHandle:owner.terminalHandle,native:null,title:'Finished work',content:{prompt:'Scope',plan:'',design:'',implementationNotes:''},status:'completed',observedAt:'today',references:['proof'],dependencies:[],resultPath:null,result:'Verified result'}]});
  const source=(await store.read(board.id)).nodes[1].imported!;assert.ok(source.resultPath);assert.match(await store.readArtifact(board.id,source.resultPath!),/Verified result/);assert.equal(source.resultRevision,1);
 }finally{await store.close();await rm(root,{recursive:true,force:true});}
});

test('refresh reloads saved context while reusing an outstanding summary request',async()=>{
 const root=await mkdtemp(join(tmpdir(),'collection-context-')),store=await createBoardStore(root);let text='old';
 try{
  const board=await store.create({title:'Group',members:[owner],coordinatorIdentity:owner.identity},'create');
  const collection=createSessionCollection(store,{verify:async value=>value,context:async()=>({available:true,capturedAt:'today',references:[],text,error:null}),discover:async()=>({items:[],tasks:[]})});
  await collection.begin(board.id);text='new';await collection.begin(board.id);
  const current=await store.read(board.id);assert.equal(current.collection.requests.length,1);assert.match(await store.readArtifact(board.id,current.collection.requests[0].savedPath!),/new/);
 }finally{await store.close();await rm(root,{recursive:true,force:true});}
});
