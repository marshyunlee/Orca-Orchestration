import assert from "node:assert/strict";
import {test} from "node:test";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createBoardStore} from "../src/boardStore.js";
import {createMembershipActions} from "../src/membershipActions.js";

test("membership reconciliation preserves the approved selection and can replace an unknown receipt",async()=>{
 const root=await mkdtemp(join(tmpdir(),"membership-")),store=await createBoardStore(root);
 const member={identity:"codex:lead",source:"codex" as const,sessionId:"lead",tabId:"tab",tabName:"Lead",terminalHandle:"lead",incarnationId:"inc",hostId:"local",workspacePath:"/fixture"};
 const peer={...member,identity:"codex:peer",sessionId:"peer",terminalHandle:"peer"};
 const actions=createMembershipActions(store,async member=>member);
 try{
  let board=await store.create({title:"Fixture",members:[member,peer],coordinatorIdentity:member.identity},"create");
  board=await store.update(board.id,board.revision,"request",current=>{
   current.discussionGroupId="group";
   current.actions.push({id:"members",kind:"members",phase:"claimed",actor:member.identity,baseRevision:current.revision,nodeId:null,requestId:null,receiptPath:null,error:null,payload:{data:{members:[member,peer],coordinatorIdentity:member.identity}}});return current;
  });
  const prepared=await actions.begin(board.id,"members",member.identity);
  assert.equal(prepared.groupId,"group");
  await actions.finish(board.id,"members",member.identity,prepared.token,{error:"Lost response"});
  assert.equal((await store.read(board.id)).actions[0].phase,"unknown");
  const recovered=await actions.finish(board.id,"members",member.identity,prepared.token,{members:[{identity:member.identity},{identity:peer.identity}],coordinator:member.identity});
  assert.equal(recovered.actions[0].phase,"applied");assert.deepEqual(recovered.members,[member,peer]);
 }finally{await store.close();await rm(root,{recursive:true,force:true});}
});
