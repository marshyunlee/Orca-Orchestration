import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBoardNode, createBoardSnapshot } from '../../shared/board.js';
import { digestNodeInput, digestExecutableBoard, validateGraph } from '../src/boardGraph.js';
import { createBoardStore } from '../src/boardStore.js';
import { applyBoardEdit } from '../src/boardRoutes.js';

test('component binding changes executable approvals while historical direct nodes keep their digest', () => {
 const board=createBoardSnapshot('board_fixture','Fixture',[],'');
 const node=createBoardNode('component','task','Component');board.nodes.push(node);
 const originalNode=digestNodeInput(board,node.id),originalGraph=digestExecutableBoard(board);
 Object.assign(node,{collaborate:{masterIdentity:'codex:master',manifestPath:'/fixture/manifest.json'}});
 assert.notEqual(digestNodeInput(board,node.id),originalNode);
 assert.notEqual(digestExecutableBoard(board),originalGraph);
 Object.assign(node,{collaborate:undefined});
 assert.equal(digestNodeInput(board,node.id),originalNode);
 assert.equal(digestExecutableBoard(board),originalGraph);
 Object.assign(node,{collaborate:{masterIdentity:'codex:master',manifestPath:'relative.json'}});
 assert.throws(()=>validateGraph(board.nodes,board.edges),/absolute/);
});

test('saved component binding increments revision and survives store restart',async()=>{
 const root=await mkdtemp(join(tmpdir(),'component-contract-'));let store=await createBoardStore(root);
 try{
  let board=await store.create({title:'Fixture',members:[],coordinatorIdentity:''},'create');
  board=await store.update(board.id,board.revision,'task',current=>{current.nodes.push(createBoardNode('component','task','Component'));return current;});
  const node=board.nodes[1];
  const binding={masterIdentity:'codex:master',manifestPath:'/fixture/manifest.json'};
  // Membership is validated before this edit is accepted.
  assert.throws(()=>applyBoardEdit(structuredClone(board),{kind:'edit-node',nodeId:node.id,title:node.title,content:node.content,assignment:null,collaborate:binding} as never),/member/);
  board=await store.update(board.id,board.revision,'member',current=>{current.members.push({identity:'codex:master',source:'codex',sessionId:'master',tabId:'tab',tabName:'Master',terminalHandle:'term',incarnationId:'inc',hostId:'host',workspacePath:'/fixture'});return current;});
  board=await store.update(board.id,board.revision,'binding',current=>applyBoardEdit(current,{kind:'edit-node',nodeId:node.id,title:node.title,content:node.content,assignment:null,collaborate:binding} as never));
  assert.equal(board.nodes[1].revision,2);
  await store.close();store=await createBoardStore(root);
  const restored=await store.read(board.id);
  assert.deepEqual((restored.nodes[1] as unknown as {collaborate:unknown}).collaborate,binding);
 }finally{await store.close();await rm(root,{recursive:true,force:true});}
});
