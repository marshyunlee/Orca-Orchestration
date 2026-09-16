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
 let deliveries=0;
 const actions=createCoordinatorActions(store,{verify:async member=>member,send:async()=>{deliveries++;return {send:{accepted:true},mutation:{requestId:"request"}};}});
 try{
  const board=await store.create({title:"Group",members:[member,{...member,identity:"codex:peer",sessionId:"peer",terminalHandle:"peer"}],coordinatorIdentity:member.identity},"create");
  const queued=await actions.queue(board.id,board.revision,"request","discuss","Build a tiny example");
  assert.equal(queued.messages[0].body,"Build a tiny example");
  await actions.deliver(board.id,"request");await actions.deliver(board.id,"request");assert.equal(deliveries,1);
  assert.equal((await store.read(board.id)).actions[0].phase,"queued");
  const claimed=await actions.claim(board.id,"request",member.identity);
  await store.update(board.id,claimed.revision,"human-edit",current=>{current.nodes[0].content.prompt="Human revision";current.nodes[0].revision++;return current;});
  await assert.rejects(actions.publish(board.id,claimed.revision,"request",member.identity,{kind:"spec",text:"Old proposal",messages:[]}),/revision conflict/);
  assert.equal((await store.read(board.id)).nodes[0].content.prompt,"Human revision");
  const current=await store.read(board.id);
  await assert.rejects(actions.publish(board.id,current.revision,"request",member.identity,{kind:"preview",text:"Wrong graph",specDigest:digestSpec(current),graphDigest:"stale"}),/graph/);
  assert.equal((await store.read(board.id)).preview,null);
  assert.equal(typeof digestExecutableBoard(current),"string");
  const reviewing=await store.update(board.id,current.revision,"review",value=>{
    value.actions.push({id:"preview",kind:"review-graph",phase:"claimed",actor:member.identity,baseRevision:value.revision,nodeId:null,requestId:null,receiptPath:null,error:null,payload:{}});return value;
  });
  const proposal={kind:"preview" as const,text:"Expected screen",specDigest:digestSpec(reviewing),graphDigest:digestExecutableBoard(reviewing)};
  await assert.rejects(actions.publish(board.id,reviewing.revision,"preview",member.identity,{...proposal,images:[{mimeType:"image/svg+xml",base64:"PHN2Zz4=",caption:"Unsafe"}]}),/PNG/);
  const published=await actions.publish(board.id,reviewing.revision,"preview",member.identity,{...proposal,images:[{mimeType:"image/png",base64:"iVBORw0KGgo=",caption:"Mockup"}]});
  assert.equal(published.preview?.current,true);
  const image=JSON.parse(await store.readArtifact(board.id,published.preview!.images![0].artifactPath));
  assert.equal(image.mimeType,"image/png");assert.equal(image.caption,"Mockup");assert.equal(published.attempts.length,0);
 }finally{await store.close();await rm(root,{recursive:true,force:true});}
});
