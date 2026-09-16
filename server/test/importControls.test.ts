import assert from 'node:assert/strict';import {test} from 'node:test';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createBoardStore} from '../src/boardStore.js';import {createImportControls} from '../src/importControls.js';import {mergeImportedWork} from '../src/importMerge.js';import {resolveBoardDependencies} from '../src/boardDependencies.js';import {createBoardNode,type MemberRef} from '../../shared/board.js';import {applyBoardEdit} from '../src/boardRoutes.js';
const owner:MemberRef={identity:'codex:owner',source:'codex',sessionId:'owner',tabId:'tab',tabName:'Owner',terminalHandle:'term_owner',incarnationId:'inc',hostId:'local',workspacePath:'/tmp'};
test('owner actions preserve frozen identity and distinguish acknowledgment from applied outcome',async()=>{
 const root=await mkdtemp(join(tmpdir(),'owner-actions-')),store=await createBoardStore(root);
 try{
  let board=await store.create({title:'Group',members:[owner],coordinatorIdentity:owner.identity},'create');
  board=await store.update(board.id,board.revision,'import',board=>{mergeImportedWork(board,[{itemId:'work',sourceIdentity:owner.identity,ownerIdentity:owner.identity,ownerHandle:owner.terminalHandle,native:null,title:'Work',content:{prompt:'Scope',plan:'',design:'',implementationNotes:''},status:'running',observedAt:'today',references:[],dependencies:[],resultPath:null}]);return board;});
  const node=board.nodes[1],controls=createImportControls(store,async member=>member);
  await controls.queue(board.id,board.revision,'pause-work',node.id,'pause','Pause future launches');
  assert.equal((await store.read(board.id)).pausedNodeIds.includes(node.id),true);
  await assert.rejects(controls.claim(board.id,'pause-work','codex:wrong'),/owner/);
  await controls.claim(board.id,'pause-work',owner.identity);
  await controls.finish(board.id,'pause-work',owner.identity,'acknowledged','Received; current work settling');
  assert.equal((await store.read(board.id)).actions[0].phase,'claimed');
  await controls.finish(board.id,'pause-work',owner.identity,'applied','Owner scheduler paused; no new launches');
  assert.equal((await store.read(board.id)).actions[0].phase,'applied');
  assert.throws(()=>applyBoardEdit(structuredClone(board),{kind:'remove-node',nodeId:node.id}),/active|owner|work/i);
 }finally{await store.close();await rm(root,{recursive:true,force:true});}
});
test('completed imports supply frozen evidence without cross-Run native dependencies',()=>{
 const {board,node}=makeBoard();node.imported!.status='completed';node.imported!.resultPath='evidence';node.imported!.resultRevision=node.revision;
 const successor=createBoardNode('successor','task','Next');board.nodes.push(successor);board.edges.push({id:'dep',source:node.id,target:successor.id});
 assert.equal(resolveBoardDependencies(board,'successor')[0].kind,'imported');assert.equal(resolveBoardDependencies(board,'successor')[0].artifactPath,'evidence');
 node.revision++;assert.throws(()=>resolveBoardDependencies(board,'successor'),/Unresolved/);
});
import {createBoardSnapshot} from '../../shared/board.js';
function makeBoard(){const board=createBoardSnapshot('board_test','Group',[owner],owner.identity);mergeImportedWork(board,[{itemId:'work',sourceIdentity:owner.identity,ownerIdentity:owner.identity,ownerHandle:owner.terminalHandle,native:null,title:'Work',content:{prompt:'Scope',plan:'',design:'',implementationNotes:''},status:'running',observedAt:'today',references:[],dependencies:[],resultPath:null}]);return {board,node:board.nodes[1]};}

test('direct launch cannot redispatch imported work even when a caller supplies assignment',async()=>{
 const root=await mkdtemp(join(tmpdir(),'import-launch-')),store=await createBoardStore(root);
 try{
  let board=await store.create({title:'Group',members:[owner],coordinatorIdentity:owner.identity},'create');
  const fixture=makeBoard();board=await store.update(board.id,board.revision,'setup',value=>({...value,nodes:[value.nodes[0],fixture.node]}));
  const {createExecutionBridge}=await import('../src/executionBridge.js');
  await assert.rejects(createExecutionBridge(store).admitLaunch(board.id,fixture.node.id,fixture.node.revision,'duplicate'),/Imported/);
  assert.equal((await store.read(board.id)).attempts.length,0);
 }finally{await store.close();await rm(root,{recursive:true,force:true});}
});
test('changed Dispatch or node revision prevents stale owner action claim',async()=>{
 const root=await mkdtemp(join(tmpdir(),'owner-stale-')),store=await createBoardStore(root);
 try{
  let board=await store.create({title:'Group',members:[owner],coordinatorIdentity:owner.identity},'create');const fixture=makeBoard();
  board=await store.update(board.id,board.revision,'setup',value=>({...value,nodes:[value.nodes[0],fixture.node]}));
  const controls=createImportControls(store,async member=>member);board=await controls.queue(board.id,board.revision,'guidance',fixture.node.id,'guidance','Update');
  board=await store.update(board.id,board.revision,'new-revision',value=>{value.nodes[1].revision++;return value;});
  await assert.rejects(controls.claim(board.id,'guidance',owner.identity),/revision/);
 }finally{await store.close();await rm(root,{recursive:true,force:true});}
});

test('explicit duplicate confirmation merges attribution while preserving native execution',()=>{
 const {board,node}=makeBoard();const native={...structuredClone(node.imported!),native:{hostId:'local',runId:'run',taskId:'task',dispatchId:'dispatch'},itemId:'native'};
 mergeImportedWork(board,[native]);const target=board.nodes.at(-1)!;
 applyBoardEdit(board,{kind:'merge-import',nodeId:node.id,targetNodeId:target.id});
 assert.equal(node.removed,true);assert.equal(target.imported?.native?.dispatchId,'dispatch');assert.ok(target.imported!.sourceIdentities.includes(owner.identity));
 mergeImportedWork(board,[{...node.imported!,title:'Late duplicate'}]);assert.equal(node.removed,true);
});
