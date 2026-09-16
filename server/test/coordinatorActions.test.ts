import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp,rm } from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createBoardStore} from "../src/boardStore.js";
import {createCoordinatorActions} from "../src/coordinatorActions.js";
import {digestExecutableBoard,digestSpec} from "../src/boardGraph.js";

test("queued requests precede delivery; duplicate requests and stale proposals preserve human edits",async()=>{
 const root=await mkdtemp(join(tmpdir(),"coordinator-actions-")),store=await createBoardStore(root);
 const member={identity:"codex:lead",source:"codex" as const,sessionId:"lead",tabId:"tab",tabName:"Lead",terminalHandle:"term",incarnationId:"inc",hostId:"local",workspacePath:"/fixture"};
 let deliveries=0,idle=false;
 const actions=createCoordinatorActions(store,{verify:async member=>member,idle:async()=>idle,send:async()=>{deliveries++;return {send:{accepted:true},mutation:{requestId:"request"}};}});
 try{
  const board=await store.create({title:"Group",members:[member,{...member,identity:"codex:peer",sessionId:"peer",terminalHandle:"peer"}],coordinatorIdentity:member.identity},"create");
  const queued=await actions.queue(board.id,board.revision,"request","discuss","Build a tiny example");
  assert.equal(queued.messages[0].body,"Build a tiny example");
  await actions.deliver(board.id,"request");assert.equal(deliveries,0);
  idle=true;await actions.deliver(board.id,"request");await actions.deliver(board.id,"request");assert.equal(deliveries,1);
  const claimed=await actions.claim(board.id,"request",member.identity);
  await store.update(board.id,claimed.revision,"human-edit",current=>{current.nodes[0].content.prompt="Human revision";current.nodes[0].revision++;return current;});
  await assert.rejects(actions.publish(board.id,claimed.revision,"request",member.identity,{kind:"spec",text:"Old proposal",messages:[]}),/revision conflict/);
  assert.equal((await store.read(board.id)).nodes[0].content.prompt,"Human revision");
  const current=await store.read(board.id);
  await assert.rejects(actions.publish(board.id,current.revision,"request",member.identity,{kind:"preview",text:"Wrong graph",specDigest:digestSpec(current),graphDigest:"stale"}),/graph/);
  assert.equal((await store.read(board.id)).preview,null);
  assert.equal(typeof digestExecutableBoard(current),"string");
 }finally{await store.close();await rm(root,{recursive:true,force:true});}
});
